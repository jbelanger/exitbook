import type { JurisdictionConfig } from '../types.js';

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
  },
  CA: {
    code: 'CA',
    sameAssetTransferFeePolicy: 'add-to-basis',
  },
  UK: {
    code: 'UK',
    sameAssetTransferFeePolicy: 'disposal',
  },
  EU: {
    code: 'EU',
    sameAssetTransferFeePolicy: 'disposal',
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
