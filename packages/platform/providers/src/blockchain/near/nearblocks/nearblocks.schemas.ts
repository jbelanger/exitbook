/**
 * Zod schemas for NearBlocks API responses
 * API: https://api.nearblocks.io
 */
import { z } from 'zod';

/**
 * Schema for NearBlocks action
 */
export const NearBlocksActionSchema = z.object({
  action: z.string().min(1, 'Action must not be empty'),
  args: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).optional(),
  deposit: z.number().optional(),
  fee: z.number().optional(),
  method: z.string().nullable().optional(),
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
 */
export const NearBlocksReceiptOutcomeSchema = z.object({
  executor_account_id: z.string(),
  gas_burnt: z.number(),
  status: z.boolean(),
  tokens_burnt: z.number(),
});

/**
 * Schema for NearBlocks transaction outcome
 */
export const NearBlocksOutcomeSchema = z.object({
  status: z.boolean(),
});

/**
 * Schema for NearBlocks transaction data
 * From /v1/account/{account}/txns endpoint
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
  predecessor_account_id: z.string().min(1, 'Predecessor account ID must not be empty'),
  receipt_block: NearBlocksReceiptBlockSchema.optional(),
  receipt_conversion_tokens_burnt: z.string().nullable().optional(),
  receipt_id: z.string().optional(),
  receipt_kind: z.string().optional(),
  receipt_outcome: NearBlocksReceiptOutcomeSchema.optional(),
  receiver_account_id: z.string().min(1, 'Receiver account ID must not be empty'),
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
  amount: z.string().min(1, 'Amount must not be empty'),
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
      transaction_hash: z.string().nullable(),
      block_timestamp: z.number().nullable(),
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
