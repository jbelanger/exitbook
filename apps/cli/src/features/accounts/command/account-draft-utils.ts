import path from 'node:path';

import type { CreateNamedAccountInput } from '@exitbook/accounts';
import type { ExchangeCredentials } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { type AdapterRegistry, isUtxoAdapter } from '@exitbook/ingestion';

import type { AccountAddCommandOptions } from './accounts-option-schemas.js';

function normalizeCsvDir(csvDir: string): string {
  return path.normalize(csvDir).replace(/[/\\]+$/, '');
}

export function buildNamedAccountDraft(
  name: string,
  profileId: number,
  options: AccountAddCommandOptions,
  registry: AdapterRegistry
): Result<CreateNamedAccountInput, Error> {
  if (options.blockchain) {
    if (!options.address) {
      return err(new Error('--address is required for blockchain accounts'));
    }

    const adapterResult = registry.getBlockchain(options.blockchain.toLowerCase());
    if (adapterResult.isErr()) {
      return err(adapterResult.error);
    }

    const adapter = adapterResult.value;
    const normalizedAddressResult = adapter.normalizeAddress(options.address);
    if (normalizedAddressResult.isErr()) {
      return err(normalizedAddressResult.error);
    }

    const normalizedAddress = normalizedAddressResult.value;
    const isXpub = isUtxoAdapter(adapter) && adapter.isExtendedPublicKey(normalizedAddress);
    if (options.xpubGap !== undefined && !isXpub) {
      return err(new Error('--xpub-gap can only be used with extended public keys (xpubs)'));
    }

    return ok({
      profileId,
      name,
      accountType: 'blockchain',
      platformKey: options.blockchain,
      identifier: normalizedAddress,
      providerName: options.provider,
      metadata: isXpub
        ? {
            xpub: {
              gapLimit: options.xpubGap ?? 20,
              lastDerivedAt: 0,
              derivedCount: 0,
            },
          }
        : undefined,
    });
  }

  if (!options.exchange) {
    return err(new Error('Either --exchange or --blockchain is required'));
  }

  const exchangeAdapterResult = registry.getExchange(options.exchange.toLowerCase());
  if (exchangeAdapterResult.isErr()) {
    return err(exchangeAdapterResult.error);
  }
  const exchangeAdapter = exchangeAdapterResult.value;

  if (options.csvDir) {
    if (!exchangeAdapter.capabilities.supportsCsv) {
      return err(new Error(`Exchange "${options.exchange}" does not support CSV import`));
    }

    return ok({
      profileId,
      name,
      accountType: 'exchange-csv',
      platformKey: options.exchange,
      identifier: normalizeCsvDir(options.csvDir),
    });
  }

  if (!exchangeAdapter.capabilities.supportsApi) {
    return err(new Error(`Exchange "${options.exchange}" does not support API import`));
  }
  if (!options.apiKey || !options.apiSecret) {
    return err(new Error('--api-key and --api-secret are required for exchange API accounts'));
  }

  const credentials: ExchangeCredentials = {
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    apiPassphrase: options.apiPassphrase,
  };

  return ok({
    profileId,
    name,
    accountType: 'exchange-api',
    platformKey: options.exchange,
    identifier: options.apiKey,
    credentials,
  });
}
