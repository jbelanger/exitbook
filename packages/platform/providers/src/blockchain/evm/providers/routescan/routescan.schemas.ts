/**
 * Zod validation schemas for Routescan (Etherscan-compatible) transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from Routescan API before processing.
 */
import { z } from 'zod';

import { timestampToDate } from '../../../../core/blockchain/utils/zod-utils.js';

/**
 * Schema for Routescan normal transaction structure
 */
export const RoutescanTransactionSchema = z.object({
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
  timeStamp: timestampToDate,
  to: z.string().min(1, 'To address must not be empty'),
  transactionIndex: z.string().regex(/^\d+$/, 'Transaction index must be numeric string'),
  txreceipt_status: z.string().optional(),
  value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
});

/**
 * Schema for Routescan internal transaction structure
 */
export const RoutescanInternalTransactionSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  contractAddress: z.string(),
  errCode: z.string(),
  from: z.string().min(1, 'From address must not be empty'),
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().min(1, 'IsError must not be empty'),
  timeStamp: timestampToDate,
  to: z.string().min(1, 'To address must not be empty'),
  traceId: z.string().min(1, 'Trace ID must not be empty'),
  type: z.string().min(1, 'Type must not be empty'),
  value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
});

/**
 * Schema for Routescan token transfer structure
 */
export const RoutescanTokenTransferSchema = z.object({
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
  timeStamp: timestampToDate,
  to: z.string().min(1, 'To address must not be empty'),
  tokenDecimal: z.string().regex(/^\d+$/, 'Token decimal must be numeric string'),
  tokenName: z.string().min(1, 'Token name must not be empty'),
  tokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
  transactionIndex: z.string().regex(/^\d+$/, 'Transaction index must be numeric string'),
  value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
});

/**
 * Schema for Routescan API response wrapper
 */
export const RoutescanApiResponseSchema = z.object({
  message: z.string().min(1, 'Message must not be empty'),
  result: z.array(z.any()), // Can be various transaction types
  status: z.string().min(1, 'Status must not be empty'),
});

/**
 * Schema for Routescan balance response
 */
export const RoutescanBalanceResponseSchema = z.object({
  message: z.string().min(1, 'Message must not be empty'),
  result: z.string().min(1, 'Balance result must not be empty'),
  status: z.string().min(1, 'Status must not be empty'),
});

/**
 * Schema for Routescan balance structure
 */
export const RoutescanBalanceSchema = z.object({
  account: z.string().min(1, 'Account address must not be empty'),
  balance: z.string().regex(/^\d+$/, 'Balance must be numeric string'),
});

/**
 * Schema for Routescan token balance structure
 */
export const RoutescanTokenBalanceSchema = z.object({
  TokenAddress: z.string().min(1, 'Token address must not be empty'),
  TokenDivisor: z.string().regex(/^\d+$/, 'Token divisor must be numeric string'),
  TokenName: z.string().min(1, 'Token name must not be empty'),
  TokenQuantity: z.string().regex(/^\d+$/, 'Token quantity must be numeric string'),
  TokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
});

/**
 * Union schema that can validate any of the three Routescan transaction types
 * Order matters: most specific schemas (with more required fields) should come first
 */
export const RoutescanAnyTransactionSchema = z.union([
  RoutescanTokenTransferSchema, // Most specific - has token fields
  RoutescanInternalTransactionSchema, // Medium specificity - has internal transaction fields
  RoutescanTransactionSchema, // Least specific - basic transaction fields
]);

type RoutescanApiResponseBase = z.infer<typeof RoutescanApiResponseSchema>;
type RoutescanBalanceResponseBase = z.infer<typeof RoutescanBalanceResponseSchema>;

// Type exports inferred from schemas
export type RoutescanTransaction = z.infer<typeof RoutescanTransactionSchema>;
export type RoutescanInternalTransaction = z.infer<typeof RoutescanInternalTransactionSchema>;
export type RoutescanTokenTransfer = z.infer<typeof RoutescanTokenTransferSchema>;
export type RoutescanApiResponse<T = unknown> = Omit<RoutescanApiResponseBase, 'result'> & {
  result: T[];
};
export type RoutescanBalanceResponse = RoutescanBalanceResponseBase;
export type RoutescanBalance = z.infer<typeof RoutescanBalanceSchema>;
export type RoutescanTokenBalance = z.infer<typeof RoutescanTokenBalanceSchema>;
