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
};

export function createExchangeClient(
  exchangeName: string,
  credentials: ExchangeCredentials
): Result<IExchangeClient, Error> {
  const normalizedName = exchangeName.toLowerCase();

  const factory = exchangeFactories[normalizedName];
  if (factory) {
    return factory(credentials);
  }
  const supported = Object.keys(exchangeFactories).join(', ');
  return err(new Error(`Unknown exchange: ${exchangeName}. Supported exchanges: ${supported}`));
}
