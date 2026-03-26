import path from 'node:path';

import type { CreateNamedAccountInput, UpdateNamedAccountInput } from '@exitbook/accounts';
import type { Account, ExchangeCredentials } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { type AdapterRegistry, isUtxoAdapter } from '@exitbook/ingestion';

import type { AccountAddCommandOptions, AccountUpdateCommandOptions } from './accounts-option-schemas.js';

export function normalizeCsvDir(csvDir: string): string {
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
  };
  if (options.apiPassphrase !== undefined) {
    credentials.apiPassphrase = options.apiPassphrase;
  }

  return ok({
    profileId,
    name,
    accountType: 'exchange-api',
    platformKey: options.exchange,
    identifier: options.apiKey,
    credentials,
  });
}

export function buildUpdatedAccountDraft(
  account: Account,
  options: AccountUpdateCommandOptions,
  registry: AdapterRegistry
): Result<UpdateNamedAccountInput, Error> {
  const hasApiFlags =
    options.apiKey !== undefined || options.apiSecret !== undefined || options.apiPassphrase !== undefined;
  const hasCsvDir = options.csvDir !== undefined;
  const hasProvider = options.provider !== undefined;
  const hasXpubGap = options.xpubGap !== undefined;

  if (!hasApiFlags && !hasCsvDir && !hasProvider && !hasXpubGap) {
    return err(new Error('No account config changes were provided'));
  }

  switch (account.accountType) {
    case 'exchange-api': {
      if (hasCsvDir || hasProvider || hasXpubGap) {
        return err(
          new Error(
            'exchange-api accounts can only be updated with API credential flags (--api-key, --api-secret, --api-passphrase)'
          )
        );
      }

      const nextApiKey = options.apiKey ?? account.credentials?.apiKey;
      const nextApiSecret = options.apiSecret ?? account.credentials?.apiSecret;
      const nextApiPassphrase = options.apiPassphrase ?? account.credentials?.apiPassphrase;

      if (!nextApiKey || !nextApiSecret) {
        return err(new Error('exchange-api accounts require both apiKey and apiSecret'));
      }

      const credentialsChanged =
        nextApiKey !== account.credentials?.apiKey ||
        nextApiSecret !== account.credentials?.apiSecret ||
        nextApiPassphrase !== account.credentials?.apiPassphrase;
      if (!credentialsChanged) {
        return err(new Error('No account config changes were provided'));
      }

      const credentials: ExchangeCredentials = {
        apiKey: nextApiKey,
        apiSecret: nextApiSecret,
      };
      if (nextApiPassphrase !== undefined) {
        credentials.apiPassphrase = nextApiPassphrase;
      }

      return ok({
        credentials,
        identifier: nextApiKey,
        resetCursor: nextApiKey !== account.identifier,
      });
    }

    case 'exchange-csv': {
      if (hasApiFlags || hasProvider || hasXpubGap) {
        return err(new Error('exchange-csv accounts can only be updated with --csv-dir'));
      }
      if (!options.csvDir) {
        return err(new Error('--csv-dir is required to update exchange-csv accounts'));
      }

      const identifier = normalizeCsvDir(options.csvDir);
      if (identifier === account.identifier) {
        return err(new Error('No account config changes were provided'));
      }

      return ok({
        identifier,
        resetCursor: identifier !== account.identifier,
      });
    }

    case 'blockchain': {
      if (hasApiFlags || hasCsvDir) {
        return err(new Error('blockchain accounts can only be updated with --provider or --xpub-gap'));
      }

      const updates: UpdateNamedAccountInput = {};
      if (hasProvider && options.provider !== account.providerName) {
        updates.providerName = options.provider;
      }

      if (options.xpubGap !== undefined) {
        const adapterResult = registry.getBlockchain(account.platformKey.toLowerCase());
        if (adapterResult.isErr()) {
          return err(adapterResult.error);
        }

        const adapter = adapterResult.value;
        const isXpub = isUtxoAdapter(adapter) && adapter.isExtendedPublicKey(account.identifier);
        if (!isXpub) {
          return err(new Error('--xpub-gap can only be updated for extended public keys (xpubs)'));
        }

        const existingXpubMetadata = account.metadata?.xpub;
        if (existingXpubMetadata && options.xpubGap < existingXpubMetadata.gapLimit) {
          return err(new Error('--xpub-gap cannot be decreased once an xpub account has been configured'));
        }

        updates.metadata = {
          xpub: {
            gapLimit: options.xpubGap,
            lastDerivedAt: existingXpubMetadata?.lastDerivedAt ?? 0,
            derivedCount: existingXpubMetadata?.derivedCount ?? 0,
          },
        };
      }

      if (Object.keys(updates).length === 0) {
        return err(new Error('No account config changes were provided'));
      }

      return ok(updates);
    }
  }
}
