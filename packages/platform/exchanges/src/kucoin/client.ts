import type { RawTransactionWithMetadata } from '@exitbook/core';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type z from 'zod';

import { PartialImportError } from '../core/errors.ts';
import * as ExchangeUtils from '../core/exchange-utils.ts';
import type { ExchangeCredentials, FetchParams, IExchangeClient } from '../core/types.ts';

import { KuCoinCredentialsSchema, KuCoinLedgerEntrySchema } from './schemas.ts';

export type KuCoinLedgerEntry = z.infer<typeof KuCoinLedgerEntrySchema>;

/**
 * Factory function that creates a KuCoin exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 *
 * Imperative shell pattern: manages side effects (ccxt API calls)
 * and delegates business logic to pure functions
 */
export function createKuCoinClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  // Validate credentials using pure function
  return ExchangeUtils.validateCredentials(KuCoinCredentialsSchema, credentials, 'kucoin').map(
    ({ apiKey, secret, passphrase }) => {
      // Create ccxt instance - side effect captured in closure
      const exchange = new ccxt.kucoin({
        apiKey,
        secret,
        password: passphrase, // KuCoin uses 'password' field for passphrase in ccxt
      });

      // Return object with methods that close over the exchange instance
      return {
        exchangeId: 'kucoin',

        async fetchTransactionData(params?: FetchParams): Promise<Result<RawTransactionWithMetadata[], Error>> {
          const allTransactions: RawTransactionWithMetadata[] = [];
          const currentCursor = { ...(params?.cursor || {}) };

          // Fetch ledger entries - this includes ALL balance changes:
          // deposits, withdrawals, trades, fees, rebates, etc.
          let since = currentCursor.ledger;
          const limit = 500; // KuCoin allows up to 500 items per request

          try {
            while (true) {
              // Side effect: Fetch from API (uses exchange from closure)
              const ledgerEntries = await exchange.fetchLedger(undefined, since, limit);

              if (ledgerEntries.length === 0) break;

              // Delegate to pure function for processing
              const processResult = ExchangeUtils.processItems(
                ledgerEntries,
                // Extractor: Get raw data from ccxt item
                (item) => ({ ...item }),
                // Validator: Validate using Zod schema
                (rawItem) => ExchangeUtils.validateRawData(KuCoinLedgerEntrySchema, rawItem, 'kucoin'),
                // Metadata mapper: Extract cursor, externalId, and rawData
                (parsedData: KuCoinLedgerEntry) => {
                  return {
                    cursor: { ledger: parsedData.timestamp },
                    externalId: parsedData.id,
                    rawData: parsedData,
                  };
                },
                'kucoin',
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
                since = currentCursor.ledger + 1;
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
                  { since, limit },
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
