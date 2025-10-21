import { Decimal } from 'decimal.js';
import { z } from 'zod';

import { MoneySchema } from './index.ts';

// Transaction type schema
export const TransactionTypeSchema = z.enum([
  'trade',
  'deposit',
  'withdrawal',
  'order',
  'ledger',
  'transfer',
  'fee',
  'staking_deposit',
  'staking_withdrawal',
  'staking_reward',
  'governance_deposit',
  'governance_refund',
  'internal_transfer',
  'proxy',
  'multisig',
  'utility_batch',
  'unknown',
]);

// Transaction status schema
export const TransactionStatusSchema = z.enum(['pending', 'open', 'closed', 'canceled', 'failed', 'success']);

// Operation category schema
export const OperationCategorySchema = z.enum(['trade', 'transfer', 'staking', 'defi', 'fee', 'governance']);

// Operation type schema
export const OperationTypeSchema = z.enum([
  'buy',
  'sell',
  'deposit',
  'withdrawal',
  'stake',
  'unstake',
  'reward',
  'swap',
  'fee',
  'batch',
  'transfer',
  'refund',
  'vote',
  'proposal',
]);

// Movement direction schema
export const MovementDirectionSchema = z.enum(['in', 'out', 'neutral']);

export const PriceAtTxTimeSchema = z.object({
  price: MoneySchema,
  source: z.string(),
  fetchedAt: z.date(),
  granularity: z.enum(['exact', 'minute', 'hour', 'day']).optional(),
});

// Asset movement schema
export const AssetMovementSchema = z.object({
  asset: z.string().min(1, 'Asset must not be empty'),
  amount: z.instanceof(Decimal, { message: 'Expected Decimal instance' }),
  priceAtTxTime: PriceAtTxTimeSchema.optional(),
});

// Transaction note schema
export const TransactionNoteSchema = z.object({
  type: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Universal Transaction schema (new structure)
export const UniversalTransactionSchema = z.object({
  // Core fields
  id: z.number().int(), //.positive('Transaction ID must not be empty'),
  uniqueId: z.string().min(1, 'Transaction ID must not be empty').optional(),
  datetime: z.string().min(1, 'Datetime string must not be empty'),
  timestamp: z.number().int().positive('Timestamp must be a positive integer'),
  source: z.string().min(1, 'Source must not be empty'),
  status: TransactionStatusSchema,
  from: z.string().optional(),
  to: z.string().optional(),

  // Structured movements
  movements: z.object({
    inflows: z.array(AssetMovementSchema).default([]).optional(),
    outflows: z.array(AssetMovementSchema).default([]).optional(),
  }),

  // Structured fees
  fees: z.object({
    network: MoneySchema.optional(),
    platform: MoneySchema.optional(),
    //total: MoneySchema,
  }),

  // Enhanced operation classification
  operation: z.object({
    category: OperationCategorySchema,
    type: OperationTypeSchema,
  }),

  // Blockchain metadata (optional - only for blockchain transactions)
  blockchain: z
    .object({
      name: z.string().min(1, 'Blockchain name must not be empty'),
      block_height: z.number().int().positive().optional(),
      transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
      is_confirmed: z.boolean(),
    })
    .optional(),

  // Optional fields
  note: TransactionNoteSchema.optional(),
  price: MoneySchema.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Universal Balance schema
export const UniversalBalanceSchema = z
  .object({
    contractAddress: z.string().optional(),
    currency: z.string().min(1, 'Currency must not be empty'),
    free: z.number().min(0, 'Free balance must be non-negative'),
    total: z.number().min(0, 'Total balance must be non-negative'),
    used: z.number().min(0, 'Used balance must be non-negative'),
  })
  .strict()
  .refine((data) => data.total >= data.free + data.used, {
    message: 'Total balance must be >= free + used',
    path: ['total'],
  });

// Type exports for use in other modules
export type ValidatedUniversalTransaction = z.infer<typeof UniversalTransactionSchema>;
export type ValidatedUniversalBalance = z.infer<typeof UniversalBalanceSchema>;
export type ValidatedMoney = z.infer<typeof MoneySchema>;

// Validation result types for error handling
export interface ValidationResult<T> {
  data?: T | undefined;
  errors?: z.ZodError | undefined;
  success: boolean;
}

// Helper function to validate and return typed results
export function validateUniversalTransaction(data: unknown): ValidationResult<ValidatedUniversalTransaction> {
  const result = UniversalTransactionSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

// Batch validation helpers
export function validateUniversalTransactions(data: unknown[]): {
  invalid: { data: unknown; errors: z.ZodError }[];
  valid: ValidatedUniversalTransaction[];
} {
  const valid: ValidatedUniversalTransaction[] = [];
  const invalid: { data: unknown; errors: z.ZodError }[] = [];

  for (const item of data) {
    const result = validateUniversalTransaction(item);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.errors) {
      invalid.push({ data: item, errors: result.errors });
    }
  }

  return { invalid, valid };
}
