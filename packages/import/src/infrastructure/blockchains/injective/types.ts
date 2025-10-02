/**
 * Normalized Injective transaction with structured data
 * for sophisticated fund flow analysis in the processor
 */
export interface InjectiveTransaction {
  // Value information
  amount: string; // Amount in base units
  // Block context
  blockHeight?: number | undefined;
  blockId?: string | undefined;
  // Bridge information (for cross-chain transfers)
  bridgeType?: 'peggy' | 'ibc' | 'native' | undefined; // Type of bridge/transfer

  claimId?: number[] | undefined; // For Peggy bridge claims
  currency: string; // 'INJ' for native transfers, token symbol for token transfers

  ethereumReceiver?: string | undefined; // For Peggy withdrawals to Ethereum
  ethereumSender?: string | undefined; // For Peggy deposits from Ethereum

  eventNonce?: string | undefined; // For Peggy bridge deposits
  // Fee information (always in INJ)
  feeAmount?: string | undefined; // Gas fee in base units

  feeCurrency?: string | undefined; // Always 'INJ'
  // Transaction flow data
  from: string;

  gasPrice?: string | undefined;
  // Gas information
  gasUsed?: number | undefined;
  gasWanted?: number | undefined;

  // Core transaction data
  id: string;
  memo?: string | undefined;
  // Injective-specific metadata
  messageType?: string | undefined; // e.g., '/cosmos.bank.v1beta1.MsgSend', '/ibc.applications.transfer.v1.MsgTransfer'

  providerId: string;
  // IBC/Bridge-specific information
  sourceChannel?: string | undefined;
  sourcePort?: string | undefined;
  status: 'success' | 'failed' | 'pending';

  timestamp: number;
  to: string;
  // Token-specific information (for CW20/native token transfers)
  tokenAddress?: string | undefined; // Contract address for token transfers
  tokenDecimals?: number | undefined; // Token decimals

  tokenSymbol?: string | undefined; // Token symbol
  tokenType?: 'cw20' | 'native' | 'ibc' | undefined; // Type of transfer
  txType?: string | undefined;

  // Transaction type classification (basic, will be refined by processor)
  type: 'transfer' | 'bridge_deposit' | 'bridge_withdrawal' | 'ibc_transfer';
}

/**
 * Injective fund flow analysis result - multi-asset tracking
 */
export interface InjectiveFundFlow {
  // Multi-asset tracking (following EVM pattern)
  inflows: {
    amount: string;
    asset: string;
    tokenAddress?: string;
    tokenDecimals?: number;
  }[];
  outflows: {
    amount: string;
    asset: string;
    tokenAddress?: string;
    tokenDecimals?: number;
  }[];
  primary: {
    amount: string;
    asset: string;
    tokenAddress?: string;
    tokenDecimals?: number;
  };

  // Bridge/IBC specific
  bridgeType?: 'peggy' | 'ibc' | 'native' | undefined;
  destinationChain?: string | undefined; // For IBC transfers
  sourceChain?: string | undefined; // For IBC transfers

  // Fee information (always in INJ)
  feeAmount: string;
  feeCurrency: string;

  // Address information
  fromAddress: string;
  toAddress: string;

  // Transaction context
  hasContractInteraction: boolean;
  hasBridgeTransfer: boolean;
  hasIbcTransfer: boolean;

  // Classification uncertainty tracking
  classificationUncertainty?: string;
}
