import type { CursorState, ExchangeCredentials, RawTransactionInput } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import * as ExchangeUtils from '../../core/exchange-utils.js';
import type { BalanceSnapshot, FetchBatchResult, FetchParams, IExchangeClient } from '../../core/types.js';

import { CoinbaseCredentialsSchema, RawCoinbaseLedgerEntrySchema } from './schemas.js';

const logger = getLogger('CoinbaseClient');

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

/**
 * Normalize PEM private key by converting escaped newlines to actual newlines
 */
function normalizePemKey(secret: string): string {
  return secret.replace(/\\n/g, '\n');
}

/**
 * Factory function that creates a Coinbase exchange client.
 * Returns raw Coinbase API v2 data as providerData — normalization happens in the processor.
 */
export function createCoinbaseClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  return ExchangeUtils.validateCredentials(CoinbaseCredentialsSchema, credentials, 'coinbase').andThen(
    ({ apiKey, apiSecret }) => {
      const validationResult = validateCoinbaseCredentials(apiKey, apiSecret);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const normalizedSecret = normalizePemKey(apiSecret);

      const exchange = new ccxt.coinbaseadvanced({
        apiKey,
        password: '',
        secret: normalizedSecret,
      });

      return ok({
        exchangeId: 'coinbase',

        async *fetchTransactionDataStreaming(
          params?: FetchParams
        ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
          const limit = 100;

          try {
            // Step 1: Fetch all accounts
            const accounts = await exchange.fetchAccounts();
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

            // Step 2: Stream ledger entries for each account
            let accountIndex = 0;
            for (const account of accounts) {
              const accountId = account.id;

              if (!accountId) {
                logger.warn({ account }, 'Skipping Coinbase account without ID');
                accountIndex++;
                continue;
              }

              const accountCursorState = params?.cursor?.[accountId];
              let accountCursor = accountCursorState?.primary.value as number | undefined;
              let cumulativeFetched = (accountCursorState?.totalFetched as number) || 0;
              let pageCount = 0;

              while (true) {
                const ledgerEntries = await exchange.fetchLedger(undefined, accountCursor, limit, {
                  account_id: accountId,
                });

                if (ledgerEntries.length === 0) {
                  yield ok({
                    transactions: [],
                    operationType: accountId,
                    cursor: {
                      primary: { type: 'timestamp', value: accountCursor ?? Date.now() },
                      lastTransactionId: accountCursorState?.lastTransactionId ?? `coinbase:${accountId}:none`,
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
                let lastCursorState: CursorState | undefined;
                let validationError: Error | undefined;

                for (let i = 0; i < ledgerEntries.length; i++) {
                  const entry = ledgerEntries[i]!;

                  // Validate and extract raw Coinbase API v2 data from ccxt's info property
                  let rawInfo;
                  try {
                    rawInfo = RawCoinbaseLedgerEntrySchema.parse(entry.info);
                  } catch (error) {
                    validationError = new Error(
                      `Raw data validation failed after ${i} items in batch: ${String(error)}`
                    );
                    break;
                  }

                  const timestamp = new Date(rawInfo.created_at).getTime();

                  // Store raw Coinbase API data only — processor handles normalization
                  transactions.push({
                    eventId: rawInfo.id,
                    timestamp,
                    providerName: 'coinbase',
                    providerData: rawInfo,
                  });

                  lastCursorState = {
                    primary: { type: 'timestamp', value: timestamp },
                    lastTransactionId: rawInfo.id,
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

                const isComplete = ledgerEntries.length < limit;

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
                    primary: { type: 'timestamp', value: accountCursor ?? Date.now() },
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

                if (lastCursorState) {
                  accountCursor = (lastCursorState.primary.value as number) + 1;
                }
              }

              accountIndex++;
            }
          } catch (error) {
            yield wrapError(error, 'Coinbase API error');
          }
        },

        async fetchBalance(): Promise<Result<BalanceSnapshot, Error>> {
          try {
            const balance = await exchange.fetchBalance();
            const balances = ExchangeUtils.processCCXTBalance(balance);
            return ok({ balances, timestamp: Date.now() });
          } catch (error) {
            return wrapError(error, 'Failed to fetch Coinbase balance');
          }
        },
      });
    }
  );
}
