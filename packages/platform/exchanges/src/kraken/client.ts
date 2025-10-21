import { getErrorMessage, wrapError, type RawTransactionWithMetadata } from '@exitbook/core';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type z from 'zod';

import { PartialImportError } from '../core/errors.ts';
import * as ExchangeUtils from '../core/exchange-utils.ts';
import type { ExchangeLedgerEntry } from '../core/schemas.ts';
import type { BalanceSnapshot, ExchangeCredentials, FetchParams, IExchangeClient } from '../core/types.ts';

import { KrakenCredentialsSchema, KrakenLedgerEntrySchema } from './schemas.ts';

export type KrakenLedgerEntry = z.infer<typeof KrakenLedgerEntrySchema>;

/**
 * Normalize Kraken asset symbols by removing X/Z prefixes.
 * Kraken uses X prefix for crypto (XXBT, XETH) and Z prefix for fiat (ZUSD, ZEUR).
 */
function normalizeKrakenAsset(asset: string): string {
  const assetMappings: Record<string, string> = {
    XXBT: 'BTC',
    XBT: 'BTC',
    XETH: 'ETH',
    XXRP: 'XRP',
    XLTC: 'LTC',
    XXLM: 'XLM',
    XXMR: 'XMR',
    XZEC: 'ZEC',
    XXDG: 'DOGE',
    ZUSD: 'USD',
    ZEUR: 'EUR',
    ZCAD: 'CAD',
    ZGBP: 'GBP',
    ZJPY: 'JPY',
    ZCHF: 'CHF',
    ZAUD: 'AUD',
  };

  // Check exact match first
  if (assetMappings[asset]) {
    return assetMappings[asset];
  }

  // Remove X/Z prefix if present
  if (asset.startsWith('X') || asset.startsWith('Z')) {
    const withoutPrefix = asset.substring(1);
    // Check if the result is in mappings
    if (assetMappings[withoutPrefix]) {
      return assetMappings[withoutPrefix];
    }
    // Return without prefix if it looks reasonable (3+ chars)
    if (withoutPrefix.length >= 3) {
      return withoutPrefix;
    }
  }

  return asset;
}

/**
 * Factory function that creates a Kraken exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 */
export function createKrakenClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  // Validate credentials
  return ExchangeUtils.validateCredentials(KrakenCredentialsSchema, credentials, 'kraken').map(({ apiKey, secret }) => {
    // Create ccxt instance
    const exchange = new ccxt.kraken({
      apiKey,
      secret,
    });

    // Return object with methods that close over the exchange instance
    return {
      exchangeId: 'kraken',

      async fetchTransactionData(params?: FetchParams): Promise<Result<RawTransactionWithMetadata[], Error>> {
        const allTransactions: RawTransactionWithMetadata[] = [];
        const currentCursor = { ...(params?.cursor || {}) };

        // Fetch ledger entries - this includes ALL balance changes:
        // deposits, withdrawals, trades, conversions, fees, etc.
        const since = currentCursor.ledger;

        // Kraken uses 'ofs' parameter for offset - resume from cursor if available
        let ofs = currentCursor.offset || 0;
        const limit = 50; // Kraken's default/max per request

        try {
          while (true) {
            // Side effect: Fetch from API (uses exchange from closure)
            const ledgerEntries = await exchange.fetchLedger(undefined, since, limit, { ofs });

            if (ledgerEntries.length === 0) break;

            // Delegate to pure function for processing
            const processResult = ExchangeUtils.processItems(
              ledgerEntries,
              // Extractor: Get raw data from ccxt item
              (item) => ({ ...(item.info as Record<string, unknown>) }),
              // Validator: Validate using Zod schema
              (rawItem) => ExchangeUtils.validateRawData(KrakenLedgerEntrySchema, rawItem, 'kraken'),
              // Metadata mapper: Extract cursor, externalId, and normalizedData
              (validatedData: KrakenLedgerEntry, _item) => {
                const timestamp = new Date(validatedData.time * 1000);
                const normalizedAsset = normalizeKrakenAsset(validatedData.asset);

                // Map KrakenLedgerEntry to ExchangeLedgerEntry with Kraken-specific normalization
                // Additional Kraken-specific fields (subtype, aclass, balance) remain in rawData only
                const normalizedData: ExchangeLedgerEntry = {
                  id: validatedData.id,
                  correlationId: validatedData.refid,
                  timestamp: Math.floor(validatedData.time * 1000), // Convert to milliseconds and ensure integer
                  type: validatedData.type,
                  asset: normalizedAsset,
                  amount: validatedData.amount,
                  fee: validatedData.fee,
                  feeCurrency: normalizedAsset, // Kraken fees are in the same currency as the asset
                  status: 'success', // Kraken ledger entries don't have explicit status - they're all completed
                };

                return {
                  cursor: { ledger: timestamp.getTime() },
                  externalId: validatedData.id,
                  normalizedData,
                };
              },
              'kraken',
              currentCursor
            );

            if (processResult.isErr()) {
              // Validation failed - merge accumulated transactions with batch's successful items
              const partialError = processResult.error;
              allTransactions.push(...partialError.successfulItems);

              // Return new PartialImportError with all accumulated transactions
              return err(
                new PartialImportError(
                  partialError.message,
                  allTransactions,
                  partialError.failedItem,
                  partialError.lastSuccessfulCursor
                )
              );
            }

            // Accumulate successful results
            allTransactions.push(...processResult.value);

            // Update cursor with latest timestamp from this batch
            if (processResult.value.length > 0) {
              const lastItem = processResult.value[processResult.value.length - 1];
              if (lastItem?.cursor) {
                Object.assign(currentCursor, lastItem.cursor);
              }
            }

            // If we got less than the limit, we've reached the end
            if (ledgerEntries.length < limit) break;

            // Update offset for next page
            ofs += ledgerEntries.length;
            currentCursor.offset = ofs;
          }

          return ok(allTransactions);
        } catch (error) {
          // Network/API error during fetch - return partial results if we have any
          if (allTransactions.length > 0) {
            return err(
              new PartialImportError(
                `Fetch failed after processing ${allTransactions.length} transactions: ${getErrorMessage(error)}`,
                allTransactions,
                { ofs, since },
                currentCursor
              )
            );
          }
          return err(error instanceof Error ? error : new Error(String(error)));
        }
      },

      async fetchBalance(): Promise<Result<BalanceSnapshot, Error>> {
        try {
          const balance = await exchange.fetchBalance();
          const balances = ExchangeUtils.processCCXTBalance(balance, normalizeKrakenAsset);
          return ok({ balances, timestamp: Date.now() });
        } catch (error) {
          return wrapError(error, 'Failed to fetch Kraken balance');
        }
      },
    };
  });
}
