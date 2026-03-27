import { z } from 'zod';

import { timestampToDate } from '../../../../normalization/schema-transforms.js';
import { SolanaAddressSchema } from '../../schemas.js';

/**
 * Schema for Solscan input account structure
 */
const SolscanInputAccountSchema = z.object({
  account: SolanaAddressSchema, // Solana address - case-sensitive
  postBalance: z.number().nonnegative('Post balance must be non-negative'),
  preBalance: z.number().nonnegative('Pre balance must be non-negative'),
  signer: z.boolean(),
  writable: z.boolean(),
});

/**
 * Schema for Solscan parsed instruction structure
 */
const SolscanParsedInstructionSchema = z.object({
  params: z.record(z.string(), z.unknown()).nullish(),
  program: z.string().min(1, 'Program must not be empty'),
  programId: SolanaAddressSchema, // Program address - case-sensitive
  type: z.string().min(1, 'Type must not be empty'),
});

/**
 * Schema for Solscan transaction structure
 */
export const SolscanTransactionSchema = z.object({
  blockTime: timestampToDate,
  fee: z.number().nonnegative('Fee must be non-negative'),
  inputAccount: z.array(SolscanInputAccountSchema),
  lamport: z.number(),
  logMessage: z.array(z.string()),
  parsedInstruction: z.array(SolscanParsedInstructionSchema),
  recentBlockhash: z.string().min(1, 'Recent blockhash must not be empty'),
  signer: z.array(SolanaAddressSchema), // Signer addresses - case-sensitive
  slot: z.number().nonnegative('Slot must be non-negative'),
  status: z.enum(['Success', 'Fail'], { message: 'Status must be Success or Fail' }),
  txHash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for Solscan balance structure
 */
const _SolscanBalanceSchema = z.object({
  account: SolanaAddressSchema, // Solana address - case-sensitive
  executable: z.boolean(),
  lamports: z.number().nonnegative('Lamports must be non-negative'),
  ownerProgram: SolanaAddressSchema, // Owner program address - case-sensitive
  rentEpoch: z.number().nonnegative('Rent epoch must be non-negative'),
  type: z.string().min(1, 'Type must not be empty'),
});

/**
 * Schema for Solscan API response wrapper (generic)
 */
export const SolscanResponseSchema = z.object({
  data: z.unknown().nullish(),
  message: z.string().nullish(),
  success: z.boolean(),
});

/**
 * Specific response schemas for Solscan API endpoints
 */
const SolscanAccountBalanceDataSchema = z.object({
  lamports: z.string(),
});

export const SolscanAccountBalanceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: SolscanAccountBalanceDataSchema.nullish(),
});

const SolscanAccountTransactionsDataSchema = z.union([
  z.array(SolscanTransactionSchema),
  z.object({
    data: z.array(SolscanTransactionSchema).nullish(),
    items: z.array(SolscanTransactionSchema).nullish(),
  }),
]);

export const SolscanAccountTransactionsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: SolscanAccountTransactionsDataSchema.nullish(),
});

// Type exports inferred from schemas
export type SolscanTransaction = z.infer<typeof SolscanTransactionSchema>;
export type SolscanResponse<T = unknown> = Omit<z.infer<typeof SolscanResponseSchema>, 'data'> & {
  data?: T | undefined;
};
