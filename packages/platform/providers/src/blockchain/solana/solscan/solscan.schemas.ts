import { z } from 'zod';

import { timestampToDate } from '../../../shared/blockchain/utils/zod-utils.js';

/**
 * Schema for Solscan input account structure
 */
export const SolscanInputAccountSchema = z.object({
  account: z.string().min(1, 'Account must not be empty'),
  postBalance: z.number().nonnegative('Post balance must be non-negative'),
  preBalance: z.number().nonnegative('Pre balance must be non-negative'),
  signer: z.boolean(),
  writable: z.boolean(),
});

/**
 * Schema for Solscan parsed instruction structure
 */
export const SolscanParsedInstructionSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  program: z.string().min(1, 'Program must not be empty'),
  programId: z.string().min(1, 'Program ID must not be empty'),
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
  signer: z.array(z.string().min(1, 'Signer must not be empty')),
  slot: z.number().nonnegative('Slot must be non-negative'),
  status: z.enum(['Success', 'Fail'], { message: 'Status must be Success or Fail' }),
  txHash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for Solscan balance structure
 */
export const SolscanBalanceSchema = z.object({
  account: z.string().min(1, 'Account must not be empty'),
  executable: z.boolean(),
  lamports: z.number().nonnegative('Lamports must be non-negative'),
  ownerProgram: z.string().min(1, 'Owner program must not be empty'),
  rentEpoch: z.number().nonnegative('Rent epoch must be non-negative'),
  type: z.string().min(1, 'Type must not be empty'),
});

/**
 * Schema for Solscan raw transaction data (single transaction)
 */
export const SolscanRawTransactionDataSchema = SolscanTransactionSchema;

/**
 * Schema for Solscan API response wrapper
 */
export const SolscanResponseSchema = z.object({
  data: z.unknown().optional(),
  message: z.string().optional(),
  success: z.boolean(),
});

// Type exports inferred from schemas
export type SolscanInputAccount = z.infer<typeof SolscanInputAccountSchema>;
export type SolscanParsedInstruction = z.infer<typeof SolscanParsedInstructionSchema>;
export type SolscanTransaction = z.infer<typeof SolscanTransactionSchema>;
export type SolscanBalance = z.infer<typeof SolscanBalanceSchema>;
export type SolscanResponse<T = unknown> = Omit<z.infer<typeof SolscanResponseSchema>, 'data'> & {
  data?: T | undefined;
};
