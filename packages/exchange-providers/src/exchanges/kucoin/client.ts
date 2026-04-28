import type { Result } from '@exitbook/foundation';
import { err, ok, resultDo, wrapError } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import * as ccxt from 'ccxt';
import { Decimal } from 'decimal.js';

import { validateCredentials } from '../../client/schema-validation.js';
import type { ExchangeClientCredentials } from '../../contracts/exchange-credentials.js';
import type {
  ExchangeBalanceSnapshot,
  ExchangeClientTransactionBatch,
  ExchangeClientFetchParams,
  IExchangeClient,
} from '../../contracts/index.js';
import { normalizeCCXTBalance } from '../shared/ccxt-balance.js';

import { KuCoinCredentialsSchema } from './contracts.js';

/**
 * Factory function that creates a KuCoin exchange client
 * Returns a Result containing an object that implements IExchangeClient interface
 *
 * Imperative shell pattern: manages side effects (ccxt API calls)
 * and delegates business logic to pure functions
 */
export function createKuCoinClient(credentials: ExchangeClientCredentials): Result<IExchangeClient, Error> {
  const logger = getLogger('KuCoinClient');

  return resultDo(function* () {
    const { apiKey, apiSecret, apiPassphrase } = yield* validateCredentials(
      KuCoinCredentialsSchema,
      credentials,
      'kucoin'
    );

    // Create ccxt instance - side effect captured in closure
    const exchange = new ccxt.kucoin({
      apiKey,
      secret: apiSecret,
      password: apiPassphrase, // KuCoin uses 'password' field for passphrase in ccxt
    });

    logger.info('KuCoin client created successfully');

    return {
      exchangeId: 'kucoin',

      async *fetchTransactionDataStreaming(
        _params?: ExchangeClientFetchParams
      ): AsyncIterableIterator<Result<ExchangeClientTransactionBatch, Error>> {
        yield err(
          new Error(
            'KuCoin API import is not supported due to API limitations (1-day query window, 365-day max lookback). ' +
              'Use CSV export from KuCoin instead.'
          )
        );
        // KuCoin API import is not supported due to severe limitations (1-day query window, 365-day lookback)
        // that made reliable historical data import impossible. Only CSV import is supported.
        // See packages/ingestion/src/sources/exchanges/kucoin/ for the CSV importer implementation.
      },

      async fetchBalance(): Promise<Result<ExchangeBalanceSnapshot, Error>> {
        try {
          const liquidAccountTypes = ['main', 'trade'];
          const liquidBalances: Record<string, Decimal> = {};

          for (const accountType of liquidAccountTypes) {
            try {
              const balance = await exchange.fetchBalance({ type: accountType });
              const processed = normalizeCCXTBalance(balance);

              for (const [asset, amountStr] of Object.entries(processed)) {
                const amount = new Decimal(amountStr);
                liquidBalances[asset] = (liquidBalances[asset] ?? new Decimal(0)).plus(amount);
              }

              logger.debug(`Fetched ${Object.keys(processed).length} assets from ${accountType} account`);
            } catch (error) {
              return wrapError(error, `Failed to fetch KuCoin ${accountType} account balance`);
            }
          }

          const balancesAsStrings: Record<string, string> = {};
          for (const [asset, amount] of Object.entries(liquidBalances)) {
            balancesAsStrings[asset] = amount.toFixed();
          }

          return ok({ balances: balancesAsStrings, timestamp: Date.now() });
        } catch (error) {
          return wrapError(error, 'Failed to fetch KuCoin balance');
        }
      },
    };
  });
}
