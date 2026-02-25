import type { CursorState, ExchangeCredentials, RawTransactionInput } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import { HttpClient } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import * as ExchangeUtils from '../../core/exchange-utils.js';
import type { BalanceSnapshot, FetchBatchResult, FetchParams, IExchangeClient } from '../../core/types.js';

import { coinbaseGet } from './coinbase-auth.js';
import { CoinbaseAccountSchema, CoinbaseCredentialsSchema, RawCoinbaseLedgerEntrySchema } from './schemas.js';
import type { CoinbaseAccount } from './schemas.js';

const logger = getLogger('CoinbaseClient');

/** Coinbase Advanced Trade API rate limit: ~5 req/s (conservative for v2 endpoints) */
const COINBASE_RATE_LIMIT = {
  requestsPerSecond: 5,
  requestsPerMinute: 200,
  requestsPerHour: 10_000,
  burstLimit: 10,
};

/**
 * Validate Coinbase credentials format and provide helpful error messages
 */
function validateCoinbaseCredentials(apiKey: string, secret: string): Result<void, Error> {
  if (!apiKey.includes('/apiKeys/')) {
    return err(
      new Error(
        `Invalid Coinbase API key format. Expected: organizations/{org_id}/apiKeys/{key_id}, got: ${apiKey}\n\n` +
          `To create a valid Coinbase API key:\n` +
          `   1. Go to https://portal.cdp.coinbase.com/access/api\n` +
          `   2. Select 'Secret API Keys' tab\n` +
          `   3. Click 'Create API key'\n` +
          `   4. CRITICAL: Select 'ECDSA' as signature algorithm (NOT Ed25519)\n` +
          `   5. Use the full API key path: organizations/YOUR_ORG_ID/apiKeys/YOUR_KEY_ID`
      )
    );
  }

  if (!secret.includes('-----BEGIN EC PRIVATE KEY-----')) {
    return err(
      new Error(
        `Invalid Coinbase private key format. Expected ECDSA PEM key, got: ${secret.substring(0, 50)}...\n\n` +
          `Requirements:\n` +
          `   • Must be ECDSA key (NOT Ed25519)\n` +
          `   • Must be in PEM format: -----BEGIN EC PRIVATE KEY-----\\n...\\n-----END EC PRIVATE KEY-----\n` +
          `   • When passing via CLI, use escaped newlines: "-----BEGIN EC PRIVATE KEY-----\\n..."\n\n` +
          `Example CLI format:\n` +
          `   --api-secret "-----BEGIN EC PRIVATE KEY-----\\nMHcCAQEE...\\n-----END EC PRIVATE KEY-----"`
      )
    );
  }

  return ok();
}

function normalizePemKey(secret: string): string {
  return secret.replace(/\\n/g, '\n');
}

/**
 * Fetch all accounts from Coinbase v2 API, handling pagination.
 */
async function fetchAllAccounts(
  httpClient: HttpClient,
  auth: { apiKey: string; secret: string }
): Promise<Result<CoinbaseAccount[], Error>> {
  const accounts: CoinbaseAccount[] = [];
  let startingAfter: string | undefined = undefined;

  while (true) {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) {
      params.set('starting_after', startingAfter);
    }

    const result = await coinbaseGet<unknown>(httpClient, auth, `/v2/accounts?${params.toString()}`);

    if (result.isErr()) {
      return err(result.error);
    }

    const response = result.value;
    for (const item of response.data) {
      const parsed = CoinbaseAccountSchema.safeParse(item);
      if (parsed.success) {
        accounts.push(parsed.data);
      } else {
        logger.warn({ item, error: parsed.error }, 'Skipping account that failed validation');
      }
    }

    startingAfter = response.pagination.next_starting_after ?? undefined;
    if (!startingAfter || response.data.length === 0) break;
  }

  return ok(accounts);
}

/**
 * Fetch a page of transactions for a specific account from Coinbase v2 API.
 */
async function fetchTransactionPage(
  httpClient: HttpClient,
  auth: { apiKey: string; secret: string },
  accountId: string,
  limit: number,
  startingAfter?: string
): Promise<Result<{ entries: unknown[]; nextCursor: string | null }, Error>> {
  const params = new URLSearchParams({ limit: String(limit), order: 'asc' });
  if (startingAfter) {
    params.set('starting_after', startingAfter);
  }

  const result = await coinbaseGet<unknown>(
    httpClient,
    auth,
    `/v2/accounts/${accountId}/transactions?${params.toString()}`
  );

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({
    entries: result.value.data,
    nextCursor: result.value.pagination.next_starting_after,
  });
}

