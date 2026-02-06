/**
 * Zod schemas for NEAR normalized stream types
 *
 * Defines 4 provider-agnostic stream types:
 * 1. transactions - Base transaction metadata
 * 2. receipts - Receipt execution records
 * 3. balance-changes - Balance changes
 * 4. token-transfers - Token transfers
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
 * NEAR action types (snake_case)
 *
 * Known protocol actions:
 * - transfer: Token transfer between accounts
 * - function_call: Smart contract method invocation
 * - create_account: Account creation
 * - delete_account: Account deletion
 * - add_key/delete_key: Access key management
 * - stake: Staking operations
 * - deploy_contract: Contract deployment
 * - delegate_action: Meta-transaction
 *
 * New action types must be added to this enum.
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
 * NEAR receipt action
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
 * NEAR transaction with base metadata
 */
export const NearTransactionSchema = NormalizedTransactionBaseSchema.extend({
  streamType: z.literal('transactions'),
  transactionHash: z.string().min(1, 'Transaction hash must not be empty'),
  signerAccountId: z.string().min(1, 'Signer account ID must not be empty'),
  receiverAccountId: z.string().min(1, 'Receiver account ID must not be empty'),
  timestamp: z.number().positive('Timestamp must be positive'),
  blockHeight: z.number().positive('Block height must be positive').optional(),
  blockHash: z.string().optional(),
  status: z.boolean().optional(),
});

export type NearTransaction = z.infer<typeof NearTransactionSchema>;

/**
 * NEAR receipt execution record
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
  timestamp: z.number().positive('Timestamp must be positive'),
  executorAccountId: z.string().optional(),
  gasBurnt: DecimalStringSchema.optional(),
  tokensBurntYocto: DecimalStringSchema.optional(),
  status: z.boolean().optional(),
  logs: z.array(z.string()).optional(),
  actions: z.array(NearReceiptActionSchema).optional(),
});

export type NearReceipt = z.infer<typeof NearReceiptSchema>;

/**
 * Balance change cause values
 *
 * Known values:
 * - TRANSFER: Transfers
 * - TRANSACTION/RECEIPT: Transaction/receipt execution
 * - CONTRACT_REWARD: Contract rewards
 * - MINT: Token minting
 * - STAKE: Staking operations
 * - FEE/GAS/GAS_REFUND: Fee-related
 *
 * New causes must be added to this enum.
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
 * NEAR balance change
 *
 * NEAR's asynchronous architecture creates balance changes at two lifecycle stages:
 * - TRANSACTION-LEVEL (cause: TRANSACTION): Transaction acceptance costs (gas prepayment, deposits)
 *   → receiptId is null (correct NEAR semantics) → processor attaches to transaction-level receipt
 * - RECEIPT-LEVEL (cause: RECEIPT, TRANSFER, etc.): Execution outcomes (state changes, transfers)
 *   → receiptId must be present → processor correlates to specific receipt
 *
 * At least one of transactionHash or receiptId must be present for correlation.
 */
export const NearBalanceChangeSchema = NormalizedTransactionBaseSchema.extend({
  streamType: z.literal('balance-changes'),
  transactionHash: z.string().min(1, 'Transaction hash must not be empty').optional(),
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
}).superRefine((data, ctx) => {
  // At least one of transactionHash or receiptId must be present
  if (!data.transactionHash && !data.receiptId) {
    ctx.addIssue({
      code: 'custom',
      message: 'At least one of transactionHash or receiptId must be present',
      path: ['transactionHash'],
    });
  }
});

export type NearBalanceChange = z.infer<typeof NearBalanceChangeSchema>;

/**
 * NEAR token transfer
 */
export const NearTokenTransferSchema = NormalizedTransactionBaseSchema.extend({
  streamType: z.literal('token-transfers'),
  transactionHash: z.string().min(1, 'Transaction hash must not be empty'),
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
 * Union type for all normalized stream events
 */
export const NearStreamEventSchema = z.discriminatedUnion('streamType', [
  NearTransactionSchema,
  NearReceiptSchema,
  NearBalanceChangeSchema,
  NearTokenTransferSchema,
]);

export type NearStreamEvent = z.infer<typeof NearStreamEventSchema>;
