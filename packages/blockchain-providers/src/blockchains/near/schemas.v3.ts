/**
 * V3 Zod schemas for NEAR normalized stream types
 *
 * These schemas define 4 normalized (provider-agnostic) stream types:
 * 1. transactions - Base transaction metadata from /txns-only
 * 2. receipts - Receipt execution records from /receipts
 * 3. balance-changes - Balance changes from /activities
 * 4. token-transfers - Token transfers from /ft-txns
 *
 * V3 Architecture:
 * - Provider: Fetches raw data and maps to normalized types using mapper-utils.v3
 * - Importer: Saves all 4 normalized types using transaction_type_hint
 * - Processor: Correlates by receipt_id and aggregates to one transaction per parent hash
 */

import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../core/schemas/normalized-transaction.js';

/**
 * Stream type discriminator for the 4 normalized data types
 */
export const NearStreamTypeSchema = z.enum(['transactions', 'receipts', 'balance-changes', 'token-transfers']);

export type NearStreamType = z.infer<typeof NearStreamTypeSchema>;

/**
 * Normalized NEAR action types (snake_case)
 * Normalized from provider's SCREAMING_SNAKE_CASE format
 *
 * Known NEAR protocol action types:
 * - transfer: NEAR token transfer between accounts
 * - function_call: Smart contract method invocation
 * - create_account: New account creation
 * - delete_account: Account deletion
 * - add_key: Add access key to account
 * - delete_key: Remove access key from account
 * - stake: Staking operations (stake/unstake)
 * - deploy_contract: Smart contract deployment
 * - delegate_action: Delegated action (meta-transaction)
 *
 * If a new action type appears, normalization will fail and must be added to this enum.
 */
export const NearActionTypeSchema = z.enum([
  'transfer',
  'function_call',
  'create_account',
  'delete_account',
  'add_key',
  'delete_key',
  'stake',
  'deploy_contract',
  'delegate_action',
]);

export type NearActionType = z.infer<typeof NearActionTypeSchema>;

/**
 * NEAR receipt action with normalized fields
 */
export const NearReceiptActionSchema = z.object({
  actionType: NearActionTypeSchema,
  methodName: z.string().optional(),
  args: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).optional(),
  deposit: DecimalStringSchema.optional(),
  gas: DecimalStringSchema.optional(),
  publicKey: z.string().optional(),
  beneficiaryId: z.string().optional(),
  accessKey: z.unknown().optional(),
});

export type NearReceiptAction = z.infer<typeof NearReceiptActionSchema>;

/**
 * V3: Normalized transaction from /txns-only endpoint
 * Contains base transaction metadata (parent transaction level)
 */
export const NearTransactionSchema = NormalizedTransactionBaseSchema.extend({
  streamType: z.literal('transactions'),
  transactionHash: z.string().min(1, 'Transaction hash must not be empty'),
  signerAccountId: z.string().min(1, 'Signer account ID must not be empty'),
  receiverAccountId: z.string().min(1, 'Receiver account ID must not be empty'),
  blockTimestamp: z.number().positive('Block timestamp must be positive'),
  blockHeight: z.number().positive('Block height must be positive').optional(),
  blockHash: z.string().optional(),
  status: z.boolean().optional(),
});

export type NearTransaction = z.infer<typeof NearTransactionSchema>;

/**
 * V3: Normalized receipt from /receipts endpoint
 * Contains receipt execution records
 */
export const NearReceiptSchema = NormalizedTransactionBaseSchema.extend({
  streamType: z.literal('receipts'),
  receiptId: z.string().min(1, 'Receipt ID must not be empty'),
  transactionHash: z.string().min(1, 'Transaction hash must not be empty'),
  predecessorAccountId: z.string().min(1, 'Predecessor account ID must not be empty'),
  receiverAccountId: z.string().min(1, 'Receiver account ID must not be empty'),
  receiptKind: z.string().optional(),
  blockHash: z.string().optional(),
  blockHeight: z.number().positive('Block height must be positive').optional(),
  blockTimestamp: z.number().positive('Block timestamp must be positive'),
  executorAccountId: z.string().optional(),
  gasBurnt: DecimalStringSchema.optional(),
  tokensBurntYocto: DecimalStringSchema.optional(),
  status: z.boolean().optional(),
  logs: z.array(z.string()).optional(),
  actions: z.array(NearReceiptActionSchema).optional(),
});

