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
  args: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).nullish(),
  deposit: DecimalStringSchema.nullish(),
  fee: DecimalStringSchema.nullish(),
  method: z.string().nullish(),
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
  actions: z.array(NearBlocksActionSchema).nullish(),
  actions_agg: z.record(z.string(), z.number()).nullish(),
  block: NearBlocksBlockSchema.nullish(),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  id: z.string().nullish(),
  included_in_block_hash: z.string().nullish(),
  outcomes: NearBlocksOutcomeSchema.nullish(),
  outcomes_agg: z.record(z.string(), z.number()).nullish(),
  receipt_block: NearBlocksReceiptBlockSchema.nullish(),
  receipt_conversion_tokens_burnt: z.string().nullish(),
  receipt_id: z.string().nullish(),
  receipt_kind: z.string().nullish(),
  receipt_outcome: NearBlocksReceiptOutcomeSchema.nullish(),
  receiver_account_id: z.string().min(1, 'Receiver account ID must not be empty'),
  signer_account_id: z.string().min(1, 'Signer account ID must not be empty'),
  transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for NearBlocks paginated transaction response
 */
export const NearBlocksTransactionsResponseSchema = z.object({
  cursor: z.string().nullish(),
  txns: z.array(NearBlocksTransactionSchema),
});

/**
 * Schema for NearBlocks account data
 */
export const NearBlocksAccountDataSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  amount: DecimalStringSchema,
  block_height: z.union([z.number(), z.string()]).nullish(),
  block_hash: z.string().nullish(),
  code_hash: z.string().nullish(),
  locked: z.string().nullish(),
  storage_paid_at: z.number().nullish(),
  storage_usage: z.number().nullish(),
  created: z
    .object({
      transaction_hash: z.string(),
      block_timestamp: z.number(),
    })
    .nullish(),
  deleted: z
    .object({
      transaction_hash: z.string().nullish(),
      block_timestamp: z.number().nullish(),
    })
    .nullish(),
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
  delta_nonstaked_amount: z.string().nullish(),
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
  cursor: z.string().nullish(),
  activities: z.array(NearBlocksActivitySchema),
});

/**
 * Schema for NearBlocks receipt item
 * From /v1/account/{account}/receipts endpoint
 */
export const NearBlocksReceiptSchema = z.object({
  block_timestamp: z.string().nullish(),
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
  cursor: z.string().nullish(),
  txns: z.array(NearBlocksReceiptSchema),
});

/**
 * Schema for NearBlocks FT (fungible token) transaction item
 * From /v1/account/{account}/ft-txns endpoint
 *
 * Note: ft object is REQUIRED - a fungible token transaction without token metadata is invalid
 */
export const NearBlocksFtTransactionSchema = z.object({
  affected_account_id: z.string().min(1, 'Affected account ID must not be empty'),
  block_height: z.number().nullish(),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  cause: z.string().nullish(),
  delta_amount: z.string().nullish(),
  ft: z.object({
    contract: z.string().min(1, 'Contract must not be empty'),
    decimals: z.number().nonnegative(),
    name: z.string().nullish(),
    symbol: z.string().nullish(),
  }),
  involved_account_id: z.string().nullish(),
  receipt_id: z.string().min(1, 'Receipt ID must not be empty'),
  transaction_hash: z.string().nullish(),
});

/**
 * Schema for NearBlocks paginated FT transactions response
 */
export const NearBlocksFtTransactionsResponseSchema = z.object({
  cursor: z.string().nullish(),
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

// ============================================================================
// V2 Schemas - Receipt-level data with full enrichment
// ============================================================================

/**
 * V2: Enriched receipt action schema with full details
 * Extends the basic action schema with all action-specific fields
 */
export const NearBlocksActionV2Schema = z.object({
  action: z.string().min(1, 'Action must not be empty'),
  args: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).nullish(),
  deposit: DecimalStringSchema.nullish(),
  method: z.string().nullish(),
  gas: DecimalStringSchema.nullish(),
  public_key: z.string().nullish(),
  beneficiary_id: z.string().nullish(),
  access_key: z.unknown().nullish(),
});

/**
 * V2: Enriched receipt outcome schema
 */
export const NearBlocksReceiptOutcomeV2Schema = z.object({
  executor_account_id: z.string().min(1, 'Executor account ID must not be empty'),
  gas_burnt: DecimalStringSchema,
  status: z.boolean(),
  tokens_burnt: DecimalStringSchema,
  logs: z.array(z.string()).nullish(),
});

/**
 * V2: Enriched receipt schema with actions and outcomes
 * This is used for the /v1/account/{account}/receipts endpoint when fetching full details
 *
 * API returns nested objects:
 * - receipt_block: { block_hash, block_height, block_timestamp } - REQUIRED for event ordering
 * - receipt_outcome: { executor_account_id, gas_burnt, status, tokens_burnt, logs }
 */
export const NearBlocksReceiptV2Schema = z.object({
  receipt_id: z.string().min(1, 'Receipt ID must not be empty'),
  transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
  predecessor_account_id: z.string().min(1, 'Predecessor account ID must not be empty'),
  receiver_account_id: z.string().min(1, 'Receiver account ID must not be empty'),
  receipt_kind: z.string().nullish(),
  receipt_block: NearBlocksReceiptBlockSchema, // Required for event ordering and timestamp
  receipt_outcome: NearBlocksReceiptOutcomeV2Schema.nullish(),
  actions: z.array(NearBlocksActionV2Schema).nullish(),
});

/**
 * V2: Transaction schema with receipts array
 * Extends the basic transaction with enriched receipt data
 */
export const NearBlocksTransactionV2Schema = NearBlocksTransactionSchema.extend({
  receipts: z.array(NearBlocksReceiptV2Schema).nullish(),
});

/**
 * V2: Paginated receipts response with enriched data
 * Note: API returns 'txns' array, not 'receipts'
 */
export const NearBlocksReceiptsV2ResponseSchema = z.object({
  cursor: z.string().nullish(),
  txns: z.array(NearBlocksReceiptV2Schema),
});

// V2 Type exports
export type NearBlocksActionV2 = z.infer<typeof NearBlocksActionV2Schema>;
export type NearBlocksReceiptOutcomeV2 = z.infer<typeof NearBlocksReceiptOutcomeV2Schema>;
export type NearBlocksReceiptV2 = z.infer<typeof NearBlocksReceiptV2Schema>;
export type NearBlocksTransactionV2 = z.infer<typeof NearBlocksTransactionV2Schema>;
export type NearBlocksReceiptsV2Response = z.infer<typeof NearBlocksReceiptsV2ResponseSchema>;
