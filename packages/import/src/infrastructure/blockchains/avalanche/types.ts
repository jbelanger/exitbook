/**
 * Normalized Avalanche transaction with structured data
 * for sophisticated fund flow analysis in the processor
 */
export interface AvalancheTransaction {
  // Value information
  amount: string; // Amount in wei (for AVAX) or token units (for tokens)

  // Block context
  blockHeight?: number | undefined;
  blockId?: string | undefined;
  currency: string; // 'AVAX' for native transfers, token symbol for token transfers

  // Fee information (always in AVAX)
  feeAmount?: string; // Gas fee in wei
  feeCurrency?: string; // Always 'AVAX'

  // Transaction flow data
  from: string;
  functionName?: string; // For contract calls
  gasPrice?: string | undefined;

  gasUsed?: string | undefined;
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

  // Avalanche-specific data
  traceId?: string; // For internal transactions
  // Transaction type classification (basic, will be refined by processor)
  type: 'transfer' | 'token_transfer' | 'internal' | 'contract_call';
}

/**
 * Avalanche fund flow analysis result
 */
export interface AvalancheFundFlow {
  // Token information
  currency: string; // AVAX or token symbol

  // Fee information (always in AVAX)
  feeAmount: string;
  feeCurrency: string;

  // Addresses involved
  fromAddress?: string | undefined;
  hasContractInteraction: boolean;

  hasInternalTransactions: boolean;
  hasTokenTransfers: boolean;

  // Fund flow direction
  isIncoming: boolean;
  isOutgoing: boolean;

  // Primary transaction amount and symbol
  primaryAmount: string;
  primarySymbol: string;
  toAddress?: string | undefined;
  // Analysis metadata
  transactionCount: number; // Number of correlated transactions
}
