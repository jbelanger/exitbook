import type { CursorState, ExchangeCredentials, RawTransactionInput } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import { HttpClient } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import * as ExchangeUtils from '../../core/exchange-utils.js';
import type { BalanceSnapshot, FetchBatchResult, FetchParams, IExchangeClient } from '../../core/types.js';

import { krakenPost } from './kraken-auth.js';
import { normalizeKrakenAsset } from './kraken-utils.js';
import { KrakenCredentialsSchema, KrakenLedgerEntrySchema } from './schemas.js';

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
 */
async function fetchLedger(
  httpClient: HttpClient,
  auth: { apiKey: string; apiSecret: string },
  since: number | undefined,
  limit: number,
  ofs: number
): Promise<Result<Record<string, unknown>[], Error>> {
  const params: Record<string, string | number> = { ofs };
  if (since !== undefined) {
    params['start'] = Math.floor(since / 1000);
  }

  const result = await krakenPost<KrakenLedgerResponse>(httpClient, auth, 'Ledgers', params);

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
  return ExchangeUtils.validateCredentials(KrakenCredentialsSchema, credentials, 'kraken').map(
    ({ apiKey, apiSecret }) => {
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
          const since = ledgerCursor?.primary.value as number | undefined;
          let ofs = (ledgerCursor?.metadata?.['offset'] as number) || 0;
          const limit = 50;

          let cumulativeFetched = (ledgerCursor?.totalFetched as number) || 0;

          let pageCount = 0;

          while (true) {
            const ledgerResult = await fetchLedger(httpClient, auth, since, limit, ofs);

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
              const rawItem = ledgerEntries[i]!;

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
    }
  );
}
