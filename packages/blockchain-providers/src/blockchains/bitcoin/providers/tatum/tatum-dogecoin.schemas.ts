import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { BitcoinAddressSchema } from '../../schemas.js';

/**
 * Schema for Tatum Dogecoin transaction input coin
 * Dogecoin endpoint returns values as strings (in DOGE, not satoshis)
 */
export const TatumDogecoinCoinSchema = z.object({
  address: BitcoinAddressSchema.nullish(),
  coinbase: z.boolean(),
  height: z.number(),
  reqSigs: z.number().nullish(),
  script: z.string(),
  type: z.string().nullish(),
  value: DecimalStringSchema, // String in DOGE (e.g., "0.0989946")
  version: z.number(),
});

/**
 * Schema for Tatum Dogecoin transaction input prevout
 */
export const TatumDogecoinPrevoutSchema = z.object({
  hash: z.string().min(1, 'Prevout hash must not be empty'),
  index: z.number().nonnegative(),
});

/**
 * Schema for Tatum Dogecoin transaction input
 */
export const TatumDogecoinInputSchema = z.object({
  coin: TatumDogecoinCoinSchema.nullish(),
  prevout: TatumDogecoinPrevoutSchema.nullish(),
  script: z.string(),
  sequence: z.number(),
  witness: z.string().nullish(),
});

/**
 * Schema for Tatum Dogecoin transaction output scriptPubKey
 */
export const TatumDogecoinScriptPubKeySchema = z.object({
  reqSigs: z.number().nullish(),
  type: z.string(),
});

/**
 * Schema for Tatum Dogecoin transaction output
 */
export const TatumDogecoinOutputSchema = z.object({
  address: BitcoinAddressSchema.nullish(),
  script: z.string(),
  scriptPubKey: TatumDogecoinScriptPubKeySchema,
  value: DecimalStringSchema, // String in DOGE (e.g., "0.0015")
});

/**
 * Schema for validating Tatum Dogecoin transaction format
 * Dogecoin uses string values for amounts (in DOGE, not satoshis)
 */
export const TatumDogecoinTransactionSchema = z.object({
  block: z.string(),
  blockNumber: z.number().nonnegative(),
  fee: DecimalStringSchema, // String in DOGE (e.g., "0.00001682")
  flag: z.number().nullish(),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  hex: z.string().nullish(),
  index: z.number().nonnegative(),
  inputs: z.array(TatumDogecoinInputSchema).min(1, 'Transaction must have at least one input'),
  locktime: z.number().nonnegative(),
  mtime: z.number().nullish(),
  outputs: z.array(TatumDogecoinOutputSchema).min(1, 'Transaction must have at least one output'),
  ps: z.number().nullish(),
  rate: DecimalStringSchema.nullish(),
  size: z.number().positive().nullish(),
  time: z.number().positive('Time must be positive'),
  version: z.number(),
  vsize: z.number().positive().nullish(),
  weight: z.number().positive().nullish(),
  witnessHash: z.string(),
});

/**
 * Schema for Tatum Dogecoin balance response
 */
export const TatumDogecoinBalanceSchema = z.object({
  incoming: DecimalStringSchema,
  outgoing: DecimalStringSchema,
});

// Type exports inferred from schemas
export type TatumDogecoinCoin = z.infer<typeof TatumDogecoinCoinSchema>;
export type TatumDogecoinPrevout = z.infer<typeof TatumDogecoinPrevoutSchema>;
export type TatumDogecoinInput = z.infer<typeof TatumDogecoinInputSchema>;
export type TatumDogecoinScriptPubKey = z.infer<typeof TatumDogecoinScriptPubKeySchema>;
export type TatumDogecoinOutput = z.infer<typeof TatumDogecoinOutputSchema>;
export type TatumDogecoinTransaction = z.infer<typeof TatumDogecoinTransactionSchema>;
export type TatumDogecoinBalance = z.infer<typeof TatumDogecoinBalanceSchema>;