export function createCoinbaseClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  return ExchangeUtils.validateCredentials(CoinbaseCredentialsSchema, credentials, 'coinbase').andThen(
    ({ apiKey, apiSecret }) => {
      const validationResult = validateCoinbaseCredentials(apiKey, apiSecret);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const normalizedSecret = normalizePemKey(apiSecret);
      const auth = { apiKey, secret: normalizedSecret };

      const httpClient = new HttpClient({
        baseUrl: 'https://api.coinbase.com',
        providerName: 'coinbase',
        service: 'exchange',
        rateLimit: COINBASE_RATE_LIMIT,
        timeout: 30_000,
        retries: 3,
      });

      return ok({
        exchangeId: 'coinbase',

        async *fetchTransactionDataStreaming(
          params?: FetchParams
        ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
          const limit = 100;

          // Step 1: Fetch all accounts
          const accountsResult = await fetchAllAccounts(httpClient, auth);

          if (accountsResult.isErr()) {
            yield wrapError(accountsResult.error, 'Coinbase API error');
            return;
          }

          const accounts = accountsResult.value;
          if (accounts.length === 0) {
            yield ok({
              transactions: [],
              operationType: 'coinbase:no-accounts',
              cursor: {
                primary: { type: 'timestamp', value: Date.now() },
                lastTransactionId: 'coinbase:no-accounts',
                totalFetched: 0,
                metadata: {
                  providerName: 'coinbase',
                  updatedAt: Date.now(),
                  isComplete: true,
                },
              },
              isComplete: true,
            });
            return;
          }

          // Step 2: Stream transactions for each account
          let accountIndex = 0;
          for (const account of accounts) {
            const accountId = account.id;
            const accountCursorState = params?.cursor?.[accountId];
            let startingAfter = accountCursorState?.lastTransactionId;
            // If resuming from a cursor that used the old timestamp-based format, start fresh
            if (startingAfter?.startsWith('coinbase:')) {
              startingAfter = undefined;
            }
            let cumulativeFetched = (accountCursorState?.totalFetched as number) || 0;
            let pageCount = 0;
            let lastCursorState: CursorState | undefined;

            while (true) {
              const pageResult = await fetchTransactionPage(httpClient, auth, accountId, limit, startingAfter);

              if (pageResult.isErr()) {
                yield wrapError(pageResult.error, 'Coinbase API error');
                return;
              }

              const page = pageResult.value;

              if (page.entries.length === 0) {
                yield ok({
                  transactions: [],
                  operationType: accountId,
                  cursor: {
                    primary: startingAfter
                      ? { type: 'pageToken' as const, value: startingAfter, providerName: 'coinbase' }
                      : { type: 'timestamp' as const, value: Date.now() },
                    lastTransactionId:
                      lastCursorState?.lastTransactionId ??
                      accountCursorState?.lastTransactionId ??
                      `coinbase:${accountId}:none`,
                    totalFetched: cumulativeFetched,
                    metadata: {
                      providerName: 'coinbase',
                      updatedAt: Date.now(),
                      accountId,
                      isComplete: true,
                    },
                  },
                  isComplete: true,
                });
                break;
              }

              const transactions: RawTransactionInput[] = [];
              lastCursorState = undefined;
              let validationError: Error | undefined;

              for (let i = 0; i < page.entries.length; i++) {
                const entry = page.entries[i];

                let validated;
                try {
                  validated = RawCoinbaseLedgerEntrySchema.parse(entry);
                } catch (error) {
                  validationError = new Error(`Raw data validation failed after ${i} items in batch: ${String(error)}`);
                  break;
                }

                const timestamp = new Date(validated.created_at).getTime();

                transactions.push({
                  eventId: validated.id,
                  timestamp,
                  providerName: 'coinbase',
                  providerData: validated,
                });

                lastCursorState = {
                  primary: { type: 'pageToken', value: validated.id, providerName: 'coinbase' },
                  lastTransactionId: validated.id,
                  totalFetched: 1,
                  metadata: {
                    providerName: 'coinbase',
                    updatedAt: Date.now(),
                    accountId,
                  },
                };
              }

              if (validationError) {
                if (transactions.length > 0 && lastCursorState) {
                  cumulativeFetched += transactions.length;
                  yield ok({
                    transactions,
                    operationType: accountId,
                    cursor: {
                      ...lastCursorState,
                      totalFetched: cumulativeFetched,
                      metadata: {
                        ...lastCursorState.metadata,
                        providerName: 'coinbase',
                        updatedAt: Date.now(),
                        accountId,
                      },
                    },
                    isComplete: false,
                  });
                }

                yield err(
                  new Error(
                    `Validation failed for account ${accountId} after ${transactions.length} items in batch: ${validationError.message}`
                  )
                );
                return;
              }

              cumulativeFetched += transactions.length;
              pageCount++;

              logger.info(
                `Account ${accountIndex + 1}/${accounts.length} (${accountId}): page ${pageCount} - ${cumulativeFetched} transactions`
              );

              const isComplete = page.nextCursor === null || page.nextCursor === undefined;

              if (lastCursorState) {
                lastCursorState.totalFetched = cumulativeFetched;
                if (lastCursorState.metadata) {
                  lastCursorState.metadata.updatedAt = Date.now();
                  if (isComplete) {
                    lastCursorState.metadata.isComplete = true;
                  }
                }
              }

              yield ok({
                transactions,
                operationType: accountId,
                cursor: lastCursorState ?? {
                  primary: startingAfter
                    ? { type: 'pageToken' as const, value: startingAfter, providerName: 'coinbase' }
                    : { type: 'timestamp' as const, value: Date.now() },
                  lastTransactionId: transactions[transactions.length - 1]?.eventId ?? '',
                  totalFetched: cumulativeFetched,
                  metadata: {
                    providerName: 'coinbase',
                    updatedAt: Date.now(),
                    accountId,
                    isComplete,
                  },
                },
                isComplete,
              });

              if (isComplete) break;

              // Advance cursor for next page
              startingAfter = page.nextCursor ?? undefined;
            }

            accountIndex++;
          }
        },

        async fetchBalance(): Promise<Result<BalanceSnapshot, Error>> {
          const accountsResult = await fetchAllAccounts(httpClient, auth);

          if (accountsResult.isErr()) {
            return wrapError(accountsResult.error, 'Failed to fetch Coinbase balance');
          }

          const balances: Record<string, string> = {};

          for (const account of accountsResult.value) {
            const amount = parseFloat(account.balance.amount);
            if (amount !== 0) {
              const currency = account.balance.currency;
              // Aggregate balances across accounts with the same currency
              const existing = balances[currency];
              if (existing) {
                balances[currency] = (parseFloat(existing) + amount).toString();
              } else {
                balances[currency] = account.balance.amount;
              }
            }
          }

          return ok({ balances, timestamp: Date.now() });
        },
      });
    }
  );
}
