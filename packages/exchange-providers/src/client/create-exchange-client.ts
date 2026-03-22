import type { Result } from '@exitbook/foundation';
import { err } from '@exitbook/foundation';

import type { ExchangeClientCredentials } from '../contracts/exchange-credentials.js';
import type { IExchangeClient } from '../contracts/index.js';
import { createCoinbaseClient } from '../exchanges/coinbase/index.js';
import { createKrakenClient } from '../exchanges/kraken/index.js';
import { createKuCoinClient } from '../exchanges/kucoin/index.js';

/**
 * Create an exchange client for the specified exchange.
 * Dynamically selects the appropriate client creator.
 */

type ExchangeClientFactory = (credentials: ExchangeClientCredentials) => Result<IExchangeClient, Error>;

export interface ExchangeProviderDescriptor {
  name: string;
  displayName: string;
  requiresPassphrase?: boolean | undefined;
  supportsBalance: boolean;
  supportsTransactionStreaming: boolean;
}

interface ExchangeProviderRegistration {
  createClient: ExchangeClientFactory;
  descriptor: ExchangeProviderDescriptor;
}

const exchangeProviderRegistry = {
  coinbase: {
    createClient: createCoinbaseClient,
    descriptor: {
      name: 'coinbase',
      displayName: 'Coinbase',
      supportsBalance: true,
      supportsTransactionStreaming: true,
    },
  },
  kraken: {
    createClient: createKrakenClient,
    descriptor: {
      name: 'kraken',
      displayName: 'Kraken',
      supportsBalance: true,
      supportsTransactionStreaming: true,
    },
  },
  kucoin: {
    createClient: createKuCoinClient,
    descriptor: {
      name: 'kucoin',
      displayName: 'KuCoin',
      requiresPassphrase: true,
      supportsBalance: true,
      supportsTransactionStreaming: false,
    },
  },
} as const satisfies Record<string, ExchangeProviderRegistration>;

export type ExchangeName = keyof typeof exchangeProviderRegistry;

function listSupportedExchangeNames(): ExchangeName[] {
  return Object.keys(exchangeProviderRegistry) as ExchangeName[];
}

export function listExchangeProviders(): ExchangeProviderDescriptor[] {
  return listSupportedExchangeNames().map((exchangeName) => exchangeProviderRegistry[exchangeName].descriptor);
}

function isSupportedExchangeName(exchangeName: string): exchangeName is ExchangeName {
  return exchangeName in exchangeProviderRegistry;
}

export function createExchangeClient(
  exchangeName: string,
  credentials: ExchangeClientCredentials
): Result<IExchangeClient, Error> {
  const normalizedName = exchangeName.toLowerCase();

  if (isSupportedExchangeName(normalizedName)) {
    return exchangeProviderRegistry[normalizedName].createClient(credentials);
  }

  const supported = listSupportedExchangeNames().join(', ');
  return err(new Error(`Unknown exchange: ${exchangeName}. Supported exchanges: ${supported}`));
}
