import { DecimalStringSchema } from '@exitbook/core';
/**
 * Zod schemas for NearBlocks API responses
 * API: https://api.nearblocks.io
 */
import { z } from 'zod';

/**
 * Schema for NearBlocks action
 * NOTE: deposit and fee are returned as unquoted numbers (including scientific notation like 1e+23)
 * and are converted to fixed-point decimal strings via DecimalStringSchema for precision-safe storage
 */
export const NearBlocksActionSchema = z.object({
  action: z.string().min(1, 'Action must not be empty'),
  args: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).optional(),
  deposit: DecimalStringSchema.optional(),
  fee: DecimalStringSchema.optional(),
  method: z.string().nullish().optional(),
});

/**
 * Schema for NearBlocks block info
 */
export const NearBlocksBlockSchema = z.object({
  block_height: z.number(),
});

/**
 * Schema for NearBlocks receipt block info
 */
export const NearBlocksReceiptBlockSchema = z.object({
  block_hash: z.string(),
  block_height: z.number(),
  block_timestamp: z.number(),
});

/**
 * Schema for NearBlocks receipt outcome
 * NOTE: gas_burnt and tokens_burnt are returned as unquoted numbers (including scientific notation)
 * and are converted to fixed-point decimal strings via DecimalStringSchema for precision-safe storage
 */
export const NearBlocksReceiptOutcomeSchema = z.object({
  executor_account_id: z.string(),
  gas_burnt: DecimalStringSchema,
  status: z.boolean(),
  tokens_burnt: DecimalStringSchema,
});

/**
 * Schema for NearBlocks transaction outcome
 */
export const NearBlocksOutcomeSchema = z.object({
  status: z.boolean(),
});

/**
 * Schema for NearBlocks transaction data
 * From /v1/account/{account}/txns-only endpoint
 */
export const NearBlocksTransactionSchema = z.object({
  actions: z.array(NearBlocksActionSchema).optional(),
  actions_agg: z.record(z.string(), z.number()).optional(),
  block: NearBlocksBlockSchema.optional(),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  id: z.string().optional(),
  included_in_block_hash: z.string().optional(),
  outcomes: NearBlocksOutcomeSchema.optional(),
  outcomes_agg: z.record(z.string(), z.number()).optional(),
  receipt_block: NearBlocksReceiptBlockSchema.optional(),
  receipt_conversion_tokens_burnt: z.string().nullish().optional(),
  receipt_id: z.string().optional(),
  receipt_kind: z.string().optional(),
  receipt_outcome: NearBlocksReceiptOutcomeSchema.optional(),
  receiver_account_id: z.string().min(1, 'Receiver account ID must not be empty'),
  signer_account_id: z.string().min(1, 'Signer account ID must not be empty'),
  transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for NearBlocks paginated transaction response
 */
export const NearBlocksTransactionsResponseSchema = z.object({
  cursor: z.string().optional(),
  txns: z.array(NearBlocksTransactionSchema),
});

/**
 * Schema for NearBlocks account data
 */
export const NearBlocksAccountDataSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  amount: DecimalStringSchema,
  block_height: z.union([z.number(), z.string()]).optional(),
  block_hash: z.string().optional(),
  code_hash: z.string().optional(),
  locked: z.string().optional(),
  storage_paid_at: z.number().optional(),
  storage_usage: z.number().optional(),
  created: z
    .object({
      transaction_hash: z.string(),
      block_timestamp: z.number(),
    })
    .optional(),
  deleted: z
    .object({
      transaction_hash: z.string().nullish(),
      block_timestamp: z.number().nullish(),
    })
    .optional(),
});

/**
 * Schema for NearBlocks account balance response
 * The API returns account data wrapped in an "account" array
 */
export const NearBlocksAccountSchema = z.object({
  account: z.array(NearBlocksAccountDataSchema).min(1, 'Account array must not be empty'),
});

/**
 * Schema for NearBlocks activity direction enum
 */
export const NearBlocksActivityDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);

/**
 * Schema for NearBlocks activity item
 * From /v1/account/{account}/activities endpoint
 */
