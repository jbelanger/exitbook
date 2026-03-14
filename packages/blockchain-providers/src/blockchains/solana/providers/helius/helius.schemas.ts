import { z } from 'zod';

import { timestampToDate } from '../../../../core/index.js';
import {
  SolanaTokenBalanceSchema,
  SolanaAddressSchema,
  SolanaSignatureSchema,
  SolanaAccountBalanceSchema,
  SolanaTokenAccountSchema,
} from '../../schemas.js';

/**
 * Schema for Helius transaction meta structure
 */
const HeliusTransactionMetaSchema = z.object({
  err: z.unknown().nullish(),
  fee: z.number().nonnegative('Fee must be non-negative'),
  logMessages: z.array(z.string()),
  postBalances: z.array(z.number()),
  postTokenBalances: z.array(SolanaTokenBalanceSchema).nullish(),
  preBalances: z.array(z.number()),
  preTokenBalances: z.array(SolanaTokenBalanceSchema).nullish(),
});

/**
 * Schema for Helius compiled instruction structure
 */
const HeliusCompiledInstructionSchema = z.object({
  programIdIndex: z.number().int().nonnegative(),
  accounts: z.array(z.number().int().nonnegative()),
  data: z.string(),
  stackHeight: z.number().int().nonnegative().nullish(),
});

/**
 * Schema for Helius transaction message structure
 */
const HeliusTransactionMessageSchema = z.object({
  accountKeys: z.array(SolanaAddressSchema), // Solana addresses - case-sensitive
  instructions: z.array(HeliusCompiledInstructionSchema),
  recentBlockhash: z.string().min(1, 'Recent blockhash must not be empty'),
});

/**
 * Schema for Helius transaction structure
 */
export const HeliusTransactionSchema = z.object({
  blockTime: timestampToDate.nullish(),
  err: z.unknown().nullish(),
  meta: HeliusTransactionMetaSchema,
  signature: z.string().min(1, 'Signature must not be empty').nullish(),
  slot: z.number().nonnegative('Slot must be non-negative'),
  transaction: z.object({
    message: HeliusTransactionMessageSchema,
    signatures: z.array(z.string().min(1, 'Signature must not be empty')),
  }),
  version: z.number().or(z.string()).nullish(),
});

/**
 * Schema for Helius asset response
 */
export const HeliusAssetResponseSchema = z.object({
  content: z
    .object({
      links: z
        .object({
          image: z.string().nullish(),
        })
        .nullish(),
      metadata: z.object({
        description: z.string().nullish(),
        name: z.string().nullish(),
        symbol: z.string().nullish(),
        token_standard: z.string().nullish(),
      }),
    })
    .nullish(),
  token_info: z
    .object({
      decimals: z.number().nullish(),
      supply: z.number().nullish(),
    })
    .nullish(),
});

/**
 * JSON-RPC wrapper schemas for Helius API responses
 */
export const HeliusAssetJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: z.union([HeliusAssetResponseSchema, z.array(HeliusAssetResponseSchema)]).nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

export const HeliusSignaturesJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: z.array(SolanaSignatureSchema).nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

export const HeliusTransactionJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: HeliusTransactionSchema.nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

export const HeliusBalanceJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: SolanaAccountBalanceSchema.nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

export const SolanaTokenAccountsResponseSchema = z.object({
  value: z.array(SolanaTokenAccountSchema),
});

export const HeliusTokenAccountsJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: SolanaTokenAccountsResponseSchema.nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

// Type exports inferred from schemas
export type HeliusTransaction = z.infer<typeof HeliusTransactionSchema>;
export type HeliusAssetResponse = z.infer<typeof HeliusAssetResponseSchema>;
