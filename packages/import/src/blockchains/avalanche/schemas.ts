/**
 * Zod validation schemas for Avalanche (Snowtrace) transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from Avalanche C-Chain Snowtrace API before processing.
 */
import { z } from 'zod';

/**
 * Schema for Snowtrace normal transaction structure
 */
export const SnowtraceTransactionSchema = z.object({
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  blockNumber: z.string().min(1, 'Block number must not be empty'),
  confirmations: z.string().min(1, 'Confirmations must not be empty'),
  cumulativeGasUsed: z.string().min(1, 'Cumulative gas used must not be empty'),
  from: z.string().min(1, 'From address must not be empty'),
  functionName: z.string().optional(),
  gas: z.string().min(1, 'Gas must not be empty'),
  gasPrice: z.string().min(1, 'Gas price must not be empty'),
  gasUsed: z.string().min(1, 'Gas used must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().optional(),
  methodId: z.string().optional(),
  nonce: z.string().min(1, 'Nonce must not be empty'),
  timeStamp: z.string().min(1, 'Timestamp must not be empty'),
  to: z.string().min(1, 'To address must not be empty'),
  transactionIndex: z.string().min(1, 'Transaction index must not be empty'),
  txreceipt_status: z.string().optional(),
  value: z.string().min(1, 'Value must not be empty'),
});

/**
 * Schema for Snowtrace internal transaction structure
 */
export const SnowtraceInternalTransactionSchema = z.object({
  blockNumber: z.string().min(1, 'Block number must not be empty'),
  contractAddress: z.string(),
  errCode: z.string(),
  from: z.string().min(1, 'From address must not be empty'),
  gas: z.string().min(1, 'Gas must not be empty'),
  gasUsed: z.string().min(1, 'Gas used must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().min(1, 'IsError must not be empty'),
  timeStamp: z.string().min(1, 'Timestamp must not be empty'),
  to: z.string().min(1, 'To address must not be empty'),
  traceId: z.string().min(1, 'Trace ID must not be empty'),
  type: z.string().min(1, 'Type must not be empty'),
  value: z.string().min(1, 'Value must not be empty'),
});

/**
 * Schema for Snowtrace token transfer structure
 */
export const SnowtraceTokenTransferSchema = z.object({
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  blockNumber: z.string().min(1, 'Block number must not be empty'),
  confirmations: z.string().min(1, 'Confirmations must not be empty'),
  contractAddress: z.string().min(1, 'Contract address must not be empty'),
  cumulativeGasUsed: z.string().min(1, 'Cumulative gas used must not be empty'),
  from: z.string().min(1, 'From address must not be empty'),
  gas: z.string().min(1, 'Gas must not be empty'),
  gasPrice: z.string().min(1, 'Gas price must not be empty'),
  gasUsed: z.string().min(1, 'Gas used must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  nonce: z.string().min(1, 'Nonce must not be empty'),
  timeStamp: z.string().min(1, 'Timestamp must not be empty'),
  to: z.string().min(1, 'To address must not be empty'),
  tokenDecimal: z.string().min(1, 'Token decimal must not be empty'),
  tokenName: z.string().min(1, 'Token name must not be empty'),
  tokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
  transactionIndex: z.string().min(1, 'Transaction index must not be empty'),
  value: z.string().min(1, 'Value must not be empty'),
});

/**
 * Schema for Snowtrace API response wrapper
 */
export const SnowtraceApiResponseSchema = z.object({
  message: z.string().min(1, 'Message must not be empty'),
  result: z.array(z.any()), // Can be various transaction types
  status: z.string().min(1, 'Status must not be empty'),
});

/**
 * Schema for Snowtrace balance response
 */
export const SnowtraceBalanceResponseSchema = z.object({
  message: z.string().min(1, 'Message must not be empty'),
  result: z.string().min(1, 'Balance result must not be empty'),
  status: z.string().min(1, 'Status must not be empty'),
});

/**
 * Schema for Snowtrace balance structure
 */
export const SnowtraceBalanceSchema = z.object({
  account: z.string().min(1, 'Account address must not be empty'),
  balance: z.string().min(1, 'Balance must not be empty'),
});

/**
 * Schema for Snowtrace token balance structure
 */
export const SnowtraceTokenBalanceSchema = z.object({
  TokenAddress: z.string().min(1, 'Token address must not be empty'),
  TokenDivisor: z.string().min(1, 'Token divisor must not be empty'),
  TokenName: z.string().min(1, 'Token name must not be empty'),
  TokenQuantity: z.string().min(1, 'Token quantity must not be empty'),
  TokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
});

/**
 * Schema for Avalanche atomic transaction structure
 */
export const AtomicTransactionSchema = z.object({
  amount: z.string().min(1, 'Amount must not be empty'),
  asset: z.string().min(1, 'Asset must not be empty'),
  destinationChain: z.enum(['P', 'X', 'C'], { message: 'Destination chain must be P, X, or C' }),
  fee: z.string().min(1, 'Fee must not be empty'),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  sourceChain: z.enum(['P', 'X', 'C'], { message: 'Source chain must be P, X, or C' }),
  status: z.enum(['accepted', 'processing', 'rejected'], {
    message: 'Status must be accepted, processing, or rejected',
  }),
  timestamp: z.string().min(1, 'Timestamp must not be empty'),
  type: z.enum(['import', 'export'], { message: 'Type must be import or export' }),
});

/**
 * Schema for Avalanche network configuration
 */
export const AvalancheNetworkSchema = z.object({
  apiKey: z.string().optional(),
  apiUrl: z.string().min(1, 'API URL must not be empty'),
  blockExplorerUrls: z.array(z.string().min(1, 'Block explorer URL must not be empty')),
  chainId: z.number().positive('Chain ID must be positive'),
  name: z.string().min(1, 'Network name must not be empty'),
  nativeCurrency: z.object({
    decimals: z.number().min(0, 'Decimals must be non-negative'),
    name: z.string().min(1, 'Currency name must not be empty'),
    symbol: z.string().min(1, 'Currency symbol must not be empty'),
  }),
  rpcUrls: z.array(z.string().min(1, 'RPC URL must not be empty')),
});

/**
 * Validation result type
 */
export interface ValidationResult {
  errors: string[];
  isValid: boolean;
  warnings: string[];
}
