/**
 * Normalized Ethereum transaction with structured data
 * for sophisticated fund flow analysis in the processor
 */
export interface EthereumTransaction {
  // Value information
  amount: string; // Amount in wei (for ETH) or token units (for tokens)
  // Block context
  blockHeight?: number;
  blockId?: string;
  currency: string; // 'ETH' for native transfers, token symbol for token transfers

  // Fee information (always in ETH)
  feeAmount?: string; // Gas fee in wei
  feeCurrency?: string; // Always 'ETH'

  // Transaction flow data
  from: string;
  gasPrice?: string;

  gasUsed?: string;
  // Core transaction data
  id: string;

  inputData?: string; // Full input data for contract calls
  // Additional metadata for complex transactions
  methodId?: string; // First 4 bytes of input data
  providerId: string;
  status: 'success' | 'failed' | 'pending';

  timestamp: number;
  to: string;
  // Token-specific information (for ERC-20/721/1155 transfers)
  tokenAddress?: string; // Contract address for token transfers
  tokenDecimals?: number; // Token decimals

  tokenSymbol?: string; // Token symbol

  tokenType?: 'erc20' | 'erc721' | 'erc1155' | 'native'; // Type of transfer
  // Transaction type classification (basic, will be refined by processor)
  type: 'transfer' | 'token_transfer';
}

/**
 * Ethereum fund flow analysis result
 */
export interface EthereumFundFlow {
  // Token information
  currency: string; // ETH or token symbol
  // Fee information (always in ETH)
  feeAmount?: string;

  feePaidByUser: boolean; // Whether the user paid the transaction fee
  // Address information
  fromAddress: string;

  // Flow direction
  isIncoming: boolean; // User is receiving funds
  isOutgoing: boolean; // User is sending funds

  // Amount information
  netAmount: string; // Net amount change for user (positive = received, negative = sent)
  toAddress: string;
  tokenAddress?: string;

  tokenDecimals?: number;
  totalAmount: string; // Total transaction amount
}
