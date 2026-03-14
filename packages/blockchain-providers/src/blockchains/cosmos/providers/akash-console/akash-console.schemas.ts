/**
 * Zod validation schemas for Akash Console API data formats
 *
 * These schemas validate the structure and content of transaction data
 * from the Akash Console API (console-api.akash.network) before processing.
 */
import { z } from 'zod';

import { CosmosAddressSchema } from '../../schemas.js';

/**
 * Schema for Akash asset in balance response
 */
const AkashAssetSchema = z.object({
  symbol: z.string(),
  logoUrl: z.string().optional(),
  amount: z.number(), // Already in AKT decimal format (not uakt)
});

/**
 * Schema for Akash delegation object
 */
const AkashDelegationSchema = z.object({
  validator: CosmosAddressSchema.optional(),
  amount: z.number().optional(),
  reward: z.number().optional(),
});

/**
 * Schema for Akash balance response
 */
export const AkashBalanceResponseSchema = z.object({
  total: z.number(), // Total balance in uakt
  available: z.number(), // Available balance in uakt
  delegated: z.number(), // Delegated amount in uakt
  rewards: z.number(), // Staking rewards in uakt
  commission: z.number(), // Validator commission in uakt
  assets: z.array(AkashAssetSchema),
  delegations: z.array(AkashDelegationSchema).optional(),
  redelegations: z.array(z.unknown()).optional(),
  latestTransactions: z.array(z.unknown()).optional(),
});

/**
 * Schema for Akash transaction message (lightweight, from transaction list)
 */
const AkashTransactionMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  amount: z.number(), // Amount in uakt (0 for MsgMultiSend)
  isReceiver: z.boolean().optional(),
});

/**
 * Schema for Akash transaction (from transaction list endpoint)
 */
const AkashTransactionSchema = z.object({
  height: z.number(),
  datetime: z.string(),
  hash: z.string(),
  isSuccess: z.boolean(),
  error: z.string().nullish(),
  gasUsed: z.number(),
  gasWanted: z.number(),
  fee: z.number(), // Fee in uakt
  memo: z.string(),
  isSigner: z.boolean().optional(),
  messages: z.array(AkashTransactionMessageSchema),
});

/**
 * Schema for Akash transaction list response
 */
export const AkashTransactionListResponseSchema = z.object({
  count: z.number(),
  results: z.array(AkashTransactionSchema),
});

/**
 * Schema for Akash coin amount (in transaction detail)
 */
const AkashCoinAmountSchema = z.object({
  denom: z.string().min(1, 'Denom must not be empty'),
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'), // Numeric string in base units (e.g., "284870994" uakt)
});

/**
 * Schema for message data in transaction details
 */
const AkashMessageDataSchema = z.object({
  from_address: CosmosAddressSchema.optional(),
  to_address: CosmosAddressSchema.optional(),
  amount: z.array(AkashCoinAmountSchema).optional(),
  // MsgMultiSend fields
  inputs: z
    .array(
      z.object({
        address: CosmosAddressSchema,
        coins: z.array(AkashCoinAmountSchema),
      })
    )
    .optional(),
  outputs: z
    .array(
      z.object({
        address: CosmosAddressSchema,
        coins: z.array(AkashCoinAmountSchema),
      })
    )
    .optional(),
  // IBC transfer fields
  receiver: CosmosAddressSchema.optional(),
  sender: CosmosAddressSchema.optional(),
  source_channel: z.string().optional(),
  source_port: z.string().optional(),
  timeout_height: z.any().optional(),
  timeout_timestamp: z.string().optional(),
  token: AkashCoinAmountSchema.optional(),
  memo: z.string().optional(),
  // Staking fields
  delegator_address: CosmosAddressSchema.optional(),
  validator_address: CosmosAddressSchema.optional(),
  validator_src_address: CosmosAddressSchema.optional(),
  validator_dst_address: CosmosAddressSchema.optional(),
  // Allow other fields for message types we don't yet handle
});

/**
 * Schema for Akash transaction detail message
 */
const AkashTransactionDetailMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: AkashMessageDataSchema,
  relatedDeploymentId: z.string().nullish(),
});

/**
 * Schema for Akash transaction detail response
 */
export const AkashTransactionDetailSchema = z.object({
  height: z.number(),
  datetime: z.string(),
  hash: z.string(),
  isSuccess: z.boolean(),
  multisigThreshold: z.number().nullish(),
  signers: z.array(CosmosAddressSchema),
  error: z.string().nullish(),
  gasUsed: z.number(),
  gasWanted: z.number(),
  fee: z.number(), // Fee in uakt
  memo: z.string(),
  messages: z.array(AkashTransactionDetailMessageSchema),
});

// Type exports inferred from schemas
export type AkashBalanceResponse = z.infer<typeof AkashBalanceResponseSchema>;
export type AkashTransactionListResponse = z.infer<typeof AkashTransactionListResponseSchema>;
export type AkashTransactionDetail = z.infer<typeof AkashTransactionDetailSchema>;
