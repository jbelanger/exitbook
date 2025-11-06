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
  args: z.record(z.string(), z.unknown()).optional(),
  deposit: z.string().optional(),
  from: z.string().min(1, 'From must not be empty'),
  method: z.string().optional(),
  to: z.string().min(1, 'To must not be empty'),
});

/**
 * Schema for NearBlocks transaction outcome
 */
export const NearBlocksOutcomeSchema = z.object({
  block_hash: z.string().optional(),
  gas_burnt: z.number().optional(),
  status: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
  tokens_burnt: z.string().optional(),
});

/**
 * Schema for NearBlocks receipt
 */
export const NearBlocksReceiptSchema = z.object({
  predecessor_id: z.string().min(1, 'Predecessor ID must not be empty'),
  receipt_id: z.string().min(1, 'Receipt ID must not be empty'),
  receiver_id: z.string().min(1, 'Receiver ID must not be empty'),
});

/**
 * Schema for NearBlocks transaction data
 * From /v1/account/{account}/txns endpoint
 */
export const NearBlocksTransactionSchema = z.object({
  actions: z.array(NearBlocksActionSchema).optional(),
  actions_agg: z.record(z.string(), z.number()).optional(),
  block_height: z.number().optional(),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  outcomes: z.record(z.string(), NearBlocksOutcomeSchema).optional(),
  outcomes_agg: z.record(z.string(), z.number()).optional(),
  receipt_conversion_gas_burnt: z.string().nullable().optional(),
  receipt_conversion_tokens_burnt: z.string().nullable().optional(),
  receipts: z.array(NearBlocksReceiptSchema).optional(),
  receipts_agg: z.record(z.string(), z.number()).optional(),
  receiver_id: z.string().min(1, 'Receiver ID must not be empty'),
  signer_id: z.string().min(1, 'Signer ID must not be empty'),
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
 * Schema for NearBlocks account balance response
 */
export const NearBlocksAccountSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  amount: z.string().min(1, 'Amount must not be empty'),
  block_height: z.number().optional(),
  block_hash: z.string().optional(),
  code_hash: z.string().optional(),
  locked: z.string().optional(),
  storage_paid_at: z.number().optional(),
  storage_usage: z.number().optional(),
});

// Type exports
export type NearBlocksAction = z.infer<typeof NearBlocksActionSchema>;
export type NearBlocksOutcome = z.infer<typeof NearBlocksOutcomeSchema>;
export type NearBlocksReceipt = z.infer<typeof NearBlocksReceiptSchema>;
export type NearBlocksTransaction = z.infer<typeof NearBlocksTransactionSchema>;
export type NearBlocksTransactionsResponse = z.infer<typeof NearBlocksTransactionsResponseSchema>;
export type NearBlocksAccount = z.infer<typeof NearBlocksAccountSchema>;
