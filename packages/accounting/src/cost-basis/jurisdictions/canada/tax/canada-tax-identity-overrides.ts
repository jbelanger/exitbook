import { err, ok, parseAssetId, type Result } from '@exitbook/foundation';

import type { ValidatedTransferSet } from '../../../../accounting-layer.js';
import { resolveTaxAssetIdentity } from '../../../model/tax-asset-identity.js';

import type { CanadaTaxInputContextBuildOptions } from './canada-tax-types.js';

function isBlockchainTokenAsset(assetId: string): Result<boolean, Error> {
  const parsedAssetIdResult = parseAssetId(assetId);
  if (parsedAssetIdResult.isErr()) {
    return err(parsedAssetIdResult.error);
  }

  const parsedAssetId = parsedAssetIdResult.value;
  return ok(parsedAssetId.namespace === 'blockchain' && parsedAssetId.ref !== 'native');
}

function buildBlockchainTokenIdentityOverride(
  validatedLink: ValidatedTransferSet['links'][number],
  identityConfig: CanadaTaxInputContextBuildOptions
): Result<{ blockchainAssetId: string; exchangeIdentityKey: string } | undefined, Error> {
  const sourceParsedResult = parseAssetId(validatedLink.sourceAssetId);
  if (sourceParsedResult.isErr()) {
    return err(
      new Error(
        `Failed to parse validated transfer source asset ${validatedLink.sourceAssetId} ` +
          `for link ${validatedLink.link.id}: ${sourceParsedResult.error.message}`
      )
    );
  }

  const targetParsedResult = parseAssetId(validatedLink.targetAssetId);
  if (targetParsedResult.isErr()) {
    return err(
      new Error(
        `Failed to parse validated transfer target asset ${validatedLink.targetAssetId} ` +
          `for link ${validatedLink.link.id}: ${targetParsedResult.error.message}`
      )
    );
  }

  const sourceParsed = sourceParsedResult.value;
  const targetParsed = targetParsedResult.value;

  if (
    sourceParsed.namespace === 'exchange' &&
    targetParsed.namespace === 'blockchain' &&
    targetParsed.ref !== 'native'
  ) {
    const exchangeIdentityResult = resolveTaxAssetIdentity(
      {
        assetId: validatedLink.sourceAssetId,
        assetSymbol: validatedLink.link.assetSymbol,
      },
      { assetIdentityOverridesByAssetId: identityConfig.assetIdentityOverridesByAssetId }
    );
    if (exchangeIdentityResult.isErr()) {
      return err(
        new Error(
          `Failed to resolve exchange-side identity for validated transfer link ${validatedLink.link.id}: ` +
            exchangeIdentityResult.error.message
        )
      );
    }

    return ok({
      blockchainAssetId: validatedLink.targetAssetId,
      exchangeIdentityKey: exchangeIdentityResult.value.identityKey,
    });
  }

  if (
    sourceParsed.namespace === 'blockchain' &&
    sourceParsed.ref !== 'native' &&
    targetParsed.namespace === 'exchange'
  ) {
    const exchangeIdentityResult = resolveTaxAssetIdentity(
      {
        assetId: validatedLink.targetAssetId,
        assetSymbol: validatedLink.link.assetSymbol,
      },
      { assetIdentityOverridesByAssetId: identityConfig.assetIdentityOverridesByAssetId }
    );
    if (exchangeIdentityResult.isErr()) {
      return err(
        new Error(
          `Failed to resolve exchange-side identity for validated transfer link ${validatedLink.link.id}: ` +
            exchangeIdentityResult.error.message
        )
      );
    }

    return ok({
      blockchainAssetId: validatedLink.sourceAssetId,
      exchangeIdentityKey: exchangeIdentityResult.value.identityKey,
    });
  }

  return ok(undefined);
}

export function buildTransferAwareIdentityConfig(
  identityConfig: CanadaTaxInputContextBuildOptions,
  validatedTransfers: ValidatedTransferSet
): Result<CanadaTaxInputContextBuildOptions, Error> {
  const overrides = new Map(identityConfig.assetIdentityOverridesByAssetId ?? []);

  for (const validatedLink of validatedTransfers.links) {
    const overrideResult = buildBlockchainTokenIdentityOverride(validatedLink, identityConfig);
    if (overrideResult.isErr()) {
      return err(overrideResult.error);
    }

    const override = overrideResult.value;
    if (!override) {
      continue;
    }

    const targetIsBlockchainTokenResult = isBlockchainTokenAsset(override.blockchainAssetId);
    if (targetIsBlockchainTokenResult.isErr()) {
      return err(
        new Error(
          `Failed to validate blockchain transfer identity override for ${override.blockchainAssetId}: ` +
            targetIsBlockchainTokenResult.error.message
        )
      );
    }

    if (!targetIsBlockchainTokenResult.value) {
      continue;
    }

    const existingIdentityKey = overrides.get(override.blockchainAssetId);
    if (existingIdentityKey && existingIdentityKey !== override.exchangeIdentityKey) {
      return err(
        new Error(
          `Validated transfers assign conflicting Canada tax identities to ${override.blockchainAssetId}: ` +
            `${existingIdentityKey} vs ${override.exchangeIdentityKey}`
        )
      );
    }

    overrides.set(override.blockchainAssetId, override.exchangeIdentityKey);
  }

  if (overrides.size === 0) {
    return ok(identityConfig);
  }

  return ok({
    ...identityConfig,
    assetIdentityOverridesByAssetId: overrides,
  });
}
