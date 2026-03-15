import type { CostBasisMethodSupport, JurisdictionConfig } from '../../model/types.js';

export const CANADA_COST_BASIS_METHODS: CostBasisMethodSupport[] = [
  {
    code: 'average-cost',
    label: 'Average Cost (ACB)',
    description: 'CRA pooled Adjusted Cost Base workflow',
    implemented: true,
  },
];

export const CANADA_JURISDICTION_CONFIG: JurisdictionConfig = {
  code: 'CA',
  label: 'Canada (CA)',
  defaultCurrency: 'CAD',
  costBasisImplemented: true,
  supportedMethods: CANADA_COST_BASIS_METHODS,
  defaultMethod: 'average-cost',
  sameAssetTransferFeePolicy: 'add-to-basis',
  taxAssetIdentityPolicy: 'relaxed-stablecoin-symbols',
  relaxedTaxIdentitySymbols: ['usdc'],
};
