import type { CursorState, TransactionStatus } from '@exitbook/core';
import { getErrorMessage, wrapError, type ExternalTransaction } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { emitProgress } from '@exitbook/ui';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { PartialImportError } from '../../core/errors.js';
import * as ExchangeUtils from '../../core/exchange-utils.js';
import type { ExchangeLedgerEntry } from '../../core/schemas.js';
import type {
  BalanceSnapshot,
  ExchangeCredentials,
  FetchParams,
  FetchTransactionDataResult,
  IExchangeClient,
} from '../../core/types.js';

import { KuCoinCredentialsSchema, KuCoinLedgerEntrySchema, type KuCoinLedgerEntry } from './schemas.js';

const logger = getLogger('KuCoinClient');

/**
 * Map KuCoin status to universal status format
 */
function mapKuCoinStatus(status: string | undefined): TransactionStatus {
  if (!status) {
    emitProgress({
      type: 'warning',
      message: 'KuCoin transaction missing status - defaulting to "success"',
    });
    logger.warn('KuCoin transaction missing status, defaulting to success');
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
      emitProgress({
        type: 'warning',
        message: `Unknown KuCoin transaction status: "${status}" - defaulting to "success"`,
      });
      logger.warn(`Unknown KuCoin status "${status}", defaulting to success`);
      return 'success';
  }
}

/**
 * Factory function that creates a KuCoin exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 *
 * Imperative shell pattern: manages side effects (ccxt API calls)
 * and delegates business logic to pure functions
 */
