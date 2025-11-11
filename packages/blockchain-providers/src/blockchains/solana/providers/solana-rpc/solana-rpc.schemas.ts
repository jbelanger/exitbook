import { z } from 'zod';

import { timestampToDate } from '../../../../core/index.ts';
import {
  SolanaAddressSchema,
  SolanaTokenBalanceSchema,
  SolanaTokenAccountSchema,
  SolanaSignatureSchema,
  SolanaAccountBalanceSchema,
} from '../../schemas.ts';

/**
 * Schema for Solana RPC transaction header
 */
export const SolanaRPCHeaderSchema = z.object({
  numReadonlySignedAccounts: z.number().nonnegative('Num readonly signed accounts must be non-negative'),
  numReadonlyUnsignedAccounts: z.number().nonnegative('Num readonly unsigned accounts must be non-negative'),
  numRequiredSignatures: z.number().nonnegative('Num required signatures must be non-negative'),
});

/**
 * Schema for Solana RPC instruction
 */
export const SolanaRPCInstructionSchema = z.object({
  accounts: z.array(z.number()),
  data: z.string(),
  programIdIndex: z.number().nonnegative('Program ID index must be non-negative'),
});

/**
 * Schema for Solana RPC transaction message
 */
export const SolanaRPCMessageSchema = z.object({
  accountKeys: z.array(SolanaAddressSchema), // Solana addresses - case-sensitive
  header: SolanaRPCHeaderSchema,
  instructions: z.array(SolanaRPCInstructionSchema),
  recentBlockhash: z.string().min(1, 'Recent blockhash must not be empty'),
});

/**
 * Schema for Solana RPC transaction meta
 */
export const SolanaRPCMetaSchema = z.object({
  err: z
    .unknown()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
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
export const SolanaRPCTransactionSchema = z.object({
  blockTime: timestampToDate,
  meta: SolanaRPCMetaSchema,
  slot: z.number().nonnegative('Slot must be non-negative'),
  transaction: z.object({
    message: SolanaRPCMessageSchema,
    signatures: z.array(z.string().min(1, 'Signature must not be empty')),
  }),
});

/**
 * Schema for Solana RPC raw transaction data (single transaction)
 */
export const SolanaRPCRawTransactionDataSchema = SolanaRPCTransactionSchema;

/**
 * Schema for Solana RPC raw balance data
 */
export const SolanaRPCRawBalanceDataSchema = z.object({
  lamports: z.number().nonnegative('Lamports must be non-negative'),
});

/**
 * Schema for Solana token accounts response
 */
export const SolanaTokenAccountsResponseSchema = z.object({
  value: z.array(SolanaTokenAccountSchema),
});

/**
 * Schema for Solana RPC raw token balance data
 */
export const SolanaRPCRawTokenBalanceDataSchema = z.object({
  tokenAccounts: SolanaTokenAccountsResponseSchema,
});

/**
 * JSON-RPC wrapper schemas for Solana RPC API responses
 */
export const SolanaRPCBalanceJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  result: SolanaAccountBalanceSchema.optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export const SolanaRPCSignaturesJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  result: z.array(SolanaSignatureSchema).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export const SolanaRPCTransactionJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  result: SolanaRPCTransactionSchema.nullable().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export const SolanaRPCTokenAccountsJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  result: SolanaTokenAccountsResponseSchema.optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

// Type exports inferred from schemas
export type SolanaRPCHeader = z.infer<typeof SolanaRPCHeaderSchema>;
export type SolanaRPCInstruction = z.infer<typeof SolanaRPCInstructionSchema>;
export type SolanaRPCMessage = z.infer<typeof SolanaRPCMessageSchema>;
export type SolanaRPCMeta = z.infer<typeof SolanaRPCMetaSchema>;
export type SolanaRPCTransaction = z.infer<typeof SolanaRPCTransactionSchema>;
export type SolanaRPCRawBalanceData = z.infer<typeof SolanaRPCRawBalanceDataSchema>;
export type SolanaTokenAccountsResponse = z.infer<typeof SolanaTokenAccountsResponseSchema>;
export type SolanaRPCRawTokenBalanceData = z.infer<typeof SolanaRPCRawTokenBalanceDataSchema>;
export type SolanaRPCBalanceJsonRpcResponse = z.infer<typeof SolanaRPCBalanceJsonRpcResponseSchema>;
export type SolanaRPCSignaturesJsonRpcResponse = z.infer<typeof SolanaRPCSignaturesJsonRpcResponseSchema>;
export type SolanaRPCTransactionJsonRpcResponse = z.infer<typeof SolanaRPCTransactionJsonRpcResponseSchema>;
export type SolanaRPCTokenAccountsJsonRpcResponse = z.infer<typeof SolanaRPCTokenAccountsJsonRpcResponseSchema>;
