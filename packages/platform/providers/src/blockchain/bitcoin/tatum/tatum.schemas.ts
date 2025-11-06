import { z } from 'zod';

import { BitcoinAddressSchema } from '../schemas.js';

/**
 * Schema for Tatum Bitcoin transaction input coin
 */
export const TatumBitcoinCoinSchema = z.object({
  address: BitcoinAddressSchema,
  coinbase: z.boolean(),
  height: z.number(),
  reqSigs: z
    .number()
    .nullish()
    .optional()
    .transform((val) => val ?? undefined),
  script: z.string(),
  type: z
    .string()
    .nullish()
    .optional()
    .transform((val) => val ?? undefined),
  value: z.number().nonnegative('Value must be non-negative'),
  version: z.number(),
});

/**
 * Schema for Tatum Bitcoin transaction input prevout
 */
export const TatumBitcoinPrevoutSchema = z.object({
  hash: z.string().min(1, 'Prevout hash must not be empty'),
  index: z.number().nonnegative(),
});

/**
 * Schema for Tatum Bitcoin transaction input
 */
export const TatumBitcoinInputSchema = z.object({
  coin: TatumBitcoinCoinSchema,
  prevout: TatumBitcoinPrevoutSchema,
  script: z.string(),
  sequence: z.number(),
});

/**
 * Schema for Tatum Bitcoin transaction output scriptPubKey
 */
export const TatumBitcoinScriptPubKeySchema = z.object({
  reqSigs: z
    .number()
    .nullish()
    .optional()
    .transform((val) => val ?? undefined),
  type: z.string(),
});

/**
 * Schema for Tatum Bitcoin transaction output
 */
export const TatumBitcoinOutputSchema = z.object({
  address: BitcoinAddressSchema.nullable()
    .optional()
    .transform((val) => val ?? undefined),
  script: z.string(),
  scriptPubKey: TatumBitcoinScriptPubKeySchema,
  value: z.number().nonnegative('Output value must be non-negative'),
});

/**
 * Schema for validating Tatum Bitcoin transaction format
 */
export const TatumBitcoinTransactionSchema = z
  .object({
    block: z.string(),
    blockNumber: z.number().nonnegative(),
    fee: z.number().nonnegative('Fee must be non-negative'),
    hash: z.string().min(1, 'Transaction hash must not be empty'),
    hex: z.string(),
    index: z.number().nonnegative(),
    inputs: z.array(TatumBitcoinInputSchema).min(1, 'Transaction must have at least one input'),
    locktime: z.number().nonnegative(),
    outputs: z.array(TatumBitcoinOutputSchema).min(1, 'Transaction must have at least one output'),
    size: z.number().positive('Size must be positive'),
    time: z.number().positive('Time must be positive'),
    version: z.number(),
    vsize: z.number().positive('Virtual size must be positive'),
    weight: z.number().positive('Weight must be positive'),
    witnessHash: z.string(),
  })
  .strict();

/**
 * Schema for Tatum Bitcoin balance response
 */
export const TatumBitcoinBalanceSchema = z.object({
  incoming: z.string().min(1, 'Incoming balance must not be empty'),
  outgoing: z.string().min(1, 'Outgoing balance must not be empty'),
});

// Type exports inferred from schemas
export type TatumBitcoinCoin = z.infer<typeof TatumBitcoinCoinSchema>;
export type TatumBitcoinPrevout = z.infer<typeof TatumBitcoinPrevoutSchema>;
export type TatumBitcoinInput = z.infer<typeof TatumBitcoinInputSchema>;
export type TatumBitcoinScriptPubKey = z.infer<typeof TatumBitcoinScriptPubKeySchema>;
export type TatumBitcoinOutput = z.infer<typeof TatumBitcoinOutputSchema>;
export type TatumBitcoinTransaction = z.infer<typeof TatumBitcoinTransactionSchema>;
export type TatumBitcoinBalance = z.infer<typeof TatumBitcoinBalanceSchema>;
