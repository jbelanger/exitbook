/**
 * Substrate fund flow analysis result
 * Works for Polkadot, Kusama, Bittensor, and other Substrate chains
 * Following EVM's multi-asset tracking approach
 */
export interface SubstrateFundFlow {
  // All assets that flowed in/out (supports multi-asset operations)
  inflows: {
    amount: string; // Normalized amount
    asset: string; // Symbol (DOT, KSM, TAO, etc.)
  }[];
  outflows: {
    amount: string; // Normalized amount
    asset: string; // Symbol (DOT, KSM, TAO, etc.)
  }[];

  // Primary asset (for simplified consumption and single-asset display)
  primary: {
    amount: string; // Absolute amount of primary asset
    asset: string; // Symbol of primary asset
  };

  // Fee information (always in native currency)
  feeAmount: string;
  feeCurrency: string;

  // Address information
  fromAddress: string;
  toAddress: string;

  // Substrate-specific transaction characteristics
  module: string; // Primary module (balances, staking, etc.)
  call: string; // Primary call method
  chainName: string; // polkadot, kusama, bittensor

  // Substrate-specific analysis
  hasStaking: boolean; // Transaction involves staking operations
  hasGovernance: boolean; // Transaction involves democracy/council
  hasUtilityBatch: boolean; // Transaction uses utility.batch
  hasProxy: boolean; // Transaction uses proxy
  hasMultisig: boolean; // Transaction involves multisig

  // Transaction complexity
  eventCount: number; // Number of events generated
  extrinsicCount: number; // Number of extrinsics in batch (for utility.batch)

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined; // Reason why classification is uncertain
}
