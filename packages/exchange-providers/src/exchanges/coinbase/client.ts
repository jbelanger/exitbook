import type { TransactionStatus } from '@exitbook/core';
import { getErrorMessage, parseDecimal, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
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

import {
  CoinbaseCredentialsSchema,
  CoinbaseLedgerEntrySchema,
  RawCoinbaseLedgerEntrySchema,
  type CoinbaseLedgerEntry,
} from './schemas.js';

const logger = getLogger('CoinbaseClient');

/**
 * Validate Coinbase credentials format and provide helpful error messages
 */
function validateCoinbaseCredentials(apiKey: string, secret: string): Result<void, Error> {
  // Validate API key format
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

  // Validate private key format (check for PEM header, allowing for escaped newlines)
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
 * Handles multiple levels of escaping that can occur through CLI argument parsing
 */
function normalizePemKey(secret: string): string {
  // Replace literal \n (backslash-n) with actual newlines
  // This handles keys passed via CLI like: "-----BEGIN EC PRIVATE KEY-----\n..."
  return secret.replace(/\\n/g, '\n');
}

/**
 * Map Coinbase status to universal status format
 */
function mapCoinbaseStatus(status: string | undefined): TransactionStatus {
  if (!status) {
    logger.warn('Coinbase transaction missing status, defaulting to success');
    return 'success';
  }

  switch (status.toLowerCase()) {
    case 'pending':
      return 'pending';
    case 'ok':
    case 'completed':
    case 'success':
      return 'success';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'failed':
      return 'failed';
    default:
      logger.warn(`Unknown Coinbase status "${status}", defaulting to success`);
      return 'success';
  }
}

/**
 * Factory function that creates a Coinbase exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 *
 * Imperative shell pattern: manages side effects (ccxt API calls)
 * and delegates business logic to pure functions
 */
export function createCoinbaseClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  // Validate credentials
  return ExchangeUtils.validateCredentials(CoinbaseCredentialsSchema, credentials, 'coinbase').andThen(
    ({ apiKey, secret }) => {
      // Additional Coinbase-specific validation
      const validationResult = validateCoinbaseCredentials(apiKey, secret);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      // Normalize PEM-formatted private key by replacing literal \n with actual newlines
      const normalizedSecret = normalizePemKey(secret);

      // Create ccxt instance - side effect captured in closure
      const exchange = new ccxt.coinbaseadvanced({
        apiKey,
        password: '',
        secret: normalizedSecret,
      });

      // Return object with methods that close over the exchange instance
      return ok({
        exchangeId: 'coinbase',

        async *fetchTransactionDataStreaming(
          params?: FetchParams
        ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
          const limit = 100; // Coinbase default limit

          try {
            // Step 1: Fetch all accounts
            const accounts = await exchange.fetchAccounts();
            if (accounts.length === 0) {
              // No accounts - yield completion batch to mark source as checked
              // Prevents unnecessary re-checks on subsequent imports
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
                progress.warn('Skipping Coinbase account without ID');
                accountIndex++;
                continue;
              }

              // Extract cursor for this specific account
              const accountCursorState = params?.cursor?.[accountId];

              // Skip accounts that are already complete
              if (accountCursorState?.metadata?.isComplete) {
                logger.info({ accountId }, 'Skipping completed account');
                accountIndex++;
                continue;
              }

              let accountCursor = accountCursorState?.primary.value as number | undefined;

              // Track cumulative count per account starting from previous cursor's totalFetched
              let cumulativeFetched = (accountCursorState?.totalFetched as number) || 0;

              let pageCount = 0;

              while (true) {
                // Side effect: Fetch from API (uses exchange from closure)
                // Pass account_id in params to specify which account to query
                const ledgerEntries = await exchange.fetchLedger(undefined, accountCursor, limit, {
                  account_id: accountId,
                });

                if (ledgerEntries.length === 0) {
                  // No more data for this account - yield completion batch
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

                // TODO: Inline processItems loop like Kraken (packages/exchange-providers/src/exchanges/kraken/client.ts)
                // Currently blocked by complexity - the metadata mapper is ~140 lines with critical debugged logic:
                // - Correlation ID extraction (40 lines, 5+ transaction types, priority fallback system)
                // - Amount signing with Decimal.js (precision bug took a week to debug, see comment line 293)
                // - Fee extraction for advanced_trade_fill (product_id parsing, duplicate prevention)
                // - Status mapping (custom function)
                //
                // RISK: Inlining this without comprehensive test coverage risks reintroducing subtle bugs
                // in precision handling, correlation ID extraction, or fee accounting.
                //
                // APPROACH WHEN READY:
                // 1. Extract metadata mapper to named function first (processCoinbaseLedgerEntry)
                // 2. Add comprehensive unit tests for all transaction types
                // 3. Then inline the loop with high confidence
                //
                // CRITICAL: This preserves all complex Coinbase-specific logic:
                // - Fee extraction (advanced_trade_fill commission handling)
                // - Correlation ID extraction (nested type-specific objects)
                // - Amount signing (direction-based with Decimal.toFixed())
                const processResult = ExchangeUtils.processItems(
                  ledgerEntries,
                  // Extractor: Get raw data from ccxt item
                  (item) => ({ ...item }),
                  // Validator: Validate using Zod schema
                  (rawItem) => ExchangeUtils.validateRawData(CoinbaseLedgerEntrySchema, rawItem, 'coinbase'),
                  // Metadata mapper: Extract cursor, externalId, and normalizedData
                  // PRESERVED FROM BATCH IMPLEMENTATION (lines 192-320)
                  (validatedData: CoinbaseLedgerEntry, item) => {
                    const timestamp = Math.floor(validatedData.timestamp); // Ensure integer

                    // Extract and validate raw Coinbase data from CCXT's info property
                    // CCXT returns Coinbase Consumer API v2 transactions

                    const rawInfo = RawCoinbaseLedgerEntrySchema.parse(item.info);

                    // Extract correlation ID from type-specific nested object
                    // Different transaction types store correlation IDs in different locations
                    const extractCorrelationId = (): string => {
                      // 1. Try CCXT's referenceId first (most reliable if available)
                      if (validatedData.referenceId) {
                        return validatedData.referenceId;
                      }

                      // 2. Check type-specific nested objects for correlation IDs
                      // Try each transaction type's nested object
                      // Use type assertion since Zod passthrough makes inference difficult
                      interface TypeSpecific {
                        id?: string;
                        order_id?: string;
                        trade_id?: string;
                        transfer_id?: string;
                      }

                      const typeSpecificData: TypeSpecific | undefined =
                        (rawInfo.advanced_trade_fill as TypeSpecific | undefined) ??
                        (rawInfo.buy as TypeSpecific | undefined) ??
                        (rawInfo.sell as TypeSpecific | undefined) ??
                        (rawInfo.send as TypeSpecific | undefined) ??
                        (rawInfo.trade as TypeSpecific | undefined);

                      if (typeSpecificData) {
                        // Priority order for correlation IDs:
                        // 1. id - Used by buy, sell, trade types to group related entries
                        // 2. order_id - Used by advanced_trade_fill to group multiple fills
                        // 3. trade_id - Groups entries from same trade execution
                        // 4. transfer_id - Groups entries from same transfer
                        return (
                          typeSpecificData.id ??
                          typeSpecificData.order_id ??
                          typeSpecificData.trade_id ??
                          typeSpecificData.transfer_id ??
                          validatedData.id
                        );
                      }

                      // 3. Fall back to transaction id for non-correlated entries
                      return validatedData.id;
                    };

                    const correlationId = extractCorrelationId();

                    // Map CoinbaseLedgerEntry to ExchangeLedgerEntry with Coinbase-specific normalization
                    // Additional Coinbase-specific fields (direction, account, referenceAccount, before, after) remain in rawData only
                    //
                    // IMPORTANT: ExchangeLedgerEntry requires signed amounts (negative for outflows, positive for inflows)
                    // CCXT provides direction field ('in' or 'out') with absolute amounts, so we need to apply the sign
                    // Coinbase's ledger amounts arrive as JavaScript numbers. Using Number#toFixed()
                    // (our previous implementation) accidentally defaulted to zero decimal places,
                    // truncating values like 18.1129667 UNI to "18" and throwing balances off.
                    // Keep everything in Decimal to preserve the exact ledger precision.
                    const amountDecimal = parseDecimal(validatedData.amount);
                    const absoluteAmount = amountDecimal.abs();
                    const signedAmountDecimal =
                      validatedData.direction === 'out' ? absoluteAmount.negated() : absoluteAmount;
                    const signedAmount = signedAmountDecimal.toFixed();

                    // Extract fee information
                    // For advanced_trade_fill: CCXT doesn't map commission to fee, so extract it manually
                    // For other types: use CCXT's normalized fee field
                    let feeAmount: string | undefined;
                    let feeCurrency: string | undefined;

                    if (validatedData.type === 'advanced_trade_fill' && rawInfo.advanced_trade_fill?.commission) {
                      // Commission is paid in the quote currency (second part of product_id)
                      // e.g., "BTC-USDC" -> commission paid in USDC

                      if (rawInfo.advanced_trade_fill.product_id) {
                        const parts = rawInfo.advanced_trade_fill.product_id.split('-');

                        feeCurrency = parts[1]; // Quote currency

                        // Only include fee on the entry that matches the fee currency
                        // This avoids duplicates - each fill creates 2 entries (base + quote)
                        // but we only want to record the fee once (on the quote currency side)
                        if (validatedData.currency === feeCurrency) {
                          feeAmount = rawInfo.advanced_trade_fill.commission;
                        }
                      }
                    } else {
                      // Use CCXT's normalized fee for other transaction types
                      feeAmount =
                        validatedData.fee?.cost !== undefined
                          ? parseDecimal(validatedData.fee.cost).toFixed()
                          : undefined;
                      feeCurrency = validatedData.fee?.currency;
                    }

                    const normalizedData: ExchangeLedgerEntry = {
                      id: validatedData.id,
                      correlationId,
                      timestamp,
                      type: validatedData.type,
                      asset: validatedData.currency,
                      amount: signedAmount,
                      fee: feeAmount,
                      feeCurrency,
                      status: mapCoinbaseStatus(validatedData.status),
                    };

                    return {
                      cursorUpdates: {
                        [accountId]: {
                          primary: { type: 'timestamp', value: timestamp },
                          lastTransactionId: validatedData.id,
                          totalFetched: 1,
                          metadata: {
                            providerName: 'coinbase',
                            updatedAt: Date.now(),
                            accountId,
                          },
                        },
                      },
                      externalId: validatedData.id,
                      normalizedData,
                    };
                  },
                  'coinbase'
                );

                if (processResult.isErr()) {
                  // Validation failed - yield error with successful items from this batch
                  const partialError = processResult.error;

                  // If we have successful items, yield them first
                  if (partialError.successfulItems.length > 0) {
                    const lastCursor = partialError.lastSuccessfulCursorUpdates?.[accountId];
                    cumulativeFetched += partialError.successfulItems.length;

                    // Build cursor with correct cumulative totalFetched
                    const cursorToYield = lastCursor
                      ? {
                          ...lastCursor,
                          totalFetched: cumulativeFetched, // Use cumulative count
                          metadata: {
                            ...lastCursor.metadata,
                            providerName: 'coinbase',
                            updatedAt: Date.now(),
                            accountId,
                          },
                        }
                      : {
                          primary: { type: 'timestamp' as const, value: accountCursor ?? Date.now() },
                          lastTransactionId:
                            partialError.successfulItems[partialError.successfulItems.length - 1]?.externalId ?? '',
                          totalFetched: cumulativeFetched,
                          metadata: {
                            providerName: 'coinbase',
                            updatedAt: Date.now(),
                            accountId,
                          },
                        };

                    yield ok({
                      transactions: partialError.successfulItems,
                      operationType: accountId,
                      cursor: cursorToYield,
                      isComplete: false,
                    });
                  }

                  // Then yield the error
                  yield err(
                    new Error(
                      `Validation failed for account ${accountId} after ${partialError.successfulItems.length} items in batch: ${partialError.message}`
                    )
                  );
                  return;
                }

                // Yield successful batch
                const { transactions, cursorUpdates } = processResult.value;
                cumulativeFetched += transactions.length;
                pageCount++;

                // Report progress
                progress.update(
                  `Account ${accountIndex + 1}/${accounts.length} (${accountId}): page ${pageCount}`,
                  cumulativeFetched
                );

                // Update cursor with cumulative totalFetched
                const currentAccountCursor = cursorUpdates[accountId];

                // Check if this is the last page for this account
                const isComplete = ledgerEntries.length < limit;

                if (currentAccountCursor) {
                  currentAccountCursor.totalFetched = cumulativeFetched;
                  if (currentAccountCursor.metadata) {
                    currentAccountCursor.metadata.updatedAt = Date.now();
                    // CRITICAL: Mark account complete to prevent reprocessing on resume
                    if (isComplete) {
                      currentAccountCursor.metadata.isComplete = true;
                    }
                  }
                }

                yield ok({
                  transactions,
                  operationType: accountId,
                  cursor: currentAccountCursor ?? {
                    primary: { type: 'timestamp', value: accountCursor ?? Date.now() },
                    lastTransactionId: transactions[transactions.length - 1]?.externalId ?? '',
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

                // If we got less than the limit, we've reached the end for this account
                if (isComplete) break;

                // Update since timestamp for next page (add 1ms to avoid duplicate)
                if (currentAccountCursor) {
                  accountCursor = (currentAccountCursor.primary.value as number) + 1;
                }
              }

              accountIndex++;
            }
          } catch (error) {
            // Network/API error during fetch - yield error
            yield err(error instanceof Error ? error : new Error(`Coinbase API error: ${getErrorMessage(error)}`));
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
