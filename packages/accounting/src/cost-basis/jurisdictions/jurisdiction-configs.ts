import type { JurisdictionConfig } from '../shared/types.js';

/**
 * Predefined jurisdiction configurations for major tax jurisdictions.
 *
 * Policy differences:
 * - US (IRS): Same-asset transfer fees are treated as disposals, triggering capital gains/losses
 * - CA (CRA): Fees can be added to the adjusted cost base (ACB) of the asset, deferring taxation
 * - UK (HMRC): Fees may constitute disposals, similar to US treatment
 * - EU: Most member states treat fees as disposals, though individual countries may vary
 */
export const JURISDICTION_CONFIGS: Record<string, JurisdictionConfig> = {
  US: {
    code: 'US',
    sameAssetTransferFeePolicy: 'disposal',
    taxAssetIdentityPolicy: 'strict-onchain-tokens',
    relaxedTaxIdentitySymbols: [],
  },
  CA: {
    code: 'CA',
    sameAssetTransferFeePolicy: 'add-to-basis',
    taxAssetIdentityPolicy: 'relaxed-stablecoin-symbols',
    relaxedTaxIdentitySymbols: ['usdc'],
  },
  UK: {
    code: 'UK',
    sameAssetTransferFeePolicy: 'disposal',
    taxAssetIdentityPolicy: 'strict-onchain-tokens',
    relaxedTaxIdentitySymbols: [],
  },
  EU: {
    code: 'EU',
    sameAssetTransferFeePolicy: 'disposal',
    taxAssetIdentityPolicy: 'strict-onchain-tokens',
    relaxedTaxIdentitySymbols: [],
  },
};

/**
 * Retrieve jurisdiction configuration by code.
 *
 * @param code - Jurisdiction code (e.g., 'US', 'CA', 'UK', 'EU')
 * @returns JurisdictionConfig if found, undefined otherwise
 */
export function getJurisdictionConfig(code: string): JurisdictionConfig | undefined {
  return JURISDICTION_CONFIGS[code] ?? undefined;
}

export function requireJurisdictionConfig(code: JurisdictionConfig['code']): JurisdictionConfig {
  const config = getJurisdictionConfig(code);
  if (!config) {
    throw new Error(`Jurisdiction config ${code} is not registered`);
  }

  return config;
}
