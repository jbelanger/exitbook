import type { CursorState, ExchangeCredentials, RawTransactionInput } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import * as ExchangeUtils from '../../core/exchange-utils.js';
import type { BalanceSnapshot, FetchBatchResult, FetchParams, IExchangeClient } from '../../core/types.js';

import { normalizeKrakenAsset } from './kraken-utils.js';
import { KrakenCredentialsSchema, KrakenLedgerEntrySchema } from './schemas.js';

const logger = getLogger('KrakenClient');

/**
 * Factory function that creates a Kraken exchange client.
 * Returns raw Kraken API data as providerData — normalization happens in the processor.
 */
export function createKrakenClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  return ExchangeUtils.validateCredentials(KrakenCredentialsSchema, credentials, 'kraken').map(
    ({ apiKey, apiSecret }) => {
      const exchange = new ccxt.kraken({
        apiKey: apiKey,
        secret: apiSecret,
      });

      return {
        exchangeId: 'kraken',

        async *fetchTransactionDataStreaming(
          params?: FetchParams
        ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
          const ledgerCursor = params?.cursor?.['ledger'];
          const since = ledgerCursor?.primary.value as number | undefined;
          let ofs = (ledgerCursor?.metadata?.['offset'] as number) || 0;
          const limit = 50;

          let cumulativeFetched = (ledgerCursor?.totalFetched as number) || 0;

          try {
            let pageCount = 0;

            while (true) {
              const ledgerEntries = await exchange.fetchLedger(undefined, since, limit, { ofs });

              if (ledgerEntries.length === 0) {
                yield ok({
                  transactions: [],
                  operationType: 'ledger',
                  cursor: {
                    primary: { type: 'timestamp', value: since ?? Date.now() },
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

              const transactions: RawTransactionInput[] = [];
              let lastCursorState: CursorState | undefined;
              let validationError: Error | undefined;

              for (let i = 0; i < ledgerEntries.length; i++) {
                const entry = ledgerEntries[i]!;

                // Extract raw data from ccxt and validate against Kraken schema
                const rawItem = { ...(entry.info as Record<string, unknown>) };
                const validationResult = ExchangeUtils.validateRawData(KrakenLedgerEntrySchema, rawItem, 'kraken');
                if (validationResult.isErr()) {
                  validationError = new Error(
                    `Validation failed after ${i} items in batch: ${validationResult.error.message}`
                  );
                  break;
                }

                const validatedData = validationResult.value;

                // Store raw Kraken data only — processor handles normalization
                transactions.push({
                  eventId: validatedData.id,
                  timestamp: Math.floor(validatedData.time * 1000),
                  providerName: 'kraken',
                  providerData: validatedData,
                });

                lastCursorState = {
                  primary: { type: 'timestamp', value: Math.floor(validatedData.time * 1000) },
                  lastTransactionId: validatedData.id,
                  totalFetched: 1,
                  metadata: {
                    providerName: 'kraken',
                    updatedAt: Date.now(),
                    offset: ofs + i + 1,
                  },
                };
              }

              if (validationError) {
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

                yield err(validationError);
                return;
              }

              cumulativeFetched += transactions.length;
              pageCount++;

              logger.debug(
                `Fetched Kraken page ${pageCount}: ${transactions.length} transactions (${cumulativeFetched} total)`
              );

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

              if (isComplete) break;

              ofs += transactions.length;
            }
          } catch (error) {
            yield wrapError(error, 'Kraken API error');
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
