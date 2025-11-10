import { z } from 'zod';

import { timestampToDate } from '../../../../core/index.ts';
import { SolanaTokenBalanceSchema, SolanaAddressSchema } from '../../schemas.ts';

/**
 * Schema for Helius transaction meta structure
 */
export const HeliusTransactionMetaSchema = z.object({
  err: z
    .unknown()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
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
  accountKeys: z.array(SolanaAddressSchema), // Solana addresses - case-sensitive
  instructions: z.array(z.unknown()),
  recentBlockhash: z.string().min(1, 'Recent blockhash must not be empty'),
});

/**
 * Schema for Helius transaction structure
 */
export const HeliusTransactionSchema = z.object({
  blockTime: timestampToDate.optional(),
  err: z
    .unknown()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
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
 * Schema for Solana raw transaction data (Helius format - single transaction)
 */
export const SolanaRawTransactionDataSchema = HeliusTransactionSchema;

/**
 * Schema for Helius asset response
 */
export const HeliusAssetResponseSchema = z.object({
  content: z
    .object({
      links: z
        .object({
          image: z.string().optional(),
        })
        .optional(),
      metadata: z.object({
        description: z.string().optional(),
        name: z.string().optional(),
        symbol: z.string().optional(),
        token_standard: z.string().optional(),
      }),
    })
    .optional(),
  token_info: z
    .object({
      decimals: z.number().optional(),
      supply: z.number().optional(),
    })
    .optional(),
});

/**
 * Schema for Helius signature response
 */
export const HeliusSignatureResponseSchema = z.object({
  blockTime: timestampToDate.optional(),
  err: z
    .unknown()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
  memo: z.string(),
  signature: z.string().min(1, 'Signature must not be empty'),
  slot: z.number().nonnegative('Slot must be non-negative'),
});

// Type exports inferred from schemas
export type HeliusTransactionMeta = z.infer<typeof HeliusTransactionMetaSchema>;
export type HeliusTransactionMessage = z.infer<typeof HeliusTransactionMessageSchema>;
export type HeliusTransaction = z.infer<typeof HeliusTransactionSchema>;
export type HeliusAssetResponse = z.infer<typeof HeliusAssetResponseSchema>;
export type HeliusSignatureResponse = z.infer<typeof HeliusSignatureResponseSchema>;
