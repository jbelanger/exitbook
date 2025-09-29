/**
 * Normalized Injective transaction with structured data
 * for sophisticated fund flow analysis in the processor
 */
export interface InjectiveTransaction {
  // Value information
  amount: string; // Amount in base units
  // Block context
  blockHeight?: number;
  blockId?: string;
  // Bridge information (for cross-chain transfers)
  bridgeType?: 'peggy' | 'ibc' | 'native'; // Type of bridge/transfer

  claimId?: number[]; // For Peggy bridge claims
  currency: string; // 'INJ' for native transfers, token symbol for token transfers

  ethereumReceiver?: string; // For Peggy withdrawals to Ethereum
  ethereumSender?: string; // For Peggy deposits from Ethereum

  eventNonce?: string; // For Peggy bridge deposits
  // Fee information (always in INJ)
  feeAmount?: string; // Gas fee in base units

  feeCurrency?: string; // Always 'INJ'
  // Transaction flow data
  from: string;

  gasPrice?: string;
  // Gas information
  gasUsed?: number;
  gasWanted?: number;

  // Core transaction data
  id: string;
  memo?: string;
  // Injective-specific metadata
  messageType?: string; // e.g., '/cosmos.bank.v1beta1.MsgSend', '/ibc.applications.transfer.v1.MsgTransfer'

  providerId: string;
  // IBC/Bridge-specific information
  sourceChannel?: string;
  sourcePort?: string;
  status: 'success' | 'failed' | 'pending';

  timestamp: number;
  to: string;
  // Token-specific information (for CW20/native token transfers)
  tokenAddress?: string; // Contract address for token transfers
  tokenDecimals?: number; // Token decimals

  tokenSymbol?: string; // Token symbol
  tokenType?: 'cw20' | 'native' | 'ibc'; // Type of transfer
  txType?: string;

  // Transaction type classification (basic, will be refined by processor)
  type: 'transfer' | 'bridge_deposit' | 'bridge_withdrawal' | 'ibc_transfer';
}

/**
 * Injective fund flow analysis result
 */
export interface InjectiveFundFlow {
  // Bridge/IBC specific
  bridgeType?: 'peggy' | 'ibc' | 'native';
  // Token information
  currency: string; // INJ or token symbol

  destinationChain?: string; // For IBC transfers
  // Fee information (always in INJ)
  feeAmount?: string;

  feePaidByUser: boolean; // Whether the user paid the transaction fee
  // Address information
  fromAddress: string;

  // Flow direction
  isIncoming: boolean; // User is receiving funds
  isOutgoing: boolean; // User is sending funds
  netAmount: string; // Net amount change for user (positive = received, negative = sent)

  sourceChain?: string; // For IBC transfers
  toAddress: string;

  tokenAddress?: string;

  tokenDecimals?: number;
  // Amount information
  totalAmount: string; // Total transaction amount
  // Transaction classification
  transactionType: 'deposit' | 'withdrawal' | 'internal_transfer' | 'bridge' | 'ibc';
}
