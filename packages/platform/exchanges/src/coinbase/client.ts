import { getErrorMessage, wrapError, type RawTransactionWithMetadata } from '@exitbook/core';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type z from 'zod';

import { PartialImportError } from '../core/errors.ts';
import * as ExchangeUtils from '../core/exchange-utils.ts';
import type { ExchangeLedgerEntry } from '../core/schemas.ts';
import type { BalanceSnapshot, ExchangeCredentials, FetchParams, IExchangeClient } from '../core/types.ts';

import { CoinbaseCredentialsSchema, CoinbaseLedgerEntrySchema, RawCoinbaseLedgerEntrySchema } from './schemas.ts';
import type { RawCoinbaseLedgerEntry } from './types.ts';

export type CoinbaseLedgerEntry = z.infer<typeof CoinbaseLedgerEntrySchema>;

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
function mapCoinbaseStatus(status: string | undefined): 'pending' | 'ok' | 'canceled' | 'failed' {
  if (!status) return 'ok';

  switch (status.toLowerCase()) {
    case 'pending':
      return 'pending';
    case 'ok':
    case 'completed':
    case 'success':
      return 'ok';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'failed':
      return 'failed';
    default:
      return 'ok';
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

        async fetchTransactionData(params?: FetchParams): Promise<Result<RawTransactionWithMetadata[], Error>> {
          const allTransactions: RawTransactionWithMetadata[] = [];
          const currentCursor = { ...(params?.cursor || {}) };

          // Fetch ledger entries - this includes ALL balance changes:
          // deposits, withdrawals, trades, fees, rebates, etc.
          // Coinbase Advanced Trade API requires fetching accounts first,
          // then fetching ledger entries for each account
          const limit = 100; // Coinbase default limit

          try {
            // Step 1: Fetch all accounts
            const accounts = await exchange.fetchAccounts();
            if (accounts.length === 0) {
              return ok([]); // No accounts, no transactions
            }

            // Step 2: Fetch ledger entries for each account
            for (const account of accounts) {
              const accountId = account.id;
              if (!accountId) continue;

              let accountCursor = currentCursor[accountId];

              while (true) {
                // Side effect: Fetch from API (uses exchange from closure)
                // Pass account_id in params to specify which account to query
                const ledgerEntries = await exchange.fetchLedger(undefined, accountCursor, limit, {
                  account_id: accountId,
                });

                if (ledgerEntries.length === 0) break;

                // Delegate to pure function for processing
                const processResult = ExchangeUtils.processItems(
                  ledgerEntries,
                  // Extractor: Get raw data from ccxt item
                  (item) => ({ ...item }),
                  // Validator: Validate using Zod schema
                  (rawItem) => ExchangeUtils.validateRawData(CoinbaseLedgerEntrySchema, rawItem, 'coinbase'),
                  // Metadata mapper: Extract cursor, externalId, and normalizedData
                  (validatedData: CoinbaseLedgerEntry, item) => {
                    const timestamp = Math.floor(validatedData.timestamp); // Ensure integer

                    // Extract and validate raw Coinbase data from CCXT's info property
                    // CCXT returns Coinbase Consumer API v2 transactions

                    const rawInfo = RawCoinbaseLedgerEntrySchema.parse(item.info) as RawCoinbaseLedgerEntry;

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
                    const amountStr = validatedData.amount.toString();
                    const signedAmount =
                      validatedData.direction === 'out'
                        ? amountStr.startsWith('-')
                          ? amountStr
                          : `-${amountStr}`
                        : amountStr;

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
                      feeAmount = validatedData.fee?.cost.toString();
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
                      cursor: { [accountId]: timestamp },
                      externalId: validatedData.id,
                      normalizedData,
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

                // Update cursor with latest timestamp from this batch for this account
                if (processResult.value.length > 0) {
                  const lastItem = processResult.value[processResult.value.length - 1];
                  if (lastItem?.cursor && lastItem.cursor[accountId]) {
                    currentCursor[accountId] = lastItem.cursor[accountId];
                    accountCursor = currentCursor[accountId];
                  }
                }

                // If we got less than the limit, we've reached the end for this account
                if (ledgerEntries.length < limit) break;

                // Update since timestamp for next page (add 1ms to avoid duplicate)
                if (accountCursor) {
                  accountCursor = accountCursor + 1;
                  currentCursor[accountId] = accountCursor;
                }
              }
            }

            return ok(allTransactions);
          } catch (error) {
            // Network/API error during fetch - return partial results if we have any
            if (allTransactions.length > 0) {
              return err(
                new PartialImportError(
                  `Fetch failed after processing ${allTransactions.length} transactions: ${getErrorMessage(error)}`,
                  allTransactions,
                  undefined,
                  currentCursor
                )
              );
            }
            return err(error instanceof Error ? error : new Error(String(error)));
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
