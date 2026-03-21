import { z } from 'zod';

import { timestampToDate } from '../../../../normalization/schema-transforms.js';
import {
  SolanaAddressSchema,
  SolanaTokenBalanceSchema,
  SolanaTokenAccountSchema,
  SolanaAccountBalanceSchema,
} from '../../schemas.js';

/**
 * Schema for Solana RPC transaction header
 */
const SolanaRPCHeaderSchema = z.object({
  numReadonlySignedAccounts: z.number().nonnegative('Num readonly signed accounts must be non-negative'),
  numReadonlyUnsignedAccounts: z.number().nonnegative('Num readonly unsigned accounts must be non-negative'),
  numRequiredSignatures: z.number().nonnegative('Num required signatures must be non-negative'),
});

/**
 * Schema for Solana RPC instruction
 */
const SolanaRPCInstructionSchema = z.object({
  accounts: z.array(z.number()),
  data: z.string(),
  programIdIndex: z.number().nonnegative('Program ID index must be non-negative'),
});

/**
 * Schema for Solana RPC transaction message
 */
const SolanaRPCMessageSchema = z.object({
  accountKeys: z.array(SolanaAddressSchema), // Solana addresses - case-sensitive
  header: SolanaRPCHeaderSchema,
  instructions: z.array(SolanaRPCInstructionSchema),
  recentBlockhash: z.string().min(1, 'Recent blockhash must not be empty'),
});

/**
 * Schema for Solana RPC transaction meta
 */
const SolanaRPCMetaSchema = z.object({
  err: z.unknown().nullish(),
  fee: z.number().nonnegative('Fee must be non-negative'),
  innerInstructions: z.array(z.unknown()),
  logMessages: z.array(z.string()),
  postBalances: z.array(z.number()),
  postTokenBalances: z.array(SolanaTokenBalanceSchema),
  preBalances: z.array(z.number()),
  preTokenBalances: z.array(SolanaTokenBalanceSchema),
  rewards: z.array(z.unknown()),
  status: z.union([z.object({ Ok: z.null() }), z.object({ Err: z.unknown() })]),
});

/**
 * Schema for Solana RPC transaction structure
 */
const _SolanaRPCTransactionSchema = z.object({
  blockTime: timestampToDate,
  meta: SolanaRPCMetaSchema,
  slot: z.number().nonnegative('Slot must be non-negative'),
  transaction: z.object({
    message: SolanaRPCMessageSchema,
    signatures: z.array(z.string().min(1, 'Signature must not be empty')),
  }),
});

/**
 * Schema for Solana token accounts response
 */
const SolanaTokenAccountsResponseSchema = z.object({
  value: z.array(SolanaTokenAccountSchema),
});

/**
 * JSON-RPC wrapper schemas for Solana RPC API responses
 */
export const SolanaRPCBalanceJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: SolanaAccountBalanceSchema.nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

export const SolanaRPCTokenAccountsJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: SolanaTokenAccountsResponseSchema.nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

// Type exports inferred from schemas
export type SolanaRPCTransaction = z.infer<typeof _SolanaRPCTransactionSchema>;
export type SolanaTokenAccountsResponse = z.infer<typeof SolanaTokenAccountsResponseSchema>;
