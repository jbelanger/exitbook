/**
 * Zod validation schemas for Routescan (Etherscan-compatible) transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from Routescan API before processing.
 */
import { DecimalStringSchema, IntegerStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { timestampToDate } from '../../../../core/utils/zod-utils.js';
import { EvmAddressSchema } from '../../schemas.js';

/**
 * Schema for Routescan normal transaction structure
 */
export const RoutescanTransactionSchema = z.object({
  blockHash: z.string().nullish(),
  blockNumber: IntegerStringSchema,
  confirmations: IntegerStringSchema,
  contractAddress: z.string().nullish(),
  cumulativeGasUsed: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  from: EvmAddressSchema,
  functionName: z.string().nullish(),
  gas: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  gasPrice: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  gasUsed: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().nullish(),
  methodId: z.string().nullish(),
  nonce: z.preprocess((v) => (v === '' ? undefined : v), IntegerStringSchema.nullish()),
  timeStamp: timestampToDate,
  to: EvmAddressSchema,
  transactionIndex: IntegerStringSchema,
  txreceipt_status: z.string().nullish(),
  value: DecimalStringSchema,
});

/**
 * Schema for Routescan internal transaction structure
 */
export const RoutescanInternalTransactionSchema = z.object({
  blockNumber: IntegerStringSchema,
  contractAddress: EvmAddressSchema,
  errCode: z.string(),
  from: EvmAddressSchema,
  gas: DecimalStringSchema,
  gasUsed: DecimalStringSchema,
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().min(1, 'IsError must not be empty'),
  timeStamp: timestampToDate,
  to: EvmAddressSchema,
  traceId: z.string().min(1, 'Trace ID must not be empty'),
  type: z.string().min(1, 'Type must not be empty'),
  value: DecimalStringSchema,
});

/**
 * Schema for Routescan token transfer structure
 */
export const RoutescanTokenTransferSchema = z.object({
  blockHash: z.string().nullish(),
  blockNumber: IntegerStringSchema,
  confirmations: IntegerStringSchema,
  contractAddress: EvmAddressSchema,
  cumulativeGasUsed: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  from: EvmAddressSchema,
  gas: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  gasPrice: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  gasUsed: z.preprocess((v) => (v === '' ? undefined : v), DecimalStringSchema.nullish()),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  nonce: z.preprocess((v) => (v === '' ? undefined : v), IntegerStringSchema.nullish()),
  timeStamp: timestampToDate,
  to: EvmAddressSchema,
  tokenDecimal: IntegerStringSchema,
  tokenName: z.string(),
  tokenSymbol: z.string(),
  transactionIndex: IntegerStringSchema,
  value: DecimalStringSchema,
});

/**
 * Schema for Routescan API response wrapper (generic)
 */
export const RoutescanApiResponseSchema = z.object({
  message: z.string().min(1, 'Message must not be empty'),
  result: z.array(z.any()), // Can be various transaction types
  status: z.string().min(1, 'Status must not be empty'),
});

/**
 * Specific response schemas for each endpoint
 * Note: result can be a string when status !== '1' (error cases like "Max rate limit reached")
 */
export const RoutescanTransactionsResponseSchema = z.object({
  message: z.string(),
  result: z.union([z.array(RoutescanTransactionSchema), z.string()]),
  status: z.string(),
});

export const RoutescanInternalTransactionsResponseSchema = z.object({
  message: z.string(),
  result: z.union([z.array(RoutescanInternalTransactionSchema), z.string()]),
  status: z.string(),
});

export const RoutescanTokenTransfersResponseSchema = z.object({
  message: z.string(),
  result: z.union([z.array(RoutescanTokenTransferSchema), z.string()]),
  status: z.string(),
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
  account: EvmAddressSchema,
  balance: DecimalStringSchema,
});

/**
 * Schema for Routescan token balance structure
 */
export const RoutescanTokenBalanceSchema = z.object({
  TokenAddress: EvmAddressSchema,
  TokenDivisor: IntegerStringSchema,
  TokenName: z.string(),
  TokenQuantity: DecimalStringSchema,
  TokenSymbol: z.string(),
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
