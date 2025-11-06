import { z } from 'zod';

import { parseDecimal } from '../utils/decimal-utils.ts';

import { DateSchema, DecimalSchema, MoneySchema } from './money.ts';

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
  'airdrop',
]);

// Movement direction schema
export const MovementDirectionSchema = z.enum(['in', 'out', 'neutral']);

export const PriceAtTxTimeSchema = z.object({
  price: MoneySchema, // Always in USD after normalization (storage currency)
  source: z.string(), // exchange-execution | derived-trade | derived-ratio | link-propagated | <provider-name>
  fetchedAt: DateSchema,
  granularity: z.enum(['exact', 'minute', 'hour', 'day']).optional(),
  // FX rate metadata (populated when original currency was converted to USD)
  fxRateToUSD: DecimalSchema.optional(), // Exchange rate used (e.g., 1.08 for EUR to USD)
  fxSource: z.string().optional(), // Source of FX rate (e.g., "ecb", "coingecko", "manual")
  fxTimestamp: DateSchema.optional(), // When FX rate was fetched
});

/**
 * Asset Movement Schema
 *
 * Captures how assets move in/out of user accounts with TWO amount fields to handle different fee models:
 *
 * AMOUNT FIELDS:
 * - grossAmount: Amount debited/credited to venue balance (REQUIRED)
 * - netAmount: Amount transmitted on-chain (OPTIONAL, defaults to grossAmount)
 *
 * DECISION TREE - When netAmount differs from grossAmount:
 *
 * ┌─ Is this an OUTFLOW? ──────────────────────────────────────────┐
 * │                                                                 │
 * ├─ YES → Are there on-chain fees in the SAME asset?              │
 * │         │                                                       │
 * │         ├─ YES → Is this a UTXO-based blockchain?              │
 * │         │        │                                              │
 * │         │        ├─ YES (Bitcoin) →                            │
 * │         │        │   netAmount = grossAmount - fee             │
 * │         │        │   (UTXO model: fees carved from amounts)    │
 * │         │        │                                              │
 * │         │        └─ NO (Ethereum/Solana/etc.) →                │
 * │         │            netAmount = grossAmount                   │
 * │         │            (Account model: gas paid separately)      │
 * │         │                                                       │
 * │         └─ NO → netAmount = grossAmount                        │
 * │                                                                 │
 * └─ NO (INFLOW) → netAmount = grossAmount                         │
 *                                                                   │
 * REFERENCE TABLE BY BLOCKCHAIN TYPE:                              │
 *                                                                   │
 * | Blockchain Type | Fee Model        | grossAmount | netAmount  |
 * |-----------------|------------------|-------------|-------------|
 * | Bitcoin (UTXO)  | Implicit in UTXO | 2.0 BTC     | 1.9996 BTC |
 * |                 | fee = 0.0004 BTC |             | (- fee)    |
 * |-----------------|------------------|-------------|-------------|
 * | Ethereum (Acct) | Gas paid sep.    | 2.0 ETH     | 2.0 ETH    |
 * |                 | fee = 0.0001 ETH |             | (= gross)  |
 * |-----------------|------------------|-------------|-------------|
 * | Solana (Acct)   | Lamports sep.    | 2.0 SOL     | 2.0 SOL    |
 * |                 | fee = 0.000005   |             | (= gross)  |
 * |-----------------|------------------|-------------|-------------|
 * | Substrate(Acct) | Balance sep.     | 2.5 DOT     | 2.5 DOT    |
 * |                 | fee = 0.0156 DOT |             | (= gross)  |
 * |-----------------|------------------|-------------|-------------|
 * | Cosmos (Acct)   | Gas sep.         | 2.0 INJ     | 2.0 INJ    |
 * |                 | fee = 0.0005 INJ |             | (= gross)  |
 * |-----------------|------------------|-------------|-------------|
 * | Exchange (CEX)  | Platform fee sep.| 0.00648 BTC | 0.00648 BTC|
 * |                 | fee = 0.0004 BTC |             | (= gross)  |
 * |                 | settlement=bal   |             |            |
 * |-----------------|------------------|-------------|-------------|
 * | Coinbase UNI    | Platform on-chain| 18 UNI      | 17.836 UNI |
 * | Withdrawal      | fee = 0.164 UNI  |             | (- fee)    |
 * |                 | settlement=chain |             |            |
 * └─────────────────────────────────────────────────────────────────
 *
 * SPECIAL CASES:
 * - Coinbase UNI withdrawals: Platform fee carved from on-chain send
 *   → netAmount = grossAmount - fee (settlement='on-chain')
 * - Kraken withdrawals: Platform fee charged separately
 *   → netAmount = grossAmount (settlement='balance')
 *
 * DOWNSTREAM USAGE:
 * - Transfer Matching: Uses netAmount for reconciliation (what went on-chain)
 * - Balance Calc: Uses grossAmount for inflows and prefers netAmount for outflows (fallback to grossAmount)
 * - Cost Basis: Uses grossAmount for acquisition quantity
 */
