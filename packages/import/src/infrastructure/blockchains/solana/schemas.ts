/**
 * Zod validation schemas for Solana transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Solana API providers (Helius, SolanaRPC, Solscan)
 * before processing.
 */
import { z } from 'zod';

/**
 * Schema for Solana token balance (uiTokenAmount)
 */
export const SolanaTokenAmountSchema = z.object({
  amount: z.string().min(1, 'Amount must not be empty'),
  decimals: z.number().min(0, 'Decimals must be non-negative'),
  uiAmount: z.number().nullable().optional(),
  uiAmountString: z.string().min(1, 'UI amount string must not be empty'),
});

/**
 * Schema for Solana token balance structure
 */
export const SolanaTokenBalanceSchema = z.object({
  accountIndex: z.number().nonnegative('Account index must be non-negative'),
  mint: z.string().min(1, 'Mint must not be empty'),
  owner: z.string().optional(),
  programId: z.string().optional(),
  uiTokenAmount: SolanaTokenAmountSchema,
});

/**
 * Schema for Solana signature structure
 */
export const SolanaSignatureSchema = z.object({
  blockTime: z.number().optional(),
  err: z.unknown().nullable(),
  memo: z.string().optional(),
  signature: z.string().min(1, 'Signature must not be empty'),
  slot: z.number().nonnegative('Slot must be non-negative'),
});

/**
 * Schema for Solana account balance
 */
export const SolanaAccountBalanceSchema = z.object({
  value: z.number().nonnegative('Value must be non-negative'),
});

/**
 * Schema for Solana token account info
 */
export const SolanaTokenAccountInfoSchema = z.object({
  mint: z.string().min(1, 'Mint must not be empty'),
  owner: z.string().min(1, 'Owner must not be empty'),
  tokenAmount: SolanaTokenAmountSchema,
});

/**
 * Schema for Solana token account data
 */
export const SolanaTokenAccountDataSchema = z.object({
  parsed: z.object({
    info: SolanaTokenAccountInfoSchema,
    type: z.string().min(1, 'Type must not be empty'),
  }),
  program: z.string().min(1, 'Program must not be empty'),
  space: z.number().nonnegative('Space must be non-negative'),
});

/**
 * Schema for Solana token account structure
 */
export const SolanaTokenAccountSchema = z.object({
  account: z.object({
    data: SolanaTokenAccountDataSchema,
    executable: z.boolean(),
    lamports: z.number().nonnegative('Lamports must be non-negative'),
    owner: z.string().min(1, 'Owner must not be empty'),
    rentEpoch: z.number().nonnegative('Rent epoch must be non-negative'),
  }),
  pubkey: z.string().min(1, 'Pubkey must not be empty'),
});
