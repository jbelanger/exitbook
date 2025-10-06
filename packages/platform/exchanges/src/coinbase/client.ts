import type { RawTransactionWithMetadata } from '@exitbook/core';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type z from 'zod';

import { PartialImportError } from '../core/errors.ts';
import * as ExchangeUtils from '../core/exchange-utils.ts';
import type { ExchangeCredentials, FetchParams, IExchangeClient } from '../core/types.ts';

import { CoinbaseCredentialsSchema, CoinbaseLedgerEntrySchema } from './schemas.ts';

export type CoinbaseLedgerEntry = z.infer<typeof CoinbaseLedgerEntrySchema>;

/**
 * Factory function that creates a Coinbase exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 *
 * Imperative shell pattern: manages side effects (ccxt API calls)
 * and delegates business logic to pure functions
 */
export function createCoinbaseClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  // Validate credentials using pure function
  return ExchangeUtils.validateCredentials(CoinbaseCredentialsSchema, credentials, 'coinbase').map(
    ({ apiKey, secret }) => {
      // Create ccxt instance - side effect captured in closure
      const exchange = new ccxt.coinbase({
        apiKey,
        secret,
      });

      // Return object with methods that close over the exchange instance
      return {
        exchangeId: 'coinbase',

        async fetchTransactionData(params?: FetchParams): Promise<Result<RawTransactionWithMetadata[], Error>> {
          const allTransactions: RawTransactionWithMetadata[] = [];
          const currentCursor = { ...(params?.cursor || {}) };

          // Fetch ledger entries - this includes ALL balance changes:
          // deposits, withdrawals, trades, fees, rebates, etc.
          // Coinbase uses pagination via 'since' parameter
          const limit = 100; // Coinbase default limit

          try {
            while (true) {
              // Side effect: Fetch from API (uses exchange from closure)
              // Use currentCursor.ledger directly to support pagination
              const ledgerEntries = await exchange.fetchLedger(undefined, currentCursor.ledger, limit);

              if (ledgerEntries.length === 0) break;

              // Delegate to pure function for processing
              const processResult = ExchangeUtils.processItems(
                ledgerEntries,
                // Extractor: Get raw data from ccxt item
                (item) => ({ ...item }),
                // Validator: Validate using Zod schema
                (rawItem) => ExchangeUtils.validateRawData(CoinbaseLedgerEntrySchema, rawItem, 'coinbase'),
                // Metadata mapper: Extract cursor, externalId, and rawData
                (parsedData: CoinbaseLedgerEntry) => {
                  return {
                    cursor: { ledger: parsedData.timestamp },
                    externalId: parsedData.id,
                    rawData: parsedData,
                  };
                },
                'coinbase',
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

              // Update since timestamp for next page (add 1ms to avoid duplicate)
              if (currentCursor.ledger) {
                currentCursor.ledger = currentCursor.ledger + 1;
              }
            }

            return ok(allTransactions);
          } catch (error) {
            // Network/API error during fetch - return partial results if we have any
            if (allTransactions.length > 0) {
              return err(
                new PartialImportError(
                  `Fetch failed after processing ${allTransactions.length} transactions: ${error instanceof Error ? error.message : String(error)}`,
                  allTransactions,
                  { ledger: currentCursor.ledger },
                  currentCursor
                )
              );
            }
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        },
      };
    }
  );
}
