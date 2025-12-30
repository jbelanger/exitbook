import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../core/schemas/normalized-transaction.js';

/**
 * NEAR account ID schema with validation
 *
 * NEAR uses human-readable account IDs with specific format requirements:
 * - 2-64 characters long (or 1 for system accounts)
 * - Contains only: lowercase letters (a-z), digits (0-9), underscores (_), hyphens (-), dots (.)
 * - Implicit accounts: 64-character hex strings
 * - Named accounts: account.near, sub.account.near
 * - System accounts: system, near
 *
 * Examples:
 * - 'alice.near' (named account)
 * - 'token.sweat' (sub-account)
 * - '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de' (implicit account)
 * - 'system' (system account)
 */
export const NearAccountIdSchema = z
  .string()
  .min(1, 'NEAR account ID must not be empty')
  .max(64, 'NEAR account ID must not exceed 64 characters')
  .refine(
    (val) => {
      // Allow implicit accounts (64 character hex strings)
      if (/^[0-9a-f]{64}$/.test(val)) return true;
      // Validate named accounts (lowercase letters, digits, underscores, hyphens, dots)
      return /^[a-z0-9_.-]+$/.test(val);
    },
    {
      message:
        'NEAR account ID must contain only lowercase letters, digits, underscores, hyphens, and dots, ' +
        'or be a 64-character hexadecimal string (implicit account)',
    }
  );

/**
 * Execution outcome for a NEAR receipt
 * Represents the result of executing a receipt's actions
 */
export const NearReceiptOutcomeSchema = z.object({
  /** Execution status - true if successful, false if failed */
  status: z.boolean(),

  /** Gas consumed during execution (in gas units, not yoctoNEAR) */
  gasBurnt: DecimalStringSchema,

  /** NEAR tokens burned as fees (in yoctoNEAR) */
  tokensBurntYocto: DecimalStringSchema,

  /** Execution logs emitted during receipt processing */
  logs: z.array(z.string()).optional(),

  /** Executor account that processed this receipt */
  executorAccountId: NearAccountIdSchema,
});

export type NearReceiptOutcome = z.infer<typeof NearReceiptOutcomeSchema>;

/**
 * Individual action within a NEAR receipt
 * Actions are the atomic operations performed by a receipt
 */
export const NearActionSchema = z.object({
  /**
   * Type of action (e.g., "CreateAccount", "Transfer", "FunctionCall")
   * Normalized to snake_case: "function_call", "create_account", etc.
   */
  actionType: z.string().min(1),

  /** Method name for FunctionCall actions */
  methodName: z.string().optional(),

  /** Method arguments (base64 or parsed JSON) */
  args: z.unknown().optional(),

  /**
   * Attached deposit in yoctoNEAR
   * NOT the same as transfer amount - used for gas, staking, contract calls
   */
  attachedDeposit: DecimalStringSchema.optional(),

  /** Gas allocation for this action (in gas units) */
  gas: DecimalStringSchema.optional(),

  /** Public key for AddKey/DeleteKey actions */
  publicKey: z.string().optional(),

  /** Beneficiary account for DeleteAccount action */
  beneficiaryId: NearAccountIdSchema.optional(),
});

export type NearAction = z.infer<typeof NearActionSchema>;

/**
 * Account balance change for NEAR native token
 * Represents the actual fund movement, not attached deposits
 */
export const NearBalanceChangeSchema = z.object({
  /** Account whose balance changed */
  accountId: NearAccountIdSchema,

  /** Balance before the receipt execution (in yoctoNEAR) */
  preBalance: DecimalStringSchema,

  /** Balance after the receipt execution (in yoctoNEAR) */
  postBalance: DecimalStringSchema,

  /**
   * Receipt that caused this balance change (optional, provided by NearBlocks)
   * When present, allows direct correlation to receipt
   */
  receiptId: z.string().min(1).optional(),

  /** Parent transaction hash (usually present) */
  transactionHash: z.string().min(1).optional(),

  /** Block timestamp (for fallback correlation) */
  blockTimestamp: z.number().positive(),
});

export type NearBalanceChange = z.infer<typeof NearBalanceChangeSchema>;

/**
 * NEP-141 fungible token transfer
 * These are parsed from FunctionCall actions and logs
 */
export const NearTokenTransferSchema = z.object({
  /** Token contract address */
  contractId: NearAccountIdSchema,

  /** Sender account */
  from: NearAccountIdSchema,

  /** Recipient account */
  to: NearAccountIdSchema,

  /** Transfer amount (normalized by decimals) */
  amount: DecimalStringSchema,

  /** Token decimals */
  decimals: z.number().nonnegative(),

  /** Token symbol (if known) */
  symbol: z.string().optional(),

  /** Receipt that contained this transfer */
  receiptId: z.string().min(1),

  /** Parent transaction hash */
  transactionHash: z.string().min(1),

  /** Block timestamp */
  blockTimestamp: z.number().positive(),
});

export type NearTokenTransfer = z.infer<typeof NearTokenTransferSchema>;

/**
 * NEAR receipt - the fundamental unit of execution
 * A transaction spawns one or more receipts, and receipts can spawn more receipts
 */
