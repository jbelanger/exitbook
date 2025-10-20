import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

import { createCoinbaseClient } from '../coinbase/client.ts';
import { createKrakenClient } from '../kraken/client.ts';
import { createKuCoinClient } from '../kucoin/client.ts';

import type { ExchangeCredentials, IExchangeClient } from './types.ts';

/**
 * Create an exchange client for the specified exchange.
 * Factory function that dynamically selects the appropriate client creator.
 */

const exchangeFactories: Record<string, (credentials: ExchangeCredentials) => Result<IExchangeClient, Error>> = {
  kraken: createKrakenClient,
  kucoin: createKuCoinClient,
  coinbase: createCoinbaseClient,
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