export const AssetMovementSchema = z
  .object({
    asset: z.string().min(1, 'Asset must not be empty'),

    // Amount fields
    grossAmount: DecimalSchema, // Amount venue debited/credited (REQUIRED)
    netAmount: DecimalSchema.optional(), // Amount on-chain (repository defaults to grossAmount during save)

    // Price metadata
    priceAtTxTime: PriceAtTxTimeSchema.optional(),
  })
  .refine(
    (data) => {
      // Validation: netAmount cannot exceed grossAmount
      if (data.netAmount && data.grossAmount) {
        return parseDecimal(data.netAmount).lte(parseDecimal(data.grossAmount));
      }
      return true;
    },
    { message: 'netAmount cannot exceed grossAmount' }
  );

/**
 * Fee Movement Schema
 *
 * Captures WHO receives a fee and HOW it's paid using two orthogonal dimensions:
 *
 * SCOPE (Who receives the fee):
 * - 'network': Paid to miners/validators (gas, miner fees)
 * - 'platform': Exchange/venue revenue (withdrawal fees, trading fees, maker/taker)
 * - 'spread': Implicit fee in price quote deviation (informational only, not included in cost basis)
 * - 'tax': Regulatory levy (GST, VAT, FATCA withholding)
 * - 'other': Edge cases (penalties, staking commissions, etc.)
 *
 * SETTLEMENT (How the fee is paid):
 * - 'on-chain': Fee is carved out of inputs/transfer BEFORE netting (UTXO chains only)
 *   → Results in netAmount < grossAmount OR grossAmount includes the fee
 *   → Example: Bitcoin miner fee (paid from inputs, not from transfer itself)
 *   → Balance impact: already included in grossAmount calculation
 *
 * - 'balance': Fee is paid separately from the account balance
 *   → Transfer/movement happens at full grossAmount (netAmount = grossAmount)
 *   → Separate balance deduction for the fee
 *   → Examples: Ethereum gas, Solana fees, Kraken withdrawal fees, trading fees
 *   → Balance impact: subtract both transfer amount AND fee amount
 *
 * - 'external': Paid outside tracked balances (ACH, credit card, invoice)
 *   → Reserved for future use
 *   → Not common in current exchange/blockchain scenarios
 *
 * BLOCKCHAIN TYPE PATTERNS:
 *
 * UTXO Chains (Bitcoin):
 * | scope='network' + settlement='on-chain' | ✅ Miner fee carved from inputs (grossAmount includes fee)
 *
 * Account-Based Chains (Ethereum, Solana, Cosmos, Substrate):
 * | scope='network' + settlement='balance'  | ✅ Gas paid separately from account balance
 *
 * Exchange Fees:
 * | scope='platform' + settlement='balance' | ✅ Withdrawal/trading fees (separate ledger entry)
 * | scope='platform' + settlement='on-chain' | ✅ Platform fee carved from transfer (rare, e.g., Coinbase UNI)
 * | scope='tax'      + settlement='balance' | ✅ FATCA withholding (separate deduction)
 *
 * DOWNSTREAM USAGE:
 *
 * For Disposal Proceeds (lot-matcher-utils.ts:calculateFeesInFiat):
 * - Include ONLY fees where settlement='on-chain' (reduces what you received)
 * - Exclude fees where settlement='balance' (separate cost, doesn't affect proceeds)
 *
 * For Acquisition Cost Basis (lot-matcher-utils.ts:calculateFeesInFiat):
 * - Include ALL fees (all settlements, all scopes except 'spread')
 * - Fees increase what you paid to acquire the asset
 *
 * For Balance Calculation (balance-calculator.ts):
 * - UTXO chains (settlement='on-chain'): Deduct grossAmount (fee embedded), skip fee subtraction
 * - Account-based chains (settlement='balance'): Deduct grossAmount + fee amount separately
 * - This ensures accurate balance tracking across different blockchain architectures
 */
export const FeeMovementSchema = z.object({
  asset: z.string().min(1, 'Asset must not be empty'),
  amount: DecimalSchema,

  // Fee semantics (required)
  scope: z.enum(['network', 'platform', 'spread', 'tax', 'other']),
  settlement: z.enum(['on-chain', 'balance', 'external']),

  // Price metadata
  priceAtTxTime: PriceAtTxTimeSchema.optional(),
});

// Note metadata schema (for note.metadata field)
export const NoteMetadataSchema = z.record(z.string(), z.any());

// Transaction note schema
export const TransactionNoteSchema = z.object({
  type: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  metadata: NoteMetadataSchema.optional(),
});

// Transaction metadata schema (for raw_normalized_data field)
export const TransactionMetadataSchema = z.record(z.string(), z.unknown());

// Universal Transaction schema (new structure)
export const UniversalTransactionSchema = z.object({
  // Core fields
  id: z.number().int(),
  externalId: z.string().min(1, 'Transaction ID must not be empty'),
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
  fees: z.array(FeeMovementSchema).default([]),

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
