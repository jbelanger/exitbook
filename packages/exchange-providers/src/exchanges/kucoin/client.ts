import type { ExchangeCredentials } from '@exitbook/core';
import { ExchangeCredentialsSchema, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { errAsync, ok } from 'neverthrow';

import * as ExchangeUtils from '../../core/exchange-utils.js';
import type { BalanceSnapshot, FetchBatchResult, FetchParams, IExchangeClient } from '../../core/types.js';

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
  return ExchangeUtils.validateCredentials(ExchangeCredentialsSchema, credentials, 'kucoin').map(
    ({ apiKey, apiSecret, apiPassphrase }) => {
      // Create ccxt instance - side effect captured in closure
      const exchange = new ccxt.kucoin({
        apiKey,
        secret: apiSecret,
        password: apiPassphrase!, // KuCoin uses 'password' field for passphrase in ccxt
      });

      logger.info('KuCoin client created successfully');

      // Return object with methods that close over the exchange instance
      return {
        exchangeId: 'kucoin',

        async *fetchTransactionDataStreaming(
          _params?: FetchParams
        ): AsyncIterableIterator<Result<FetchBatchResult, Error>> {
          yield errAsync(
            new Error(
              'KuCoin API import is not supported due to API limitations (1-day query window, 365-day max lookback). ' +
                'Use CSV export from KuCoin instead.'
            )
          );
          // KuCoin API import is not supported due to severe limitations (1-day query window, 365-day lookback)
          // that made reliable historical data import impossible. Only CSV import is supported.
          // See packages/ingestion/src/infrastructure/exchanges/kucoin/ for the CSV importer implementation.
        },

        async fetchBalance(): Promise<Result<BalanceSnapshot, Error>> {
          try {
            // KuCoin has multiple account types (main, spot/trade, margin, etc.)
            // Fetch balances from all account types and combine them
            const accountTypes = ['main', 'trade', 'margin', 'isolated'];
            const allBalances: Record<string, number> = {};

            for (const accountType of accountTypes) {
              try {
                const balance = await exchange.fetchBalance({ type: accountType });
                const processed = ExchangeUtils.processCCXTBalance(balance);

                // Merge balances from this account type (processCCXTBalance returns Record<string, string>)
                for (const [asset, amountStr] of Object.entries(processed)) {
                  const amount = parseFloat(amountStr);
                  allBalances[asset] = (allBalances[asset] || 0) + amount;
                }

                logger.debug(`Fetched ${Object.keys(processed).length} assets from ${accountType} account`);
              } catch (error) {
                // Some account types might not be enabled, that's okay
                logger.debug(`Could not fetch ${accountType} account balance: ${String(error)}`);
              }
            }

            // Convert combined balances back to strings with consistent precision
            const balancesAsStrings: Record<string, string> = {};
            for (const [asset, amount] of Object.entries(allBalances)) {
              // Use toFixed to avoid scientific notation for small numbers
              balancesAsStrings[asset] = amount.toFixed(18).replace(/\.?0+$/, '');
            }

            return ok({ balances: balancesAsStrings, timestamp: Date.now() });
          } catch (error) {
            return wrapError(error, 'Failed to fetch KuCoin balance');
          }
        },
      };
    }
  );
}
