import type { CursorState, ExchangeCredentials, RawTransactionInput } from '@exitbook/core';
import { getErrorMessage, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import * as ExchangeUtils from '../../core/exchange-utils.js';
import { ExchangeLedgerEntrySchema, type ExchangeLedgerEntry } from '../../core/schemas.js';
import type { BalanceSnapshot, FetchBatchResult, FetchParams, IExchangeClient } from '../../core/types.js';

import { KrakenCredentialsSchema, KrakenLedgerEntrySchema } from './schemas.js';

const logger = getLogger('KrakenClient');

/**
 * Normalize Kraken asset symbols by removing X/Z prefixes.
 * Kraken uses X prefix for crypto (XXBT, XETH) and Z prefix for fiat (ZUSD, ZEUR).
 */
function normalizeKrakenAsset(assetSymbol: string): string {
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
  if (assetMappings[assetSymbol]) {
    return assetMappings[assetSymbol];
  }

  // Remove X/Z prefix if present
  if (assetSymbol.startsWith('X') || assetSymbol.startsWith('Z')) {
    const withoutPrefix = assetSymbol.substring(1);
    // Check if the result is in mappings
    if (assetMappings[withoutPrefix]) {
      return assetMappings[withoutPrefix];
    }
    // Return without prefix if it looks reasonable (3+ chars)
    if (withoutPrefix.length >= 3) {
      return withoutPrefix;
    }
  }

  return assetSymbol;
}

/**
 * Factory function that creates a Kraken exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 */
export function createKrakenClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  // Validate credentials
  return ExchangeUtils.validateCredentials(KrakenCredentialsSchema, credentials, 'kraken').map(
    ({ apiKey, apiSecret }) => {
      // Create ccxt instance
      const exchange = new ccxt.kraken({
        apiKey: apiKey,
        secret: apiSecret,
      });

      // Return object with methods that close over the exchange instance
      return {
        exchangeId: 'kraken',

        async *fetchTransactionDataStreaming(
          params?: FetchParams
        ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
          // Extract timestamp and offset from ledger cursor (if exists)
          const ledgerCursor = params?.cursor?.['ledger'];
          const since = ledgerCursor?.primary.value as number | undefined;
          let ofs = (ledgerCursor?.metadata?.['offset'] as number) || 0;
          const limit = 50; // Kraken's default/max per request

          // Track cumulative count starting from previous cursor's totalFetched
          let cumulativeFetched = (ledgerCursor?.totalFetched as number) || 0;

          try {
            let pageCount = 0;

            while (true) {
              // Side effect: Fetch from API (uses exchange from closure)
              const ledgerEntries = await exchange.fetchLedger(undefined, since, limit, { ofs });

              if (ledgerEntries.length === 0) {
                // No more data - always yield completion batch to mark operation complete
                yield ok({
                  transactions: [],
                  operationType: 'ledger',
                  cursor: {
                    primary: { type: 'timestamp', value: since ?? Date.now() },
                    // Use explicit sentinel for empty accounts; ingestion should treat this as complete without dedup
                    lastTransactionId: ledgerCursor?.lastTransactionId ?? 'kraken:ledger:none',
                    totalFetched: cumulativeFetched,
                    metadata: {
                      providerName: 'kraken',
                      updatedAt: Date.now(),
                      offset: ofs,
                      isComplete: true,
                    },
                  },
                  isComplete: true,
                });
                break;
              }

              // Process items inline - validate and transform each ledger entry
              const transactions: RawTransactionInput[] = [];
              let lastCursorState: CursorState | undefined;
              let validationError: Error | undefined;

              for (let i = 0; i < ledgerEntries.length; i++) {
                const entry = ledgerEntries[i]!;

                // Extract raw data from ccxt item
                const rawItem = { ...(entry.info as Record<string, unknown>) };

                // Validate using Zod schema
                const validationResult = ExchangeUtils.validateRawData(KrakenLedgerEntrySchema, rawItem, 'kraken');
                if (validationResult.isErr()) {
                  validationError = new Error(
                    `Validation failed after ${i} items in batch: ${validationResult.error.message}`
                  );
                  break;
                }

                const validatedData = validationResult.value;
                const timestamp = new Date(validatedData.time * 1000);
                const normalizedAsset = normalizeKrakenAsset(validatedData.asset);

                // Map KrakenLedgerEntry to ExchangeLedgerEntry with Kraken-specific normalization
                const normalizedData: ExchangeLedgerEntry = {
                  id: validatedData.id,
                  correlationId: validatedData.refid,
                  timestamp: Math.floor(validatedData.time * 1000),
                  type: validatedData.type,
                  assetSymbol: normalizedAsset,
                  amount: validatedData.amount,
                  fee: validatedData.fee,
                  feeCurrency: normalizedAsset,
                  status: 'success',
                };

                // Validate normalized data against schema
                const normalizedValidation = ExchangeLedgerEntrySchema.safeParse(normalizedData);
                if (!normalizedValidation.success) {
                  validationError = new Error(
                    `Normalized data validation failed after ${i} items in batch: ${normalizedValidation.error.message}`
                  );
                  break;
                }

                // Add validated transaction to batch
                transactions.push({
                  eventId: validatedData.id,
                  timestamp: Math.floor(validatedData.time * 1000),
                  providerName: 'kraken',
                  providerData: validatedData,
                  normalizedData: normalizedValidation.data,
                });

                // Track cursor state (will be used for this batch)
                lastCursorState = {
                  primary: { type: 'timestamp', value: timestamp.getTime() },
                  lastTransactionId: validatedData.id,
                  totalFetched: 1, // Will be overridden with cumulative count
                  metadata: {
                    providerName: 'kraken',
                    updatedAt: Date.now(),
                    offset: ofs + i + 1, // Precise offset based on actual progress
                  },
                };
              }

              // If validation failed partway through
              if (validationError) {
                // If we have successful items, yield them first
                if (transactions.length > 0 && lastCursorState) {
                  cumulativeFetched += transactions.length;

                  yield ok({
                    transactions,
                    operationType: 'ledger',
                    cursor: {
                      ...lastCursorState,
                      totalFetched: cumulativeFetched,
                      metadata: {
                        ...lastCursorState.metadata,
                        providerName: 'kraken',
                        updatedAt: Date.now(),
                        offset: ofs + transactions.length,
                      },
                    },
                    isComplete: false,
                  });
                }

                // Then yield the error
                yield err(validationError);
                return;
              }

              // All items validated successfully
              cumulativeFetched += transactions.length;
              pageCount++;

              // Log every page for debugging
              logger.debug(
                `Fetched Kraken page ${pageCount}: ${transactions.length} transactions (${cumulativeFetched} total)`
              );

              // Check if this is the last page
              const isComplete = ledgerEntries.length < limit;

              yield ok({
                transactions,
                operationType: 'ledger',
                cursor: lastCursorState
                  ? {
                      ...lastCursorState,
                      totalFetched: cumulativeFetched,
                      metadata: {
                        ...lastCursorState.metadata,
                        providerName: 'kraken',
                        updatedAt: Date.now(),
                        offset: ofs + transactions.length,
                      },
                    }
                  : {
                      primary: { type: 'timestamp', value: since ?? Date.now() },
                      lastTransactionId: transactions[transactions.length - 1]?.eventId ?? '',
                      totalFetched: cumulativeFetched,
                      metadata: {
                        providerName: 'kraken',
                        updatedAt: Date.now(),
                        offset: ofs + transactions.length,
                      },
                    },
                isComplete,
              });

              // If we got less than the limit, we've reached the end
              if (isComplete) break;

              // Update offset for next page based on actual processed count
              ofs += transactions.length;
            }
          } catch (error) {
            // Network/API error during fetch - yield error
            yield err(error instanceof Error ? error : new Error(`Kraken API error: ${getErrorMessage(error)}`));
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
    }
  );
}
