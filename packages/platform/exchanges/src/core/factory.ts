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
export function createExchangeClient(
  exchangeName: string,
  credentials: ExchangeCredentials
): Result<IExchangeClient, Error> {
  const normalizedName = exchangeName.toLowerCase();

  switch (normalizedName) {
    case 'kraken':
      return createKrakenClient(credentials);
    case 'kucoin':
      return createKuCoinClient(credentials);
    case 'coinbase':
      return createCoinbaseClient(credentials);
    default:
      return err(new Error(`Unknown exchange: ${exchangeName}. Supported exchanges: kraken, kucoin, coinbase`));
  }
}
