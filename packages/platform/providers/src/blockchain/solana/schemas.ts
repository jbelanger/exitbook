/**
 * Zod validation schemas for Solana transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Solana API providers (Helius, SolanaRPC, Solscan)
 * before processing.
 */
import { z } from 'zod';

/**
 * Solana address schema with validation but NO case transformation.
 *
 * Unlike Bitcoin and EVM addresses which are case-insensitive,
 * Solana addresses are case-sensitive base58-encoded strings.
 * The same address with different casing represents different accounts.
 *
 * Example:
 * - 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK' (valid)
 * - 'dyw8jctfwhnrjhhmfcbxvvdtqwmevfbx6zkumg5cnskk' (different account!)
 *
 * Therefore, we do NOT normalize to lowercase like Bitcoin/EVM addresses.
 * We only validate that the address is a non-empty string.
 */
export const SolanaAddressSchema = z.string().min(1, 'Solana address must not be empty');

/**
 * Schema for Solana token balance (uiTokenAmount)
 */
export const SolanaTokenAmountSchema = z.object({
  amount: z.string().min(1, 'Amount must not be empty'),
  decimals: z.number().min(0, 'Decimals must be non-negative'),
  uiAmount: z
    .number()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
  uiAmountString: z.string().min(1, 'UI amount string must not be empty'),
});

/**
 * Schema for Solana token balance structure
 */
export const SolanaTokenBalanceSchema = z.object({
  accountIndex: z.number().nonnegative('Account index must be non-negative'),
  mint: SolanaAddressSchema, // Token mint address
  owner: SolanaAddressSchema.optional(), // Token account owner
  programId: SolanaAddressSchema.optional(), // Program ID
  uiTokenAmount: SolanaTokenAmountSchema,
});

/**
 * Schema for Solana signature structure
 */
export const SolanaSignatureSchema = z.object({
  blockTime: z.number().optional(),
  err: z
    .unknown()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
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
  mint: SolanaAddressSchema, // Token mint address
  owner: SolanaAddressSchema, // Token account owner
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
    owner: SolanaAddressSchema, // Account owner
    rentEpoch: z.number().nonnegative('Rent epoch must be non-negative'),
  }),
  pubkey: SolanaAddressSchema, // Account public key
});

/**
 * Numeric string validator for amounts/values
 */
const numericString = z
  .string()
  .refine((val) => !isNaN(parseFloat(val)) && isFinite(parseFloat(val)), { message: 'Must be a valid numeric string' });

/**
 * Schema for Solana account change
 */
export const SolanaAccountChangeSchema = z.object({
  account: SolanaAddressSchema, // Account address
  owner: SolanaAddressSchema.optional(), // Account owner
  postBalance: numericString,
  preBalance: numericString,
});

/**
 * Schema for Solana token change
 */
export const SolanaTokenChangeSchema = z.object({
  account: SolanaAddressSchema, // Token account address
  decimals: z.number().nonnegative(),
  mint: SolanaAddressSchema, // Token mint address
  owner: SolanaAddressSchema.optional(), // Token account owner
  postAmount: numericString,
  preAmount: numericString,
  symbol: z.string().optional(),
});

/**
 * Schema for Solana instruction
 */
export const SolanaInstructionSchema = z.object({
  accounts: z.array(SolanaAddressSchema).optional(), // Account addresses involved in instruction
  data: z.string().optional(),
  instructionType: z.string().optional(),
  programId: SolanaAddressSchema.optional(), // Program address
  programName: z.string().optional(),
});

/**
 * Schema for normalized Solana transaction
 */
export const SolanaTransactionSchema = z.object({
  accountChanges: z.array(SolanaAccountChangeSchema).optional(),
  amount: numericString,
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  computeUnitsConsumed: z.number().nonnegative().optional(),
  currency: z.string().min(1, 'Currency must not be empty'),
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),
  from: SolanaAddressSchema, // From address - case-sensitive
  id: z.string().min(1, 'Transaction ID must not be empty'),
  innerInstructions: z.array(SolanaInstructionSchema).optional(),
  instructions: z.array(SolanaInstructionSchema).optional(),
  logMessages: z.array(z.string()).optional(),
  providerId: z.string().min(1, 'Provider ID must not be empty'),
  signature: z.string().optional(),
  slot: z.number().nonnegative().optional(),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  to: SolanaAddressSchema, // To address - case-sensitive
  tokenAccount: SolanaAddressSchema.optional(), // Token account address
  tokenAddress: SolanaAddressSchema.optional(), // Token mint address
  tokenChanges: z.array(SolanaTokenChangeSchema).optional(),
  tokenDecimals: z.number().nonnegative().optional(),
  tokenSymbol: z.string().optional(),
});

// Type exports inferred from schemas (single source of truth)
export type SolanaTokenAmount = z.infer<typeof SolanaTokenAmountSchema>;
export type SolanaTokenBalance = z.infer<typeof SolanaTokenBalanceSchema>;
export type SolanaSignature = z.infer<typeof SolanaSignatureSchema>;
export type SolanaAccountBalance = z.infer<typeof SolanaAccountBalanceSchema>;
export type SolanaTokenAccountInfo = z.infer<typeof SolanaTokenAccountInfoSchema>;
export type SolanaTokenAccountData = z.infer<typeof SolanaTokenAccountDataSchema>;
export type SolanaTokenAccount = z.infer<typeof SolanaTokenAccountSchema>;
export type SolanaAccountChange = z.infer<typeof SolanaAccountChangeSchema>;
export type SolanaTokenChange = z.infer<typeof SolanaTokenChangeSchema>;
export type SolanaInstruction = z.infer<typeof SolanaInstructionSchema>;
export type SolanaTransaction = z.infer<typeof SolanaTransactionSchema>;
