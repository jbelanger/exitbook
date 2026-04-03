import path from 'node:path';

import type { CreateAccountInput, UpdateAccountInput } from '@exitbook/accounts';
import type { Account, ExchangeCredentials } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { isUtxoAdapter, type AdapterRegistry } from '@exitbook/ingestion/adapters';

import type { AccountAddCommandOptions, AccountUpdateCommandOptions } from './accounts-option-schemas.js';

interface ExchangeCredentialOptionFields {
  apiKey?: string | undefined;
  apiPassphrase?: string | undefined;
  apiSecret?: string | undefined;
}

function normalizeCsvDir(csvDir: string): string {
  return path.normalize(csvDir).replace(/[/\\]+$/, '');
}

function buildUnknownBlockchainError(name: string): Error {
  return new Error(`Unknown blockchain: ${name}. Run 'exitbook blockchains view' to see supported blockchains.`);
}

function buildUnknownExchangeError(name: string, registry: AdapterRegistry): Error {
  const supportedExchanges = registry.getAllExchanges();
  return new Error(`Unknown exchange: ${name}. Supported exchanges: ${supportedExchanges.join(', ')}`);
}

function buildProvidedExchangeCredentials(
  options: ExchangeCredentialOptionFields
): Result<ExchangeCredentials | undefined, Error> {
  if (options.apiPassphrase !== undefined && (options.apiKey === undefined || options.apiSecret === undefined)) {
    return err(new Error('--api-passphrase requires --api-key and --api-secret'));
  }

  if (options.apiKey === undefined && options.apiSecret === undefined) {
    return ok(undefined);
  }

  if (options.apiKey === undefined || options.apiSecret === undefined) {
    return err(new Error('--api-key and --api-secret must be provided together'));
  }

  return ok({
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    ...(options.apiPassphrase !== undefined ? { apiPassphrase: options.apiPassphrase } : {}),
  });
}

function mergeExchangeCredentials(
  current: ExchangeCredentials | undefined,
  options: ExchangeCredentialOptionFields
): Result<ExchangeCredentials | undefined, Error> {
  const nextApiKey = options.apiKey ?? current?.apiKey;
  const nextApiSecret = options.apiSecret ?? current?.apiSecret;
  const nextApiPassphrase = options.apiPassphrase ?? current?.apiPassphrase;

  if (nextApiKey === undefined && nextApiSecret === undefined && nextApiPassphrase === undefined) {
    return ok(undefined);
  }

  if (nextApiKey === undefined || nextApiSecret === undefined) {
    return err(
      new Error('Stored exchange credentials require both apiKey and apiSecret after applying the requested changes')
    );
  }

  return ok({
    apiKey: nextApiKey,
    apiSecret: nextApiSecret,
    ...(nextApiPassphrase !== undefined ? { apiPassphrase: nextApiPassphrase } : {}),
  });
}

function areExchangeCredentialsEqual(
  left: ExchangeCredentials | undefined,
  right: ExchangeCredentials | undefined
): boolean {
  return (
    left?.apiKey === right?.apiKey &&
    left?.apiSecret === right?.apiSecret &&
    left?.apiPassphrase === right?.apiPassphrase
  );
}

export function buildCreateAccountInput(
  name: string,
  profileId: number,
  options: AccountAddCommandOptions,
  registry: AdapterRegistry
): Result<CreateAccountInput, Error> {
  if (options.blockchain) {
    if (!options.address) {
      return err(new Error('--address is required for blockchain accounts'));
    }

    const adapterResult = registry.getBlockchain(options.blockchain.toLowerCase());
    if (adapterResult.isErr()) {
      return err(buildUnknownBlockchainError(options.blockchain));
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
    return err(buildUnknownExchangeError(options.exchange, registry));
  }
  const exchangeAdapter = exchangeAdapterResult.value;
  const credentialsResult = buildProvidedExchangeCredentials(options);
  if (credentialsResult.isErr()) {
    return err(credentialsResult.error);
  }
  const credentials = credentialsResult.value;

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
      credentials,
    });
  }

  if (!exchangeAdapter.capabilities.supportsApi) {
    return err(new Error(`Exchange "${options.exchange}" does not support API import`));
  }
  if (!credentials) {
    return err(new Error('--api-key and --api-secret are required for exchange API accounts'));
  }

  return ok({
    profileId,
    name,
    accountType: 'exchange-api',
    platformKey: options.exchange,
    identifier: credentials.apiKey,
    credentials,
  });
}

