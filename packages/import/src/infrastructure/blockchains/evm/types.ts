/**
 * Unified EVM transaction type supporting all EVM-compatible chains
 *
 * This type merges fields from Ethereum and Avalanche transactions,
 * supporting the superset of all features across EVM chains.
 */
export interface EvmTransaction {
  amount: string; // Amount in wei (for native) or token units (for tokens)
  // Block context
  blockHeight?: number | undefined;
  blockId?: string | undefined;
  currency: string; // Native currency (ETH/AVAX) or token symbol
  feeAmount?: string | undefined; // Gas fee in wei

  feeCurrency?: string | undefined; // Native currency symbol
  // Transaction flow
  from: string;
  functionName?: string | undefined; // Function name (when available)
  // Gas and fee information (always in native currency)
  gasPrice?: string | undefined;

  gasUsed?: string | undefined;
  // Core transaction data
  id: string;

  // Contract interaction metadata
  inputData?: string | undefined; // Full input data for contract calls
  methodId?: string | undefined; // First 4 bytes of input data
  providerId: string;
  status: 'success' | 'failed' | 'pending';

  timestamp: number;
  to: string;
  // Token-specific information (for ERC-20/721/1155 transfers)
  tokenAddress?: string | undefined; // Contract address for token transfers

  tokenDecimals?: number | undefined; // Token decimals
  tokenSymbol?: string | undefined; // Token symbol
  tokenType?: 'erc20' | 'erc721' | 'erc1155' | 'native' | undefined; // Type of transfer
  // Internal transaction tracking (for chains that support it)
  traceId?: string | undefined; // For internal transactions

  type: 'transfer' | 'token_transfer' | 'internal' | 'contract_call';
}

/**
 * Unified EVM fund flow analysis result
 *
 * Based on Avalanche's transaction correlation approach, which is the correct
 * baseline for all EVM chains. Supports grouping multiple related transactions
 * (normal, internal, token transfers) by hash for comprehensive analysis.
 */
export interface EvmFundFlow {
  // Primary amount and currency (the main asset being transferred)
  primaryAmount: string; // Absolute amount of primary asset
  primarySymbol: string; // Symbol of primary asset (ETH, AVAX, or token symbol)

  // Fee information (always in native currency)
  feeAmount: string; // Total fee in native currency
  feeCurrency: string; // Native currency symbol (ETH, AVAX, etc.)

  // Address information (always present in fund flow)
  fromAddress: string;
  toAddress: string;

  // Fund flow direction from user's perspective
  isIncoming: boolean; // User is receiving funds
  isOutgoing: boolean; // User is sending funds

  // Transaction correlation and complexity analysis
  // Essential for proper EVM transaction processing across all chains
  transactionCount: number; // Number of correlated transactions (1 for simple, >1 for complex)
  hasContractInteraction: boolean; // Involves smart contract calls
  hasInternalTransactions: boolean; // Has internal/trace transactions
  hasTokenTransfers: boolean; // Has ERC-20/721/1155 transfers

  // Token information (when transferring tokens)
  tokenAddress?: string | undefined;
  tokenDecimals?: number | undefined;
}
