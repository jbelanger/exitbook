import type { CostBasisMethodSupport, JurisdictionConfig } from '../../model/types.js';

export const US_COST_BASIS_METHODS: CostBasisMethodSupport[] = [
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

export const US_JURISDICTION_CONFIG: JurisdictionConfig = {
  code: 'US',
  label: 'United States (US)',
  defaultCurrency: 'USD',
  costBasisImplemented: true,
  supportedMethods: US_COST_BASIS_METHODS,
  sameAssetTransferFeePolicy: 'disposal',
  taxAssetIdentityPolicy: 'strict-onchain-tokens',
  relaxedTaxIdentitySymbols: [],
};
