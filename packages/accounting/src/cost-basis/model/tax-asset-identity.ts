import type { Currency } from '@exitbook/foundation';
import { err, isFiat, ok, parseAssetId, type Result } from '@exitbook/foundation';

interface TaxAssetIdentityInput {
  assetId: string;
  assetSymbol: Currency;
}

interface ResolvedTaxAssetIdentity {
  identityKey: string;
}

/**
 * Imported exchange data usually omits the network behind token symbols.
 * Base identity therefore stays strict for on-chain tokens, and higher-level
 * workflows can install explicit overrides when validated transfer evidence
 * proves a blockchain token and exchange symbol should share a tax pool.
 */
interface TaxAssetIdentityResolutionConfig {
  assetIdentityOverridesByAssetId?: ReadonlyMap<string, string> | undefined;
}

function normalizeIdentitySymbol(assetSymbol: Currency): string {
  return assetSymbol.trim().toLowerCase();
}

export function resolveTaxAssetIdentity(
  input: TaxAssetIdentityInput,
  config: TaxAssetIdentityResolutionConfig
): Result<ResolvedTaxAssetIdentity, Error> {
  if (isFiat(input.assetSymbol)) {
    return err(new Error(`Tax asset identity requires a non-fiat asset, received ${input.assetSymbol}`));
  }

  const parsedAssetIdResult = parseAssetId(input.assetId);
  if (parsedAssetIdResult.isErr()) {
    return err(new Error(`Failed to parse assetId ${input.assetId}: ${parsedAssetIdResult.error.message}`));
  }

  const parsedAssetId = parsedAssetIdResult.value;
  const symbolIdentity = normalizeIdentitySymbol(input.assetSymbol);
  const overrideIdentityKey = config.assetIdentityOverridesByAssetId?.get(input.assetId)?.trim();
  if (overrideIdentityKey) {
    return ok({ identityKey: overrideIdentityKey });
  }

  switch (parsedAssetId.namespace) {
    case 'exchange':
      return ok({ identityKey: symbolIdentity });
    case 'fiat':
      return err(new Error(`Tax asset identity requires a non-fiat asset, received ${input.assetId}`));
    case 'blockchain':
      if (parsedAssetId.ref === 'native') {
        return ok({ identityKey: symbolIdentity });
      }

      return ok({ identityKey: input.assetId });
  }
}
