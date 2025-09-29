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
 * Injective fund flow analysis result
 */
export interface InjectiveFundFlow {
  // Bridge/IBC specific
  bridgeType?: 'peggy' | 'ibc' | 'native' | undefined;
  // Token information
  currency: string; // INJ or token symbol

  destinationChain?: string | undefined; // For IBC transfers
  // Fee information (always in INJ)
  feeAmount?: string | undefined;

  feePaidByUser: boolean; // Whether the user paid the transaction fee
  // Address information
  fromAddress: string;

  // Flow direction
  isIncoming: boolean; // User is receiving funds
  isOutgoing: boolean; // User is sending funds
  netAmount: string; // Net amount change for user (positive = received, negative = sent)

  sourceChain?: string | undefined; // For IBC transfers
  toAddress: string;

  tokenAddress?: string | undefined;

  tokenDecimals?: number | undefined;
  // Amount information
  totalAmount: string; // Total transaction amount
  // Transaction classification
  transactionType: 'deposit' | 'withdrawal' | 'internal_transfer' | 'bridge' | 'ibc';
}
