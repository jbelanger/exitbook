/**
 * Zod validation schemas for Injective transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Injective API providers (Injective Explorer, Injective LCD)
 * before processing.
 */
import { z } from 'zod';

/**
 * Schema for Injective amount (denom and amount pair)
 */
export const InjectiveAmountSchema = z.object({
  amount: z.string().min(1, 'Amount must not be empty'),
  denom: z.string().min(1, 'Denom must not be empty'),
});

/**
 * Schema for Injective gas fee structure
 */
export const InjectiveGasFeeSchema = z.object({
  amount: z.array(InjectiveAmountSchema).min(1, 'Gas fee must have at least one amount'),
  gas_limit: z.number().nonnegative('Gas limit must be non-negative'),
  granter: z.string(),
  payer: z.string(),
});

/**
 * Schema for Injective message value (flexible structure for different message types)
 */
export const InjectiveMessageValueSchema = z.object({
  // Common fields across message types
  amount: z.union([z.array(InjectiveAmountSchema), z.string()]).optional(),
  ethereum_receiver: z.string().optional(),
  from_address: z.string().optional(),
  injective_receiver: z.string().optional(),
  memo: z.string().optional(),
  receiver: z.string().optional(),
  sender: z.string().optional(),
  source_channel: z.string().optional(),
  source_port: z.string().optional(),
  timeout_height: z.any().optional(), // Can be various types
  timeout_timestamp: z.string().optional(),
  to_address: z.string().optional(),
  token: InjectiveAmountSchema.optional(),
  token_contract: z.string().optional(),
});

/**
 * Schema for Injective message structure
 */
export const InjectiveMessageSchema = z.object({
  type: z.string().min(1, 'Message type must not be empty'),
  value: InjectiveMessageValueSchema,
});

/**
 * Schema for Injective transaction log events
 */
export const InjectiveEventAttributeSchema = z.object({
  index: z.boolean().optional(),
  key: z.string().optional(),
  msg_index: z.string().optional(),
  value: z.string().optional(),
});

export const InjectiveEventSchema = z.object({
  attributes: z.array(InjectiveEventAttributeSchema).optional(),
  type: z.string().optional(),
});

export const InjectiveTransactionLogSchema = z.object({
  events: z.array(InjectiveEventSchema).optional(),
  msg_index: z.string().optional(),
});

/**
 * Schema for validating Injective transaction format
 */
export const InjectiveTransactionSchema = z.object({
  block_number: z.number().nonnegative('Block number must be non-negative'),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  block_unix_timestamp: z.number().optional(),
  claim_id: z.array(z.number()).optional(),
  code: z.number().nonnegative('Transaction code must be non-negative'),
  codespace: z.string().optional(),
  data: z.string().optional(),
  error_log: z.string().optional(),
  extension_options: z.array(z.unknown()).optional(),
  gas_fee: InjectiveGasFeeSchema,
  gas_used: z.number().nonnegative('Gas used must be non-negative'),
  gas_wanted: z.number().nonnegative('Gas wanted must be non-negative'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  id: z.string().optional(), // Can be empty, use hash instead
  info: z.string().optional(),
  logs: z.array(InjectiveTransactionLogSchema).optional(),
  memo: z.string().optional(),
  messages: z.array(InjectiveMessageSchema).min(1, 'Transaction must have at least one message'),
  non_critical_extension_options: z.array(z.unknown()).optional(),
  signatures: z.array(z.unknown()).optional(),
  timeout_height: z.number().nonnegative('Timeout height must be non-negative').optional(),
  tx_number: z.number().optional(),
  tx_type: z.string().min(1, 'Transaction type must not be empty'),
});

/**
 * Schema for Injective balance structure
 */
export const InjectiveBalanceSchema = z.object({
  amount: z.string().min(1, 'Balance amount must not be empty'),
  denom: z.string().min(1, 'Balance denom must not be empty'),
});

/**
 * Schema for Injective balance response
 */
export const InjectiveBalanceResponseSchema = z.object({
  balances: z.array(InjectiveBalanceSchema),
  pagination: z.object({
    next_key: z.string().optional(),
    total: z.string().min(1, 'Pagination total must not be empty'),
  }),
});

/**
 * Schema for Injective API response wrapper
 */
export const InjectiveApiResponseSchema = z.object({
  data: z.array(InjectiveTransactionSchema),
  paging: z
    .object({
      from: z.number().optional(),
      to: z.number().optional(),
      total: z.number().nonnegative('Total must be non-negative'),
    })
    .optional(),
});
