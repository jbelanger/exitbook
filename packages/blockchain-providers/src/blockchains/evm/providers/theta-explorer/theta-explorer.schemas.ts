import { z } from 'zod';

import { timestampToDate } from '../../../../core/utils/zod-utils.js';
import { EvmAddressSchema } from '../../schemas.js';

/**
 * Schema for Theta blockchain coin balances
 */
export const ThetaCoinsSchema = z.object({
  tfuelwei: z.string().regex(/^\d+$/, 'TFuel wei must be numeric string'),
  thetawei: z.string().regex(/^\d+$/, 'Theta wei must be numeric string'),
});

/**
 * Schema for Theta account information
 */
export const ThetaAccountSchema = z.object({
  address: EvmAddressSchema,
  coins: ThetaCoinsSchema,
  sequence: z.string().optional(),
  signature: z.string().optional(),
});

/**
 * Schema for send transaction data (type 2)
 */
export const ThetaSendTransactionDataSchema = z.object({
  fee: ThetaCoinsSchema.optional(),
  inputs: z.array(ThetaAccountSchema).optional(),
  outputs: z.array(ThetaAccountSchema).optional(),
  source: ThetaAccountSchema.optional(),
  target: ThetaAccountSchema.optional(),
});

/**
 * Schema for smart contract transaction data (type 7)
 */
export const ThetaSmartContractDataSchema = z.object({
  from: ThetaAccountSchema,
  gas_limit: z.string().regex(/^\d+$/, 'Gas limit must be numeric string'),
  gas_price: z.string().regex(/^\d+$/, 'Gas price must be numeric string'),
  to: ThetaAccountSchema,
});

/**
 * Schema capturing any Theta transaction data payload
 */
export const ThetaTransactionDataSchema = z.union([
  ThetaSendTransactionDataSchema,
  ThetaSmartContractDataSchema,
  z.record(z.string(), z.unknown()),
]);

/**
 * Schema for Theta transaction types
 */
export const ThetaTransactionTypeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);

/**
 * Schema for Theta transaction
 * Note: data field is permissive to handle various transaction types
 */
export const ThetaTransactionSchema = z.object({
  block_height: z.string().regex(/^\d+$/, 'Block height must be numeric string'),
  data: ThetaTransactionDataSchema,
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  number: z.number().optional(),
  timestamp: timestampToDate,
  type: ThetaTransactionTypeSchema,
});

/**
 * Schema for account transaction history response
 */
export const ThetaAccountTxResponseSchema = z.object({
  body: z.array(ThetaTransactionSchema),
  currentPageNumber: z.number(),
  totalPageNumber: z.number(),
  type: z.literal('account_tx_list'),
});

/**
 * Schema for arrays of Theta transactions
 */
export const ThetaTransactionArraySchema = z.array(ThetaTransactionSchema);

// Type exports inferred from schemas
export type ThetaCoins = z.infer<typeof ThetaCoinsSchema>;
export type ThetaAccount = z.infer<typeof ThetaAccountSchema>;
export type ThetaSendTransactionData = z.infer<typeof ThetaSendTransactionDataSchema>;
export type ThetaSmartContractData = z.infer<typeof ThetaSmartContractDataSchema>;
export type ThetaTransactionData = z.infer<typeof ThetaTransactionDataSchema>;
export type ThetaTransactionType = z.infer<typeof ThetaTransactionTypeSchema>;
export type ThetaTransaction = z.infer<typeof ThetaTransactionSchema>;
export type ThetaAccountTxResponse = z.infer<typeof ThetaAccountTxResponseSchema>;
