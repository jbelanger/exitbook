import type { ExchangeCredentials } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

import { createCoinbaseClient } from '../exchanges/coinbase/client.js';
import { createKrakenClient } from '../exchanges/kraken/client.js';
import { createKuCoinClient } from '../exchanges/kucoin/client.js';

import type { IExchangeClient } from './types.js';

/**
 * Create an exchange client for the specified exchange.
 * Factory function that dynamically selects the appropriate client creator.
 */

const exchangeFactories: Record<string, (credentials: ExchangeCredentials) => Result<IExchangeClient, Error>> = {
  kraken: createKrakenClient,
  coinbase: createCoinbaseClient,
  kucoin: createKuCoinClient,
  // KuCoin: API integration was removed due to severe API limitations that made reliable data import impossible.
  // The KuCoin API enforces a 1-day maximum query time range and only allows retrieving data from the past 365 days.
  // This required complex backward pagination through each 24-hour period individually, making historical imports
  // slow, error-prone, and incomplete for accounts older than one year. In contrast, KuCoin's CSV export provides
  // complete historical data without time restrictions. Users should use the CSV import path (--csv-dir) which now
  // supports efficient streaming for large datasets. See packages/ingestion/src/sources/exchanges/kucoin/
  // for the CSV importer implementation.
};

export function createExchangeClient(
  exchangeName: string,
  credentials: ExchangeCredentials
): Result<IExchangeClient, Error> {
  const normalizedName = exchangeName.toLowerCase();

  // KuCoin API integration was removed due to severe limitations (1-day query window, 365-day lookback)
  // that made reliable historical data import impossible. Only CSV import is supported.
  // if (normalizedName === 'kucoin') {
  //   return err(
  //     new Error(
  //       'KuCoin API import is not supported due to API limitations (1-day query window, 365-day max lookback). ' +
  //         'Use CSV export from KuCoin instead.'
  //     )
  //   );
  // }

  const factory = exchangeFactories[normalizedName];
  if (factory) {
    return factory(credentials);
  }
  const supported = Object.keys(exchangeFactories).join(', ');
  return err(new Error(`Unknown exchange: ${exchangeName}. Supported exchanges: ${supported}`));
}
