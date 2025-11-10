import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { BitcoinAddressSchema } from '../../schemas.js';

/**
 * Schema for Tatum BCash scriptSig
 */
export const TatumBCashScriptSigSchema = z.object({
  asm: z.string(),
  hex: z.string(),
});

/**
 * Schema for Tatum BCash transaction input (vin)
 */
export const TatumBCashVinSchema = z.object({
  coinbase: z.string().optional(),
  scriptSig: TatumBCashScriptSigSchema.optional(),
  sequence: z.number(),
  txid: z.string().optional(),
  vout: z.number().optional(),
});

/**
 * Schema for Tatum BCash scriptPubKey
 */
export const TatumBCashScriptPubKeySchema = z.object({
  addresses: z.array(BitcoinAddressSchema).optional(),
  asm: z.string(),
  hex: z.string(),
  type: z.string(),
});

/**
 * Schema for Tatum BCash transaction output (vout)
 */
export const TatumBCashVoutSchema = z.object({
  n: z.number().nonnegative(),
  scriptPubKey: TatumBCashScriptPubKeySchema,
  value: z.number().nonnegative('Output value must be non-negative'),
});

/**
 * Schema for validating Tatum BCash transaction format
 * BCash endpoint returns a different structure than Bitcoin/Dogecoin/Litecoin
 */
export const TatumBCashTransactionSchema = z.object({
  blockhash: z.string().optional(),
  blockheight: z.number().nonnegative().optional(),
  blocktime: z.number().positive().optional(),
  confirmations: z.number().nonnegative().optional(),
  locktime: z.number().nonnegative(),
  size: z.number().positive().optional(),
  time: z.number().positive().optional(),
  txid: z.string().min(1, 'Transaction hash must not be empty'),
  version: z.number(),
  vin: z.array(TatumBCashVinSchema).min(1, 'Transaction must have at least one input'),
  vout: z.array(TatumBCashVoutSchema).min(1, 'Transaction must have at least one output'),
});

/**
 * Schema for Tatum BCash balance response
 */
export const TatumBCashBalanceSchema = z.object({
  incoming: DecimalStringSchema,
  outgoing: DecimalStringSchema,
});

// Type exports inferred from schemas
export type TatumBCashScriptSig = z.infer<typeof TatumBCashScriptSigSchema>;
export type TatumBCashVin = z.infer<typeof TatumBCashVinSchema>;
export type TatumBCashScriptPubKey = z.infer<typeof TatumBCashScriptPubKeySchema>;
export type TatumBCashVout = z.infer<typeof TatumBCashVoutSchema>;
export type TatumBCashTransaction = z.infer<typeof TatumBCashTransactionSchema>;
export type TatumBCashBalance = z.infer<typeof TatumBCashBalanceSchema>;
