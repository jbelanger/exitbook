import type { Currency } from '@exitbook/foundation';
import { err, isFiat, ok, parseAssetId, type Result } from '@exitbook/foundation';

import type { TaxAssetIdentityPolicy } from './types.js';

interface TaxAssetIdentityInput {
  assetId: string;
  assetSymbol: Currency;
}

interface ResolvedTaxAssetIdentity {
  identityKey: string;
}

/**
 * Imported exchange data usually omits the network behind symbols like USDC.
 * The relaxed policy intentionally collapses selected symbols across venues and
 * chains so tax pooling can run from imported facts alone.
 */
interface TaxAssetIdentityResolutionConfig {
  policy: TaxAssetIdentityPolicy;
  relaxedSymbolIdentities: readonly string[];
}

function normalizeIdentitySymbol(assetSymbol: Currency): string {
  return assetSymbol.trim().toLowerCase();
}

function shouldRelaxBlockchainTokenIdentity(assetSymbol: Currency, config: TaxAssetIdentityResolutionConfig): boolean {
  if (config.policy !== 'relaxed-stablecoin-symbols') {
    return false;
  }

  return config.relaxedSymbolIdentities
    .map((symbol) => symbol.trim().toLowerCase())
    .includes(normalizeIdentitySymbol(assetSymbol));
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

  switch (parsedAssetId.namespace) {
    case 'exchange':
      return ok({ identityKey: symbolIdentity });
    case 'fiat':
      return err(new Error(`Tax asset identity requires a non-fiat asset, received ${input.assetId}`));
    case 'blockchain':
      if (parsedAssetId.ref === 'native') {
        return ok({ identityKey: symbolIdentity });
      }

      if (shouldRelaxBlockchainTokenIdentity(input.assetSymbol, config)) {
        return ok({ identityKey: symbolIdentity });
      }

      return ok({ identityKey: input.assetId });
  }
}