export const NearReceiptSchema = z.object({
  /** Unique receipt identifier (primary identity for execution events) */
  receiptId: z.string().min(1),

  /** Parent transaction hash that spawned this receipt */
  transactionHash: z.string().min(1),

  /** Account that triggered the receipt (may differ from transaction signer) */
  predecessorId: NearAccountIdSchema,

  /** Account that receives/executes the receipt */
  receiverId: NearAccountIdSchema,

  /**
   * Receipt kind: "ACTION", "DATA", or "REFUND"
   * Most receipts are ACTION receipts with executable actions
   */
  receiptKind: z.enum(['ACTION', 'DATA', 'REFUND']),

  /** Block height where receipt was executed */
  blockHeight: z.number().nonnegative(),

  /** Block hash where receipt was executed */
  blockHash: z.string().optional(),

  /** Block timestamp (Unix milliseconds) */
  blockTimestamp: z.number().positive(),

  /** Actions executed by this receipt (for ACTION receipts) */
  actions: z.array(NearActionSchema).optional(),

  /** Execution outcome (status, gas, fees) */
  outcome: NearReceiptOutcomeSchema.optional(),

  /** Account balance changes caused by this receipt */
  balanceChanges: z.array(NearBalanceChangeSchema).optional(),

  /** Token transfers caused by this receipt (NEP-141) */
  tokenTransfers: z.array(NearTokenTransferSchema).optional(),
});

export type NearReceipt = z.infer<typeof NearReceiptSchema>;

/**
 * NEAR transaction envelope
 * The transaction initiates execution but receipts perform the actual state changes
 */
export const NearTransactionSchema = z.object({
  /** Transaction hash (primary transaction identity) */
  transactionHash: z.string().min(1),

  /** Account that signed and initiated the transaction */
  signerId: NearAccountIdSchema,

  /** Intended receiver of the transaction (becomes first receipt's receiver) */
  receiverId: NearAccountIdSchema,

  /** Block where transaction was included */
  blockHeight: z.number().nonnegative(),

  /** Block hash */
  blockHash: z.string().optional(),

  /** Block timestamp (Unix milliseconds) */
  blockTimestamp: z.number().positive(),

  /**
   * Transaction-level actions (may differ from receipt actions)
   * The transaction actions are converted into receipt actions
   */
  actions: z.array(NearActionSchema),

  /** Overall transaction status (derived from receipt outcomes) */
  status: z.enum(['success', 'failed', 'pending']),

  /**
   * Receipts spawned by this transaction
   * One transaction can create multiple receipts
   */
  receipts: z.array(NearReceiptSchema),

  /** Provider that supplied this data */
  providerName: z.string().min(1),
});

export type NearTransaction = z.infer<typeof NearTransactionSchema>;

/**
 * Normalized NEAR event for ingestion pipeline
 * Represents a single receipt execution event
 *
 * Event granularity: ONE RECEIPT = ONE EVENT
 * - One receipt may have multiple balance changes and token transfers (stored as arrays)
 * - The accounting projection extracts multiple fund flows from a single event
 * - This avoids fee duplication and maintains semantic correctness
 *
 * Schema fields:
 * - `id` (from base): Transaction hash (parent transaction)
 * - `eventId` (from base): Receipt ID (unique event identifier for deduplication)
 * - `receiptId`: Receipt ID (NEAR-specific field for correlation)
 */
export const NearReceiptEventSchema = NormalizedTransactionBaseSchema.extend({
  /** Receipt ID (unique event identifier, duplicates eventId for NEAR-specific use) */
  receiptId: z.string().min(1),

  /** NEAR-native fields */
  signerId: NearAccountIdSchema,
  receiverId: NearAccountIdSchema,
  predecessorId: NearAccountIdSchema,

  /** Receipt metadata */
  receiptKind: z.enum(['ACTION', 'DATA', 'REFUND']),
  actions: z.array(NearActionSchema).optional(),

  /** Receipt outcome */
  status: z.enum(['success', 'failed', 'pending']),
  gasBurnt: DecimalStringSchema.optional(),
  tokensBurntYocto: DecimalStringSchema.optional(),

  /**
   * Fee paid for this receipt execution
   * Derived from tokens_burnt (already in yoctoNEAR)
   * Payer is the predecessor (who pays for this receipt's execution)
   */
  fee: z
    .object({
      amountYocto: DecimalStringSchema,
      payer: NearAccountIdSchema,
    })
    .optional(),

  /** Block data */
  blockHeight: z.number().nonnegative(),
  blockHash: z.string().optional(),
  timestamp: z.number().positive(),

  /**
   * Balance changes for NEAR native token (may be multiple)
   * Note: Deltas already include fee impact - don't double-subtract
   */
  balanceChanges: z.array(NearBalanceChangeSchema).optional(),

  /**
   * Token transfers for NEP-141 tokens (may be multiple)
   */
  tokenTransfers: z.array(NearTokenTransferSchema).optional(),

  /** Provider */
  providerName: z.string().min(1),
});

export type NearReceiptEvent = z.infer<typeof NearReceiptEventSchema>;
