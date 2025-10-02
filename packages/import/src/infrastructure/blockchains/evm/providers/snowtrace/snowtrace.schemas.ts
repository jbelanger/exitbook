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
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  confirmations: z.string().regex(/^\d+$/, 'Confirmations must be numeric string'),
  cumulativeGasUsed: z.string().regex(/^\d+$/, 'Cumulative gas used must be numeric string'),
  from: z.string().min(1, 'From address must not be empty'),
  functionName: z.string().optional(),
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasPrice: z.string().regex(/^\d+$/, 'Gas price must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().optional(),
  methodId: z.string().optional(),
  nonce: z.string().regex(/^\d+$/, 'Nonce must be numeric string'),
  timeStamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string (Unix seconds)'),
  to: z.string().min(1, 'To address must not be empty'),
  transactionIndex: z.string().regex(/^\d+$/, 'Transaction index must be numeric string'),
  txreceipt_status: z.string().optional(),
  value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
});

/**
 * Schema for Snowtrace internal transaction structure
 */
export const SnowtraceInternalTransactionSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  contractAddress: z.string(),
  errCode: z.string(),
  from: z.string().min(1, 'From address must not be empty'),
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().min(1, 'IsError must not be empty'),
  timeStamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string (Unix seconds)'),
  to: z.string().min(1, 'To address must not be empty'),
  traceId: z.string().min(1, 'Trace ID must not be empty'),
  type: z.string().min(1, 'Type must not be empty'),
  value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
});

/**
 * Schema for Snowtrace token transfer structure
 */
export const SnowtraceTokenTransferSchema = z.object({
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  confirmations: z.string().regex(/^\d+$/, 'Confirmations must be numeric string'),
  contractAddress: z.string().min(1, 'Contract address must not be empty'),
  cumulativeGasUsed: z.string().regex(/^\d+$/, 'Cumulative gas used must be numeric string'),
  from: z.string().min(1, 'From address must not be empty'),
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasPrice: z.string().regex(/^\d+$/, 'Gas price must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  nonce: z.string().regex(/^\d+$/, 'Nonce must be numeric string'),
  timeStamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string (Unix seconds)'),
  to: z.string().min(1, 'To address must not be empty'),
  tokenDecimal: z.string().regex(/^\d+$/, 'Token decimal must be numeric string'),
  tokenName: z.string().min(1, 'Token name must not be empty'),
  tokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
  transactionIndex: z.string().regex(/^\d+$/, 'Transaction index must be numeric string'),
  value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
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
  balance: z.string().regex(/^\d+$/, 'Balance must be numeric string'),
});

/**
 * Schema for Snowtrace token balance structure
 */
export const SnowtraceTokenBalanceSchema = z.object({
  TokenAddress: z.string().min(1, 'Token address must not be empty'),
  TokenDivisor: z.string().regex(/^\d+$/, 'Token divisor must be numeric string'),
  TokenName: z.string().min(1, 'Token name must not be empty'),
  TokenQuantity: z.string().regex(/^\d+$/, 'Token quantity must be numeric string'),
  TokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
});

/**
 * Schema for Avalanche atomic transaction structure
 */
export const AtomicTransactionSchema = z.object({
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'),
  asset: z.string().min(1, 'Asset must not be empty'),
  destinationChain: z.enum(['P', 'X', 'C'], { message: 'Destination chain must be P, X, or C' }),
  fee: z.string().regex(/^\d+$/, 'Fee must be numeric string'),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  sourceChain: z.enum(['P', 'X', 'C'], { message: 'Source chain must be P, X, or C' }),
  status: z.enum(['accepted', 'processing', 'rejected'], {
    message: 'Status must be accepted, processing, or rejected',
  }),
  timestamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string (Unix seconds)'),
  type: z.enum(['import', 'export'], { message: 'Type must be import or export' }),
});

/**
 * Union schema that can validate any of the three Snowtrace transaction types
 * Order matters: most specific schemas (with more required fields) should come first
 */
export const SnowtraceAnyTransactionSchema = z.union([
  SnowtraceTokenTransferSchema, // Most specific - has token fields
  SnowtraceInternalTransactionSchema, // Medium specificity - has internal transaction fields
  SnowtraceTransactionSchema, // Least specific - basic transaction fields
]);
