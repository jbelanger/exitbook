/**
 * Normalized Substrate transaction with structured data
 * for sophisticated fund flow analysis in the processor.
 * Supports Polkadot, Kusama, Bittensor, and other Substrate-based chains.
 */
export interface SubstrateTransaction {
  // Value information
  amount: string; // Amount in planck (for DOT/KSM) or smallest unit
  // Advanced substrate features
  args?: unknown; // Call arguments
  // Block context
  blockHeight?: number | undefined;
  blockId?: string | undefined;

  call?: string; // Method call within module
  // Chain identification
  chainName?: string; // polkadot, kusama, bittensor

  currency: string; // 'DOT', 'KSM', 'TAO', or other substrate token
  events?: SubstrateEventData[]; // Associated events

  // Substrate-specific information
  extrinsicIndex?: string; // Position in block
  // Fee information (in native currency)
  feeAmount?: string; // Transaction fee in planck

  feeCurrency?: string; // Native token symbol (DOT, KSM, TAO)
  // Transaction flow data
  from: string;

  genesisHash?: string; // Chain genesis hash
  // Core transaction data
  id: string;
  module?: string; // Substrate module (balances, staking, democracy, etc.)
  nonce?: number; // Account nonce

  providerId: string;

  signature?: string; // Transaction signature
  ss58Format?: number; // SS58 address format
  status: 'success' | 'failed' | 'pending';
  timestamp: number;

  tip?: string; // Optional tip amount
  to: string;
  // Transaction type classification (basic, will be refined by processor)
  type: 'transfer' | 'staking' | 'democracy' | 'council' | 'utility' | 'proxy' | 'multisig' | 'custom';
}

/**
 * Substrate event data from transaction execution
 */
export interface SubstrateEventData {
  data: unknown[]; // Event data
  method: string; // Event method
  section: string; // Module name
}

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

  // Primary asset (for backward compatibility and simple display)
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
