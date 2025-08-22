import { z } from 'zod';
import { Decimal } from 'decimal.js';

// Custom Zod type for Decimal.js instances
const DecimalSchema = z.instanceof(Decimal, {
  message: "Expected Decimal instance"
});

// Money schema for consistent amount and currency structure
export const MoneySchema = z.object({
  amount: DecimalSchema,
  currency: z.string().min(1, "Currency must not be empty"),
});

// Transaction type schema
export const TransactionTypeSchema = z.enum([
  'trade',
  'deposit', 
  'withdrawal',
  'order',
  'ledger',
  'transfer',
  'fee'
]);

// Transaction status schema
export const TransactionStatusSchema = z.enum([
  'pending',
  'open',
  'closed', 
  'canceled',
  'failed',
  'ok'
]);

// Universal Transaction schema
export const UniversalTransactionSchema = z.object({
  // Required universal fields
  id: z.string().min(1, "Transaction ID must not be empty"),
  timestamp: z.number().int().positive("Timestamp must be a positive integer"),
  datetime: z.string().min(1, "Datetime string must not be empty"),
  type: TransactionTypeSchema,
  status: TransactionStatusSchema,
  amount: MoneySchema,
  source: z.string().min(1, "Source must not be empty"),
  metadata: z.record(z.string(), z.any()).default({}),
  
  // Optional fields
  fee: MoneySchema.optional(),
  price: MoneySchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  symbol: z.string().optional(),
  network: z.string().optional(),
}).strict(); // Reject unknown properties

// Universal Balance schema
export const UniversalBalanceSchema = z.object({
  currency: z.string().min(1, "Currency must not be empty"),
  total: z.number().min(0, "Total balance must be non-negative"),
  free: z.number().min(0, "Free balance must be non-negative"),
  used: z.number().min(0, "Used balance must be non-negative"),
  contractAddress: z.string().optional(),
}).strict()
.refine(
  (data) => data.total >= data.free + data.used,
  {
    message: "Total balance must be >= free + used",
    path: ["total"],
  }
);

// Type exports for use in other modules
export type ValidatedUniversalTransaction = z.infer<typeof UniversalTransactionSchema>;
export type ValidatedUniversalBalance = z.infer<typeof UniversalBalanceSchema>;
export type ValidatedMoney = z.infer<typeof MoneySchema>;

// Validation result types for error handling
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: z.ZodError;
}

// Helper function to validate and return typed results
export function validateUniversalTransaction(data: unknown): ValidationResult<ValidatedUniversalTransaction> {
  const result = UniversalTransactionSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return { success: false, errors: result.error };
}

export function validateUniversalBalance(data: unknown): ValidationResult<ValidatedUniversalBalance> {
  const result = UniversalBalanceSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return { success: false, errors: result.error };
}

// Batch validation helpers
export function validateUniversalTransactions(data: unknown[]): {
  valid: ValidatedUniversalTransaction[];
  invalid: Array<{ data: unknown; errors: z.ZodError }>;
} {
  const valid: ValidatedUniversalTransaction[] = [];
  const invalid: Array<{ data: unknown; errors: z.ZodError }> = [];
  
  for (const item of data) {
    const result = validateUniversalTransaction(item);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.errors) {
      invalid.push({ data: item, errors: result.errors });
    }
  }
  
  return { valid, invalid };
}

export function validateUniversalBalances(data: unknown[]): {
  valid: ValidatedUniversalBalance[];
  invalid: Array<{ data: unknown; errors: z.ZodError }>;
} {
  const valid: ValidatedUniversalBalance[] = [];
  const invalid: Array<{ data: unknown; errors: z.ZodError }> = [];
  
  for (const item of data) {
    const result = validateUniversalBalance(item);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.errors) {
      invalid.push({ data: item, errors: result.errors });
    }
  }
  
  return { valid, invalid };
}