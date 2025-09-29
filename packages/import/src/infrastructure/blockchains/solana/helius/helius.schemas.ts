import { z } from 'zod';

import { SolanaTokenBalanceSchema } from '../schemas.ts';

/**
 * Schema for Helius transaction meta structure
 */
export const HeliusTransactionMetaSchema = z.object({
  err: z.unknown().nullable(),
  fee: z.number().nonnegative('Fee must be non-negative'),
  logMessages: z.array(z.string()),
  postBalances: z.array(z.number()),
  postTokenBalances: z.array(SolanaTokenBalanceSchema).optional(),
  preBalances: z.array(z.number()),
  preTokenBalances: z.array(SolanaTokenBalanceSchema).optional(),
});

/**
 * Schema for Helius transaction message structure
 */
export const HeliusTransactionMessageSchema = z.object({
  accountKeys: z.array(z.string().min(1, 'Account key must not be empty')),
  instructions: z.array(z.unknown()),
  recentBlockhash: z.string().min(1, 'Recent blockhash must not be empty'),
});

/**
 * Schema for Helius transaction structure
 */
export const HeliusTransactionSchema = z.object({
  blockTime: z.number().optional(),
  err: z.unknown().nullable(),
  meta: HeliusTransactionMetaSchema,
  signature: z.string().min(1, 'Signature must not be empty').optional(),
  slot: z.number().nonnegative('Slot must be non-negative'),
  transaction: z.object({
    message: HeliusTransactionMessageSchema,
    signatures: z.array(z.string().min(1, 'Signature must not be empty')),
  }),
  version: z.number().or(z.string()).optional(),
});

/**
 * Schema for Solana raw transaction data (Helius format)
 */
export const SolanaRawTransactionDataSchema = z.object({
  normal: z.array(HeliusTransactionSchema),
});

/**
 * Schema for Helius asset response
 */
export const HeliusAssetResponseSchema = z.object({
  content: z.object({
    metadata: z.object({
      description: z.string().optional(),
      name: z.string().optional(),
      symbol: z.string().optional(),
    }),
  }),
});

/**
 * Schema for Helius signature response
 */
export const HeliusSignatureResponseSchema = z.object({
  blockTime: z.number().optional(),
  err: z.unknown().nullable(),
  memo: z.string(),
  signature: z.string().min(1, 'Signature must not be empty'),
  slot: z.number().nonnegative('Slot must be non-negative'),
});