export type NearReceipt = z.infer<typeof NearReceiptSchema>;

/**
 * Normalized cause values for balance changes
 * These values are normalized from provider-specific strings to a stable internal enum
 *
 * Known values from NearBlocks API:
 * - TRANSFER: Balance change from transfers
 * - TRANSACTION: Balance change from transaction execution
 * - RECEIPT: Balance change from receipt execution
 * - CONTRACT_REWARD: Rewards from contract interaction
 * - MINT: Token minting
 * - STAKE: Staking operations
 * - FEE: Transaction fees
 * - GAS: Gas costs
 * - GAS_REFUND: Refunded gas
 *
 * If a new cause appears, normalization will fail and must be added to this enum.
 */
export const NearBalanceChangeCauseSchema = z.enum([
  'TRANSFER',
  'TRANSACTION',
  'RECEIPT',
  'CONTRACT_REWARD',
  'MINT',
  'STAKE',
  'FEE',
  'GAS',
  'GAS_REFUND',
]);

export type NearBalanceChangeCause = z.infer<typeof NearBalanceChangeCauseSchema>;

/**
 * V3: Normalized balance change from /activities endpoint
 * Contains balance changes (deltas)
 *
 * NEAR's asynchronous architecture creates balance changes at two lifecycle stages:
 * - TRANSACTION-LEVEL (cause: TRANSACTION): Transaction acceptance costs (gas prepayment, deposits)
 *   → receiptId is null (correct NEAR semantics) → processor attaches to transaction-level receipt
 * - RECEIPT-LEVEL (cause: RECEIPT, TRANSFER, etc.): Execution outcomes (state changes, transfers)
 *   → receiptId must be present → processor correlates to specific receipt
 *
 * Note: receiptId can be undefined (expected for TRANSACTION cause) or invalid (data quality issue).
 * Processor differentiates based on 'cause' field to handle each case appropriately.
 */
export const NearBalanceChangeSchema = NormalizedTransactionBaseSchema.extend({
  streamType: z.literal('balance-changes'),
  receiptId: z.string().min(1, 'Receipt ID must not be empty').optional(),
  affectedAccountId: z.string().min(1, 'Affected account ID must not be empty'),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  deltaAmountYocto: DecimalStringSchema.optional(),
  absoluteNonstakedAmount: DecimalStringSchema,
  absoluteStakedAmount: DecimalStringSchema,
  timestamp: z.number().positive('Timestamp must be positive'),
  blockHeight: z.string().min(1, 'Block height must not be empty'),
  cause: NearBalanceChangeCauseSchema,
  involvedAccountId: z.string().optional(),
});

export type NearBalanceChange = z.infer<typeof NearBalanceChangeSchema>;

/**
 * V3: Normalized token transfer from /ft-txns endpoint
 * Contains fungible token transfers
 *
 * Token transfers come from receipt execution (NEP-141 events), so they should
 * always have receiptId. If receiptId is missing or invalid, it indicates a
 * data quality issue with the provider.
 *
 * Note: receiptId can be undefined or invalid (not matching any receipt).
 * Processor will log a warning and attach to transaction-level synthetic receipt.
 */
export const NearTokenTransferSchema = NormalizedTransactionBaseSchema.extend({
  streamType: z.literal('token-transfers'),
  receiptId: z.string().min(1, 'Receipt ID must not be empty').optional(),
  affectedAccountId: z.string().min(1, 'Affected account ID must not be empty'),
  contractAddress: z.string().min(1, 'Contract address must not be empty'),
  deltaAmountYocto: DecimalStringSchema.optional(),
  decimals: z.number().nonnegative('Decimals must be non-negative'),
  symbol: z.string().optional(),
  name: z.string().optional(),
  timestamp: z.number().positive('Timestamp must be positive'),
  blockHeight: z.number().positive('Block height must be positive').optional(),
  cause: z.string().optional(),
  involvedAccountId: z.string().optional(),
});

export type NearTokenTransfer = z.infer<typeof NearTokenTransferSchema>;

/**
 * Union type for all V3 normalized stream events
 */
export const NearStreamEventSchema = z.discriminatedUnion('streamType', [
  NearTransactionSchema,
  NearReceiptSchema,
  NearBalanceChangeSchema,
  NearTokenTransferSchema,
]);

export type NearStreamEvent = z.infer<typeof NearStreamEventSchema>;
