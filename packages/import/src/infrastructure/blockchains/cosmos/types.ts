/**
 * Normalized Cosmos SDK transaction with structured data
 * for sophisticated fund flow analysis in the processor
 *
 * This unified type supports all Cosmos SDK-based chains including:
 * - Injective, Osmosis, Cosmos Hub, Terra, Juno, Secret Network, etc.
 * - Message-based transaction structure (MsgSend, MsgTransfer, MsgExecuteContract)
 * - IBC transfers across chains
 * - Bridge operations (Peggy, Gravity Bridge, etc.)
 * - CosmWasm contract interactions
 * - Multi-asset tracking (native, IBC tokens, CW20)
 */
export interface CosmosTransaction {
  // Core transaction data
  id: string;
  timestamp: number;
  status: 'success' | 'failed' | 'pending';

  // Transaction flow data
  from: string;
  to: string;

  // Value information
  amount: string; // Amount in base units
  currency: string; // Native currency (e.g., 'INJ', 'OSMO', 'ATOM') or token symbol

  // Block context
  blockHeight?: number | undefined;
  blockId?: string | undefined;

  // Provider identification
  providerId: string;

  // Cosmos-specific metadata
  messageType?: string | undefined; // e.g., '/cosmos.bank.v1beta1.MsgSend', '/ibc.applications.transfer.v1.MsgTransfer', '/cosmwasm.wasm.v1.MsgExecuteContract'
  memo?: string | undefined;
  txType?: string | undefined;

  // Gas information
  gasUsed?: number | undefined;
  gasWanted?: number | undefined;
  gasPrice?: string | undefined;

  // Fee information (always in native currency)
  feeAmount?: string | undefined; // Gas fee in base units
  feeCurrency?: string | undefined; // Native currency of the chain

  // Token-specific information (for CW20/native token transfers)
  tokenAddress?: string | undefined; // Contract address for token transfers
  tokenDecimals?: number | undefined; // Token decimals
  tokenSymbol?: string | undefined; // Token symbol
  tokenType?: 'cw20' | 'native' | 'ibc' | undefined; // Type of transfer

  // IBC-specific information (for inter-blockchain communication)
  sourceChannel?: string | undefined; // IBC source channel
  sourcePort?: string | undefined; // IBC source port
  destinationChannel?: string | undefined; // IBC destination channel
  destinationPort?: string | undefined; // IBC destination port
  ibcDenom?: string | undefined; // IBC token denomination (e.g., 'ibc/...')

  // Bridge information (for cross-chain transfers)
  bridgeType?: 'peggy' | 'gravity' | 'ibc' | 'native' | undefined; // Type of bridge/transfer
  bridgeId?: string | undefined; // Bridge-specific identifier

  // Injective Peggy bridge-specific (only for Injective chain)
  ethereumSender?: string | undefined; // For Peggy deposits from Ethereum
  ethereumReceiver?: string | undefined; // For Peggy withdrawals to Ethereum
  eventNonce?: string | undefined; // For Peggy bridge deposits
  claimId?: number[] | undefined; // For Peggy bridge claims

  // Gravity Bridge-specific (for chains using Gravity Bridge)
  gravityNonce?: string | undefined; // Gravity Bridge nonce
  gravityBatchNonce?: string | undefined; // Gravity Bridge batch nonce

  // CosmWasm contract-specific
  contractAddress?: string | undefined; // CosmWasm contract address
  contractAction?: string | undefined; // Contract method/action being called
  contractResult?: string | undefined; // Contract execution result
}

/**
 * Cosmos fund flow analysis result - multi-asset tracking
 *
 * This structure follows the EVM pattern for consistency across all blockchain types,
 * while supporting Cosmos-specific features like IBC and bridge transfers.
 */
export interface CosmosFundFlow {
  // Multi-asset tracking (following EVM pattern)
  inflows: {
    amount: string;
    asset: string;
    tokenAddress?: string | undefined;
    tokenDecimals?: number | undefined;
  }[];
  outflows: {
    amount: string;
    asset: string;
    tokenAddress?: string | undefined;
    tokenDecimals?: number | undefined;
  }[];
  primary: {
    amount: string;
    asset: string;
    tokenAddress?: string | undefined;
    tokenDecimals?: number | undefined;
  };

  // Fee information (always in native currency)
  feeAmount: string;
  feeCurrency: string;

  // Address information
  fromAddress: string;
  toAddress: string;

  // Transaction context flags
  hasContractInteraction: boolean;
  hasBridgeTransfer: boolean;
  hasIbcTransfer: boolean;

  // Bridge/IBC specific metadata
  bridgeType?: 'peggy' | 'gravity' | 'ibc' | 'native' | undefined;
  sourceChain?: string | undefined; // For IBC transfers
  destinationChain?: string | undefined; // For IBC transfers

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined;
}