export function buildUpdateAccountInput(
  account: Account,
  options: AccountUpdateCommandOptions,
  registry: AdapterRegistry
): Result<UpdateAccountInput, Error> {
  const updates: UpdateAccountInput = {};
  if (options.name !== undefined && options.name !== account.name) {
    updates.name = options.name;
  }

  const hasApiFlags =
    options.apiKey !== undefined || options.apiSecret !== undefined || options.apiPassphrase !== undefined;
  const hasCsvDir = options.csvDir !== undefined;
  const hasProvider = options.provider !== undefined;
  const hasXpubGap = options.xpubGap !== undefined;

  if (!hasApiFlags && !hasCsvDir && !hasProvider && !hasXpubGap && updates.name === undefined) {
    return err(new Error('No account property changes were provided'));
  }

  switch (account.accountType) {
    case 'exchange-api': {
      if (hasCsvDir || hasProvider || hasXpubGap) {
        return err(
          new Error(
            'exchange-api accounts can only be updated with --name and API credential flags (--api-key, --api-secret, --api-passphrase)'
          )
        );
      }

      const credentialsResult = mergeExchangeCredentials(account.credentials, options);
      if (credentialsResult.isErr()) {
        return err(credentialsResult.error);
      }
      const nextCredentials = credentialsResult.value;

      if (!nextCredentials) {
        return err(new Error('exchange-api accounts require both apiKey and apiSecret'));
      }

      const credentialsChanged = !areExchangeCredentialsEqual(nextCredentials, account.credentials);
      if (!credentialsChanged && updates.name === undefined) {
        return err(new Error('No account property changes were provided'));
      }

      if (credentialsChanged) {
        updates.credentials = nextCredentials;
        updates.identifier = nextCredentials.apiKey;
        updates.resetCursor = nextCredentials.apiKey !== account.identifier;
      }

      return ok(updates);
    }

    case 'exchange-csv': {
      if (hasProvider || hasXpubGap) {
        return err(
          new Error(
            'exchange-csv accounts can only be updated with --name, --csv-dir, and stored API credential flags (--api-key, --api-secret, --api-passphrase)'
          )
        );
      }

      const credentialsResult = mergeExchangeCredentials(account.credentials, options);
      if (credentialsResult.isErr()) {
        return err(credentialsResult.error);
      }
      const nextCredentials = credentialsResult.value;
      const credentialsChanged = !areExchangeCredentialsEqual(nextCredentials, account.credentials);

      if (options.csvDir) {
        const identifier = normalizeCsvDir(options.csvDir);
        if (identifier !== account.identifier) {
          updates.identifier = identifier;
          updates.resetCursor = identifier !== account.identifier;
        }
      }

      if (credentialsChanged) {
        updates.credentials = nextCredentials;
      }

      if (Object.keys(updates).length === 0) {
        return err(new Error('No account property changes were provided'));
      }

      return ok(updates);
    }

    case 'blockchain': {
      if (hasApiFlags || hasCsvDir) {
        return err(new Error('blockchain accounts can only be updated with --name, --provider, or --xpub-gap'));
      }

      if (hasProvider && options.provider !== account.providerName) {
        updates.providerName = options.provider;
      }

      if (options.xpubGap !== undefined) {
        const adapterResult = registry.getBlockchain(account.platformKey.toLowerCase());
        if (adapterResult.isErr()) {
          return err(buildUnknownBlockchainError(account.platformKey));
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
        return err(new Error('No account property changes were provided'));
      }

      return ok(updates);
    }
  }
}
