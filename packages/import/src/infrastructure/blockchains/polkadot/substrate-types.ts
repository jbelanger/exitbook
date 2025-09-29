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
 */
export interface SubstrateFundFlow {
  call: string; // Primary call method
  // Chain context
  chainName: string; // polkadot, kusama, bittensor

  currency: string; // DOT, KSM, TAO, etc.
  // Transaction complexity
  eventCount: number; // Number of events generated
  extrinsicCount: number; // Number of extrinsics in batch (for utility.batch)

  // Fee information (always in native currency)
  feeAmount: string;
  feeCurrency: string;
  feePaidByUser: boolean; // Whether the user paid the transaction fee

  // Address information
  fromAddress: string;
  hasGovernance: boolean; // Transaction involves democracy/council

  hasMultisig: boolean; // Transaction involves multisig
  hasProxy: boolean; // Transaction uses proxy
  // Substrate-specific analysis
  hasStaking: boolean; // Transaction involves staking operations
  hasUtilityBatch: boolean; // Transaction uses utility.batch
  // Flow direction
  isIncoming: boolean; // User is receiving funds

  isOutgoing: boolean; // User is sending funds
  module: string; // Primary module (balances, staking, etc.)

  netAmount: string; // Net amount change for user (positive = received, negative = sent)
  toAddress: string;
  // Amount information
  totalAmount: string; // Total transaction amount
}
