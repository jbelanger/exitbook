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
  signature: z.string().min(1, 'Signature must not be empty'),
  slot: z.number().nonnegative('Slot must be non-negative'),
  transaction: z.object({
    message: HeliusTransactionMessageSchema,
    signatures: z.array(z.string().min(1, 'Signature must not be empty')),
  }),
});

/**
 * Schema for Solana raw transaction data (Helius format)
 */
export const SolanaRawTransactionDataSchema = z.object({
  normal: z.array(HeliusTransactionSchema),
});

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
  accountKeys: z.array(z.string().min(1, 'Account key must not be empty')),
  header: SolanaRPCHeaderSchema,
  instructions: z.array(SolanaRPCInstructionSchema),
  recentBlockhash: z.string().min(1, 'Recent blockhash must not be empty'),
});

/**
 * Schema for Solana RPC transaction meta
 */
export const SolanaRPCMetaSchema = z.object({
  err: z.unknown().nullable(),
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
  blockTime: z.number().nonnegative('Block time must be non-negative'),
  meta: SolanaRPCMetaSchema,
  slot: z.number().nonnegative('Slot must be non-negative'),
  transaction: z.object({
    message: SolanaRPCMessageSchema,
    signatures: z.array(z.string().min(1, 'Signature must not be empty')),
  }),
});

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
  blockTime: z.number().nonnegative('Block time must be non-negative'),
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

/**
 * Schema for Solscan API response wrapper
 */
export const SolscanResponseSchema = z.object({
  data: z.unknown().optional(),
  message: z.string().optional(),
  success: z.boolean(),
});

/**
 * Schema for Solana RPC raw transaction data
 */
export const SolanaRPCRawTransactionDataSchema = z.object({
  normal: z.array(SolanaRPCTransactionSchema),
});

/**
 * Schema for Solscan raw transaction data
 */
export const SolscanRawTransactionDataSchema = z.object({
  normal: z.array(SolscanTransactionSchema),
});

/**
 * Validation result type
 */
export interface ValidationResult {
  errors: string[];
  isValid: boolean;
  warnings: string[];
}

/**
 * Validate Solana transaction data using provider-specific schemas
 */
export function validateSolanaTransactions(
  transactions: unknown,
  providerName: 'helius' | 'solana-rpc' | 'solscan'
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Choose the appropriate schema based on provider
  let schema: z.ZodSchema;
  switch (providerName) {
    case 'helius':
      schema = SolanaRawTransactionDataSchema;
      break;
    case 'solana-rpc':
      schema = SolanaRPCTransactionSchema;
      break;
    case 'solscan':
      schema = SolscanTransactionSchema;
      break;
    default:
      errors.push(`Unknown provider: ${providerName}`);
      return { errors, isValid: false, warnings };
  }

  // Validate the data
  const result = schema.safeParse(transactions);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      errors.push(`${issue.message}${path}`);
    }
  }

  return {
    errors,
    isValid: errors.length === 0,
    warnings,
  };
}