export function createKuCoinClient(credentials: ExchangeCredentials): Result<IExchangeClient, Error> {
  const logger = getLogger('KuCoinClient');

  // Validate credentials
  return ExchangeUtils.validateCredentials(KuCoinCredentialsSchema, credentials, 'kucoin').map(
    ({ apiKey, secret, passphrase }) => {
      // Create ccxt instance - side effect captured in closure
      const exchange = new ccxt.kucoin({
        apiKey,
        secret,
        password: passphrase, // KuCoin uses 'password' field for passphrase in ccxt
      });

      logger.info('KuCoin client created successfully');

      // Return object with methods that close over the exchange instance
      return {
        exchangeId: 'kucoin',

        async fetchTransactionData(params?: FetchParams): Promise<Result<FetchTransactionDataResult, Error>> {
          const allTransactions: ExternalTransaction[] = [];
          let lastSuccessfulCursorUpdates: Record<string, CursorState> = {};

          // Extract cursor state
          const ledgerCursor = params?.cursor?.['ledger'];

          // Fetch ledger entries - this includes ALL balance changes:
          // deposits, withdrawals, trades, fees, rebates, etc.
          //
          // KuCoin API limitations:
          // - Query time range cannot exceed 1 day (86400000 milliseconds)
          // - Can only retrieve data from past 365 days
          const limit = 500; // KuCoin allows up to 500 items per request
          const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
          const ONE_YEAR = 365 * ONE_DAY;
          const now = Date.now();

          // Start from cursor (if resuming) or 1 year ago (KuCoin's max lookback)
          const ONE_YEAR_AGO = now - ONE_YEAR;
          const currentStartTime = (ledgerCursor?.metadata?.startTime as number) || ONE_YEAR_AGO;

          // Track cumulative count starting from previous cursor's totalFetched
          let cumulativeFetched = (ledgerCursor?.totalFetched as number) || 0;

          try {
            emitProgress({
              type: 'started',
              message: `Fetching KuCoin ledger from ${new Date(currentStartTime).toISOString()} to ${new Date(now).toISOString()}`,
              data: {
                metadata: {
                  startTime: currentStartTime,
                  endTime: now,
                  timeRangeDays: Math.floor((now - currentStartTime) / ONE_DAY),
                },
              },
            });

            // KuCoin fetches backwards from 'until' timestamp
            // Only specify 'until' and it automatically fetches previous 24 hours
            let currentEnd = now;
            let dayCount = 0;
            let batchCount = 0;

            // Process data in 1-day batches going backwards in time
            while (currentEnd > currentStartTime) {
              dayCount++;
              batchCount = 0;
              const currentDate = new Date(currentEnd).toISOString().split('T')[0];
              logger.debug(`Fetching ledger ending at: ${new Date(currentEnd).toISOString()}`);

              // Fetch all data for the 24-hour period ending at currentEnd
              while (true) {
                // Side effect: Fetch from API (uses exchange from closure)
                // Only use 'until' parameter - KuCoin automatically fetches previous 24 hours
                logger.debug(`Calling exchange.fetchLedger(undefined, undefined, ${limit}, { until: ${currentEnd} })`);
                const ledgerEntries = await exchange.fetchLedger(undefined, undefined, limit, {
                  until: currentEnd,
                });
                batchCount++;

                logger.debug(`Received ${ledgerEntries.length} ledger entries for this batch`);

                if (ledgerEntries.length === 0) {
                  logger.debug('No more entries for this time period');
                  break;
                }

                // Find oldest timestamp in this batch to know where to continue from
                const oldestTimestamp = Math.min(...ledgerEntries.map((e) => e.timestamp || 0));

                // Delegate to pure function for processing
                const processResult = ExchangeUtils.processItems(
                  ledgerEntries,
                  // Extractor: Get raw data from ccxt item
                  (item) => ({ ...item }),
                  // Validator: Validate using Zod schema
                  (rawItem) => ExchangeUtils.validateRawData(KuCoinLedgerEntrySchema, rawItem, 'kucoin'),
                  // Metadata mapper: Extract cursor, externalId, and normalizedData
                  (validatedData: KuCoinLedgerEntry, _item) => {
                    const timestamp = Math.floor(validatedData.timestamp); // Ensure integer

                    // Map KuCoinLedgerEntry to ExchangeLedgerEntry with KuCoin-specific normalization
                    // Additional KuCoin-specific fields (direction, account, referenceAccount, before, after) remain in rawData only
                    const normalizedData: ExchangeLedgerEntry = {
                      id: validatedData.id,
                      correlationId: validatedData.referenceId || validatedData.id,
                      timestamp,
                      type: validatedData.type,
                      asset: validatedData.currency,
                      amount: validatedData.amount, // Already a string from DecimalStringSchema
                      fee: validatedData.fee?.cost, // Already a string from DecimalStringSchema
                      feeCurrency: validatedData.fee?.currency,
                      status: mapKuCoinStatus(validatedData.status),
                    };

                    return {
                      cursorUpdates: {
                        ledger: {
                          primary: { type: 'timestamp', value: timestamp },
                          lastTransactionId: validatedData.id,
                          totalFetched: 1,
                          metadata: {
                            providerName: 'kucoin',
                            updatedAt: Date.now(),
                            startTime: currentStartTime,
                            endTime: currentEnd,
                          },
                        },
                      },
                      externalId: validatedData.id,
                      normalizedData,
                    };
                  },
                  'kucoin'
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
                      partialError.lastSuccessfulCursorUpdates
                    )
                  );
                }

                // Accumulate successful results
                const { transactions, cursorUpdates } = processResult.value;
                allTransactions.push(...transactions);

                // Update cumulative count
                cumulativeFetched += transactions.length;

                if (transactions.length > 0) {
                  emitProgress({
                    type: 'log',
                    message: `Fetched batch ${batchCount} for ${currentDate}: ${transactions.length} transactions (${cumulativeFetched} total)`,
                    data: {
                      current: cumulativeFetched,
                      metadata: {
                        date: currentDate,
                        batchCount,
                        batchSize: transactions.length,
                        totalTransactions: cumulativeFetched,
                        dayCount,
                      },
                    },
                  });
                }

                // Update cursor with cumulative totalFetched
                if (cursorUpdates['ledger']) {
                  cursorUpdates['ledger'].totalFetched = cumulativeFetched;
                }
                lastSuccessfulCursorUpdates = cursorUpdates;

                // If we got less than the limit, we've fetched all data for this period
                if (ledgerEntries.length < limit) {
                  logger.debug('Received less than limit, moving to previous 24-hour period');
                  break;
                }

                // Continue with older data in same 24-hour window
                currentEnd = oldestTimestamp - 1;
              }

              // Move to previous day (24 hours earlier)
              currentEnd = currentEnd - ONE_DAY;

              // Log progress every 30 days
              if (dayCount % 30 === 0) {
                emitProgress({
                  type: 'progress',
                  message: `Progress: Processed ${dayCount} days, ${cumulativeFetched} transactions`,
                  data: {
                    current: dayCount,
                    total: Math.floor((now - currentStartTime) / ONE_DAY),
                    metadata: { totalTransactions: cumulativeFetched },
                  },
                });
              }
            }

            emitProgress({
              type: 'completed',
              message: `Completed KuCoin fetch: ${allTransactions.length} transactions (${dayCount} days processed)`,
              data: {
                total: allTransactions.length,
                metadata: { daysProcessed: dayCount },
              },
            });

            logger.info(`KuCoin fetch completed successfully: ${allTransactions.length} total transactions`);
            return ok({ transactions: allTransactions, cursorUpdates: lastSuccessfulCursorUpdates });
          } catch (error) {
            // Log detailed error information
            logger.error({ error }, 'KuCoin API error occurred');

            // If it's a ccxt error, log additional details
            if (error && typeof error === 'object' && 'constructor' in error) {
              const errorName = error.constructor.name;
              logger.error(`ccxt error type: ${errorName}`);

              // Log common ccxt error properties
              if ('message' in error) logger.error(`Error message: ${String(error.message)}`);
              if ('code' in error) logger.error(`Error code: ${String(error.code)}`);
              if ('statusCode' in error) logger.error(`HTTP status: ${String(error.statusCode)}`);

              // Log response body which contains KuCoin's actual error message
              if ('body' in error) logger.error(`Response body: ${String(error.body)}`);
            }

            // Network/API error during fetch - return partial results if we have any
            if (allTransactions.length > 0) {
              logger.warn(`Returning partial results: ${allTransactions.length} transactions before error`);
              return err(
                new PartialImportError(
                  `Fetch failed after processing ${allTransactions.length} transactions: ${getErrorMessage(error)}`,
                  allTransactions,
                  { startTime: currentStartTime, limit },
                  lastSuccessfulCursorUpdates
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
            return wrapError(error, 'Failed to fetch KuCoin balance');
          }
        },
      };
    }
  );
}
