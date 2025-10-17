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
  to?: string | undefined;
  // Token-specific information (for ERC-20/721/1155 transfers)
  tokenAddress?: string | undefined; // Contract address for token transfers

  tokenDecimals?: number | undefined; // Token decimals
  tokenSymbol?: string | undefined; // Token symbol
  tokenType?: 'erc20' | 'erc721' | 'erc1155' | 'native' | undefined; // Type of transfer
  // Internal transaction tracking (for chains that support it)
  traceId?: string | undefined; // For internal transactions

  type: 'transfer' | 'token_transfer' | 'internal' | 'contract_call';
}