export const NearBlocksActivitySchema = z.object({
  absolute_nonstaked_amount: z.string().min(1, 'Absolute non-staked amount must not be empty'),
  absolute_staked_amount: z.string().min(1, 'Absolute staked amount must not be empty'),
  affected_account_id: z.string().min(1, 'Affected account ID must not be empty'),
  block_height: z.string().min(1, 'Block height must not be empty'),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  cause: z.string().min(1, 'Cause must not be empty'),
  delta_nonstaked_amount: z.string().optional(),
  direction: NearBlocksActivityDirectionSchema,
  event_index: z.string().min(1, 'Event index must not be empty'),
  involved_account_id: z.string().nullish(),
  receipt_id: z.string().nullish(),
  transaction_hash: z.string().nullish(),
});

/**
 * Schema for NearBlocks paginated activity response
 */
export const NearBlocksActivitiesResponseSchema = z.object({
  cursor: z.string().optional(),
  activities: z.array(NearBlocksActivitySchema),
});

/**
 * Schema for NearBlocks receipt item
 * From /v1/account/{account}/receipts endpoint
 */
export const NearBlocksReceiptSchema = z.object({
  block_timestamp: z.string().optional(),
  transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
  predecessor_account_id: z.string().min(1, 'Predecessor account ID must not be empty'),
  receipt_id: z.string().min(1, 'Receipt ID must not be empty'),
  receiver_account_id: z.string().min(1, 'Receiver account ID must not be empty'),
});

/**
 * Schema for NearBlocks paginated receipts response
 * API returns receipts in 'txns' array
 */
export const NearBlocksReceiptsResponseSchema = z.object({
  cursor: z.string().optional(),
  txns: z.array(NearBlocksReceiptSchema),
});

/**
 * Schema for NearBlocks FT (fungible token) transaction item
 * From /v1/account/{account}/ft-txns endpoint
 */
export const NearBlocksFtTransactionSchema = z.object({
  affected_account_id: z.string().min(1, 'Affected account ID must not be empty'),
  block_height: z.number().optional(),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  cause: z.string().optional(),
  delta_amount: z.string().optional(),
  ft: z
    .object({
      contract: z.string().min(1, 'Contract must not be empty'),
      decimals: z.number().nonnegative(),
      name: z.string().optional(),
      symbol: z.string().optional(),
    })
    .optional(),
  involved_account_id: z.string().optional(),
  receipt_id: z.string().min(1, 'Receipt ID must not be empty'),
  transaction_hash: z.string().optional(),
});

/**
 * Schema for NearBlocks paginated FT transactions response
 */
export const NearBlocksFtTransactionsResponseSchema = z.object({
  cursor: z.string().optional(),
  txns: z.array(NearBlocksFtTransactionSchema),
});

// Type exports
export type NearBlocksAction = z.infer<typeof NearBlocksActionSchema>;
export type NearBlocksBlock = z.infer<typeof NearBlocksBlockSchema>;
export type NearBlocksReceiptBlock = z.infer<typeof NearBlocksReceiptBlockSchema>;
export type NearBlocksReceiptOutcome = z.infer<typeof NearBlocksReceiptOutcomeSchema>;
export type NearBlocksOutcome = z.infer<typeof NearBlocksOutcomeSchema>;
export type NearBlocksTransaction = z.infer<typeof NearBlocksTransactionSchema>;
export type NearBlocksTransactionsResponse = z.infer<typeof NearBlocksTransactionsResponseSchema>;
export type NearBlocksAccountData = z.infer<typeof NearBlocksAccountDataSchema>;
export type NearBlocksAccount = z.infer<typeof NearBlocksAccountSchema>;
export type NearBlocksActivityDirection = z.infer<typeof NearBlocksActivityDirectionSchema>;
export type NearBlocksActivity = z.infer<typeof NearBlocksActivitySchema>;
export type NearBlocksActivitiesResponse = z.infer<typeof NearBlocksActivitiesResponseSchema>;
export type NearBlocksReceipt = z.infer<typeof NearBlocksReceiptSchema>;
export type NearBlocksReceiptsResponse = z.infer<typeof NearBlocksReceiptsResponseSchema>;
export type NearBlocksFtTransaction = z.infer<typeof NearBlocksFtTransactionSchema>;
export type NearBlocksFtTransactionsResponse = z.infer<typeof NearBlocksFtTransactionsResponseSchema>;
