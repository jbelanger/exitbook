import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { BitcoinAddressSchema } from '../../schemas.js';

/**
 * Schema for Tatum Litecoin transaction input coin
 * Litecoin endpoint returns values as strings (in LTC, not satoshis)
 */
export const TatumLitecoinCoinSchema = z.object({
  address: BitcoinAddressSchema.nullable()
    .optional()
    .transform((val) => val ?? undefined),
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
  value: DecimalStringSchema, // String in LTC (e.g., "0.0989946")
  version: z.number(),
});

/**
 * Schema for Tatum Litecoin transaction input prevout
 */
export const TatumLitecoinPrevoutSchema = z.object({
  hash: z.string().min(1, 'Prevout hash must not be empty'),
  index: z.number().nonnegative(),
});

/**
 * Schema for Tatum Litecoin transaction input
 */
export const TatumLitecoinInputSchema = z.object({
  coin: TatumLitecoinCoinSchema.nullable()
    .optional()
    .transform((val) => val ?? undefined),
  prevout: TatumLitecoinPrevoutSchema.nullable()
    .optional()
    .transform((val) => val ?? undefined),
  script: z.string(),
  sequence: z.number(),
  witness: z.string().optional(),
});

/**
 * Schema for Tatum Litecoin transaction output scriptPubKey
 */
export const TatumLitecoinScriptPubKeySchema = z.object({
  reqSigs: z
    .number()
    .nullish()
    .optional()
    .transform((val) => val ?? undefined),
  type: z.string(),
});

/**
 * Schema for Tatum Litecoin transaction output
 */
export const TatumLitecoinOutputSchema = z.object({
  address: BitcoinAddressSchema.nullable()
    .optional()
    .transform((val) => val ?? undefined),
  script: z.string(),
  scriptPubKey: TatumLitecoinScriptPubKeySchema,
  value: DecimalStringSchema, // String in LTC (e.g., "0.0015")
});

/**
 * Schema for validating Tatum Litecoin transaction format
 * Litecoin uses string values for amounts (in LTC, not satoshis)
 */
export const TatumLitecoinTransactionSchema = z.object({
  block: z.string(),
  blockNumber: z.number().nonnegative(),
  fee: DecimalStringSchema, // String in LTC (e.g., "0.00001682")
  flag: z.number().optional(),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  hex: z.string().optional(),
  index: z.number().nonnegative(),
  inputs: z.array(TatumLitecoinInputSchema).min(1, 'Transaction must have at least one input'),
  locktime: z.number().nonnegative(),
  mtime: z.number().optional(),
  outputs: z.array(TatumLitecoinOutputSchema).min(1, 'Transaction must have at least one output'),
  ps: z.number().optional(),
  rate: DecimalStringSchema.optional(),
  size: z.number().positive().optional(),
  time: z.number().positive('Time must be positive'),
  version: z.number(),
  vsize: z.number().positive().optional(),
  weight: z.number().positive().optional(),
  witnessHash: z.string(),
});

/**
 * Schema for Tatum Litecoin balance response
 */
export const TatumLitecoinBalanceSchema = z.object({
  incoming: DecimalStringSchema,
  outgoing: DecimalStringSchema,
});

// Type exports inferred from schemas
export type TatumLitecoinCoin = z.infer<typeof TatumLitecoinCoinSchema>;
export type TatumLitecoinPrevout = z.infer<typeof TatumLitecoinPrevoutSchema>;
export type TatumLitecoinInput = z.infer<typeof TatumLitecoinInputSchema>;
export type TatumLitecoinScriptPubKey = z.infer<typeof TatumLitecoinScriptPubKeySchema>;
export type TatumLitecoinOutput = z.infer<typeof TatumLitecoinOutputSchema>;
export type TatumLitecoinTransaction = z.infer<typeof TatumLitecoinTransactionSchema>;
export type TatumLitecoinBalance = z.infer<typeof TatumLitecoinBalanceSchema>;
