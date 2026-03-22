import type { CursorState, Result } from '@exitbook/foundation';
import { err, ok, resultDo, wrapError } from '@exitbook/foundation';
import { HttpClient } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';

import { validateCredentials, validateRawData } from '../../client/schema-validation.js';
import type { ExchangeCredentials } from '../../contracts/exchange-credentials.js';
import type { BalanceSnapshot, FetchBatchResult, FetchParams, IExchangeClient } from '../../contracts/index.js';
import type { RawTransactionInput } from '../../contracts/raw-transaction.js';

import { normalizeKrakenAsset } from './asset-normalization.js';
import { krakenPost } from './auth.js';
import { KrakenCredentialsSchema, KrakenLedgerEntrySchema } from './contracts.js';

const logger = getLogger('KrakenClient');

/** Kraken private API rate limit: counter-based system, Ledgers costs 2 per call, max ~15 counter */
const KRAKEN_RATE_LIMIT = {
  requestsPerSecond: 0.33,
  requestsPerMinute: 15,
  requestsPerHour: 500,
  burstLimit: 3,
};

interface KrakenLedgerResponse {
  ledger: Record<string, Record<string, unknown>>;
  count: number;
}

type KrakenBalanceExResponse = Record<string, { balance: string; hold_trade: string }>;

/**
 * Fetch ledger entries from Kraken's private Ledgers endpoint.
 * Returns raw entries with the ledger ID injected as `id`.
 *
 * Uses only `ofs` (absolute global offset) for pagination — never a `start` timestamp filter.
 * Combining `start` + `ofs` is broken because Kraken's `ofs` is relative to the filtered result
 * set, so mixing them causes entries to be silently skipped on resume and incremental runs.
 */
async function fetchLedger(
  httpClient: HttpClient,
  auth: { apiKey: string; apiSecret: string },
  ofs: number
): Promise<Result<Record<string, unknown>[], Error>> {
  const result = await krakenPost<KrakenLedgerResponse>(httpClient, auth, 'Ledgers', { ofs });

  if (result.isErr()) {
    return err(result.error);
  }

  const ledger = result.value.ledger ?? {};
  return ok(Object.entries(ledger).map(([id, entry]) => ({ ...entry, id })));
}

/**
 * Factory function that creates a Kraken exchange client.
 * Returns raw Kraken API data as providerData — normalization happens in the processor.
 */
export function createKrakenClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  return resultDo(function* () {
    const { apiKey, apiSecret } = yield* validateCredentials(KrakenCredentialsSchema, credentials, 'kraken');
    const auth = { apiKey, apiSecret };

    const httpClient = new HttpClient({
      baseUrl: 'https://api.kraken.com',
      providerName: 'kraken',
      service: 'exchange',
      rateLimit: KRAKEN_RATE_LIMIT,
      timeout: 30_000,
      retries: 5,
    });

    return {
      exchangeId: 'kraken',

      async *fetchTransactionDataStreaming(
        params?: FetchParams
      ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
        const ledgerCursor = params?.cursor?.['ledger'];
        let ofs = (ledgerCursor?.metadata?.['offset'] as number) || 0;
        const limit = 50;

        let cumulativeFetched = (ledgerCursor?.totalFetched as number) || 0;

        let pageCount = 0;

        while (true) {
          const ledgerResult = await fetchLedger(httpClient, auth, ofs);

          if (ledgerResult.isErr()) {
            yield wrapError(ledgerResult.error, 'Kraken API error');
            return;
          }

          const ledgerEntries = ledgerResult.value;

          if (ledgerEntries.length === 0) {
            yield ok({
              transactions: [],
              operationType: 'ledger',
              cursor: {
                primary: {
                  type: 'timestamp',
                  value: (ledgerCursor?.primary.value as number | undefined) ?? Date.now(),
                },
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
            const rawItem = ledgerEntries[i]!;

            const validationResult = validateRawData(KrakenLedgerEntrySchema, rawItem, 'kraken');
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
                  primary: { type: 'timestamp', value: Date.now() },
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
      },

      async fetchBalance(): Promise<Result<BalanceSnapshot, Error>> {
        const postResult = await krakenPost<KrakenBalanceExResponse>(httpClient, auth, 'BalanceEx');

        if (postResult.isErr()) {
          return wrapError(postResult.error, 'Failed to fetch Kraken balance');
        }

        const balances: Record<string, string> = {};

        for (const [asset, amounts] of Object.entries(postResult.value)) {
          const balance = parseFloat(amounts.balance);
          if (balance !== 0) {
            const normalizedAsset = normalizeKrakenAsset(asset);
            balances[normalizedAsset] = amounts.balance;
          }
        }

        return ok({ balances, timestamp: Date.now() });
      },
    };
  });
}
