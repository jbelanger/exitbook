import { z } from 'zod';

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
  address: z.string().min(1, 'Address must not be empty'),
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
 * Schema for Theta transaction
 * Note: data field is permissive to handle various transaction types
 */
export const ThetaTransactionSchema = z.object({
  block_height: z.string().regex(/^\d+$/, 'Block height must be numeric string'),
  data: z.record(z.string(), z.unknown()),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  number: z.number().optional(),
  timestamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
  type: z.number().int().min(0).max(9),
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
