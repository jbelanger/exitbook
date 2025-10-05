import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type z from 'zod';

import { PartialImportError } from '../core/errors.ts';
import * as ExchangeUtils from '../core/exchange-utils.ts';
import type { ExchangeCredentials, FetchParams, IExchangeClient, RawTransactionWithMetadata } from '../core/types.ts';

import { KrakenCredentialsSchema, KrakenLedgerEntrySchema } from './schemas.ts';

export type KrakenLedgerEntry = z.infer<typeof KrakenLedgerEntrySchema>;

/**
 * Factory function that creates a Kraken exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 *
 * Imperative shell pattern: manages side effects (ccxt API calls)
 * and delegates business logic to pure functions
 */
export function createKrakenClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  // Validate credentials using pure function
  return ExchangeUtils.validateCredentials(KrakenCredentialsSchema, credentials, 'kraken').map(({ apiKey, secret }) => {
    // Create ccxt instance - side effect captured in closure
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
              // Metadata mapper: Extract cursor, externalId, and rawData
              (parsedData: KrakenLedgerEntry) => {
                const timestamp = new Date(parsedData.time * 1000);
                return {
                  cursor: { ledger: timestamp.getTime() },
                  externalId: parsedData.id,
                  rawData: parsedData,
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
                `Fetch failed after processing ${allTransactions.length} transactions: ${error instanceof Error ? error.message : String(error)}`,
                allTransactions,
                { ofs, since },
                currentCursor
              )
            );
          }
          return err(error instanceof Error ? error : new Error(String(error)));
        }
      },
    };
  });
}
