import { getErrorMessage, wrapError } from '@exitbook/core';
import { progress } from '@exitbook/ui';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import * as ExchangeUtils from '../../core/exchange-utils.js';
import type { ExchangeLedgerEntry } from '../../core/schemas.js';
import type {
  BalanceSnapshot,
  ExchangeCredentials,
  FetchBatchResult,
  FetchParams,
  IExchangeClient,
} from '../../core/types.js';

import { KrakenCredentialsSchema, KrakenLedgerEntrySchema, type KrakenLedgerEntry } from './schemas.js';

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

      async *fetchTransactionDataStreaming(
        params?: FetchParams
      ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
        // Extract timestamp and offset from ledger cursor (if exists)
        const ledgerCursor = params?.cursor?.['ledger'];
        const since = ledgerCursor?.primary.value as number | undefined;
        let ofs = (ledgerCursor?.metadata?.offset as number) || 0;
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
                const normalizedData: ExchangeLedgerEntry = {
                  id: validatedData.id,
                  correlationId: validatedData.refid,
                  timestamp: Math.floor(validatedData.time * 1000),
                  type: validatedData.type,
                  asset: normalizedAsset,
                  amount: validatedData.amount,
                  fee: validatedData.fee,
                  feeCurrency: normalizedAsset,
                  status: 'success',
                };

                return {
                  cursorUpdates: {
                    ledger: {
                      primary: { type: 'timestamp', value: timestamp.getTime() },
                      lastTransactionId: validatedData.id,
                      totalFetched: 1,
                      metadata: {
                        providerName: 'kraken',
                        updatedAt: Date.now(),
                        offset: ofs, // Start of current page; will be overridden with actual progress
                      },
                    },
                  },
                  externalId: validatedData.id,
                  normalizedData,
                };
              },
              'kraken'
            );

            if (processResult.isErr()) {
              // Validation failed - yield error with successful items from this batch
              const partialError = processResult.error;

              // If we have successful items, yield them first
              if (partialError.successfulItems.length > 0) {
                const lastCursor = partialError.lastSuccessfulCursorUpdates?.['ledger'];
                cumulativeFetched += partialError.successfulItems.length;

                // Build cursor with correct cumulative totalFetched and advanced offset
                const cursorToYield = lastCursor
                  ? {
                      ...lastCursor,
                      totalFetched: cumulativeFetched, // Use cumulative count
                      metadata: {
                        ...lastCursor.metadata,
                        providerName: 'kraken',
                        updatedAt: Date.now(),
                        offset: ofs + partialError.successfulItems.length, // Only advance past successful items
                      },
                    }
                  : {
                      primary: { type: 'timestamp' as const, value: since ?? Date.now() },
                      lastTransactionId:
                        partialError.successfulItems[partialError.successfulItems.length - 1]?.externalId ?? '',
                      totalFetched: cumulativeFetched,
                      metadata: {
                        providerName: 'kraken',
                        updatedAt: Date.now(),
                        offset: ofs + partialError.successfulItems.length, // Only advance past successful items
                      },
                    };

                yield ok({
                  transactions: partialError.successfulItems,
                  operationType: 'ledger',
                  cursor: cursorToYield,
                  isComplete: false,
                });
              }

              // Then yield the error
              yield err(
                new Error(
                  `Validation failed after ${partialError.successfulItems.length} items in batch: ${partialError.message}`
                )
              );
              return;
            }

            // Yield successful batch
            const { transactions, cursorUpdates } = processResult.value;
            cumulativeFetched += transactions.length;
            pageCount++;

            // Log every page for debugging
            progress.log(
              `Fetched Kraken page ${pageCount}: ${transactions.length} transactions (${cumulativeFetched} total)`
            );

            // Report progress every 10 pages
            if (pageCount % 10 === 0) {
              progress.update(`Processed ${pageCount} pages`, cumulativeFetched);
            }

            // Update cursor with cumulative totalFetched and correct offset
            const currentLedgerCursor = cursorUpdates['ledger'];
            if (currentLedgerCursor) {
              currentLedgerCursor.totalFetched = cumulativeFetched;
              // Override offset to reflect actual progress (mapper uses ledgerEntries.length)
              if (currentLedgerCursor.metadata) {
                currentLedgerCursor.metadata.offset = ofs + transactions.length;
                currentLedgerCursor.metadata.updatedAt = Date.now();
              }
            }

            // Check if this is the last page
            const isComplete = ledgerEntries.length < limit;

            yield ok({
              transactions,
              operationType: 'ledger',
              cursor: currentLedgerCursor ?? {
                primary: { type: 'timestamp', value: since ?? Date.now() },
                lastTransactionId: transactions[transactions.length - 1]?.externalId ?? '',
                totalFetched: cumulativeFetched,
                metadata: {
                  providerName: 'kraken',
                  updatedAt: Date.now(),
                  offset: ofs + transactions.length, // Actual progress, not page size
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
  });
}
