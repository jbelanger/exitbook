import type { CostBasisConfig, FiatCurrency } from '../shared/cost-basis-config.js';
import type { CostBasisMethodSupport, JurisdictionConfig } from '../shared/types.js';

export type CostBasisMethod = CostBasisConfig['method'];
export type CostBasisJurisdiction = CostBasisConfig['jurisdiction'];

export const SUPPORTED_COST_BASIS_FIAT_CURRENCIES: FiatCurrency[] = ['USD', 'CAD', 'EUR', 'GBP'];

const US_METHODS: CostBasisMethodSupport[] = [
  {
    code: 'fifo',
    label: 'FIFO (First In, First Out)',
    description: 'Dispose oldest lots first',
    implemented: true,
  },
  {
    code: 'lifo',
    label: 'LIFO (Last In, First Out)',
    description: 'Dispose newest lots first',
    implemented: true,
  },
  {
    code: 'specific-id',
    label: 'Specific Lot Identification',
    description: 'Choose specific lots for each disposal',
    implemented: false,
  },
];

const CANADA_METHODS: CostBasisMethodSupport[] = [
  {
    code: 'average-cost',
    label: 'Average Cost (ACB)',
    description: 'CRA pooled Adjusted Cost Base workflow',
    implemented: true,
  },
];

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
    label: 'United States (US)',
    defaultCurrency: 'USD',
    costBasisImplemented: true,
    supportedMethods: US_METHODS,
    sameAssetTransferFeePolicy: 'disposal',
    taxAssetIdentityPolicy: 'strict-onchain-tokens',
    relaxedTaxIdentitySymbols: [],
  },
  CA: {
    code: 'CA',
    label: 'Canada (CA)',
    defaultCurrency: 'CAD',
    costBasisImplemented: true,
    supportedMethods: CANADA_METHODS,
    defaultMethod: 'average-cost',
    sameAssetTransferFeePolicy: 'add-to-basis',
    taxAssetIdentityPolicy: 'relaxed-stablecoin-symbols',
    relaxedTaxIdentitySymbols: ['usdc'],
  },
  UK: {
    code: 'UK',
    label: 'United Kingdom (UK)',
    defaultCurrency: 'GBP',
    costBasisImplemented: false,
    supportedMethods: US_METHODS,
    sameAssetTransferFeePolicy: 'disposal',
    taxAssetIdentityPolicy: 'strict-onchain-tokens',
    relaxedTaxIdentitySymbols: [],
  },
  EU: {
    code: 'EU',
    label: 'European Union (EU)',
    defaultCurrency: 'EUR',
    costBasisImplemented: false,
    supportedMethods: US_METHODS,
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

export function listCostBasisJurisdictionCapabilities(): JurisdictionConfig[] {
  return Object.values(JURISDICTION_CONFIGS);
}

export function listCostBasisMethodCapabilitiesForJurisdiction(
  jurisdiction: CostBasisJurisdiction
): CostBasisMethodSupport[] {
  return requireJurisdictionConfig(jurisdiction).supportedMethods;
}

export function getDefaultCostBasisCurrencyForJurisdiction(jurisdiction: CostBasisJurisdiction): FiatCurrency {
  return requireJurisdictionConfig(jurisdiction).defaultCurrency;
}

export function getDefaultCostBasisMethodForJurisdiction(
  jurisdiction: CostBasisJurisdiction
): CostBasisMethod | undefined {
  return requireJurisdictionConfig(jurisdiction).defaultMethod;
}
