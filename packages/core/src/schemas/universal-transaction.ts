import { z } from 'zod';

import { parseDecimal } from '../utils/decimal-utils.js';

import { SourceTypeSchema } from './import-session.js';
import { DateSchema, DecimalSchema, MoneySchema } from './money.js';

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

// Blockchain assetId validation predicates (shared by AssetMovementSchema and FeeMovementSchema)

function hasNoUnknownTokenRef(assetId: string): boolean {
  const parts = assetId.split(':');
  return !(parts.length >= 3 && parts[0] === 'blockchain' && parts[2] === 'unknown');
}

function hasValidBlockchainAssetIdFormat(assetId: string): boolean {
  const parts = assetId.split(':');
  if (parts[0] !== 'blockchain') return true;
  return parts.length >= 3 && !!parts[2] && parts[2].trim() !== '';
}

// Asset movement schema
export const AssetMovementSchema = z
  .object({
    // Asset identity (required)
    assetId: z.string().min(1, 'Asset ID must not be empty'), // Unique key for math & storage (e.g., blockchain:ethereum:0xa0b8...)
    assetSymbol: z.string().min(1, 'Asset symbol must not be empty'), // Display symbol (e.g., USDC, ETH)

    // Amount fields
    grossAmount: DecimalSchema, // Amount venue debited/credited (REQUIRED)
    netAmount: DecimalSchema.optional(), // Amount on-chain (repository defaults to grossAmount during save)

    // Price metadata
    priceAtTxTime: PriceAtTxTimeSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.netAmount && data.grossAmount) {
        return parseDecimal(data.netAmount).lte(parseDecimal(data.grossAmount));
      }
      return true;
    },
    { message: 'netAmount cannot exceed grossAmount' }
  )
  .refine((data) => hasNoUnknownTokenRef(data.assetId), {
    message:
      'Invalid assetId format: blockchain assets with unknown token reference are not allowed. ' +
      'Token movements must have contract address, mint address, policyId, or denom. ' +
      'Import should fail if this data is missing.',
  })
  .refine((data) => hasValidBlockchainAssetIdFormat(data.assetId), {
    message:
      'Invalid blockchain assetId format: must be blockchain:<chain>:native or blockchain:<chain>:<tokenRef>. ' +
      'Token reference (contract/mint/denom) must not be empty.',
  });

/**
 * Fee Movement Schema
 *
 * Captures WHO receives a fee and HOW it's paid using two orthogonal dimensions:
 *
 * SCOPE (Who receives the fee):
 * - 'network': Paid to miners/validators (gas, miner fees)
 * - 'platform': Exchange/venue revenue (withdrawal fees, trading fees, maker/taker)
 * - 'spread': Implicit fee in price quote deviation (supported by schema; accounting currently treats it like other fees if present)
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
 * For Disposal Proceeds (lot-matcher-utils.js:calculateFeesInFiat):
 * - Include ONLY fees where settlement='on-chain' (reduces what you received)
 * - Exclude fees where settlement='balance' (separate cost, doesn't affect proceeds)
 *
 * For Acquisition Cost Basis (lot-matcher-utils.js:calculateFeesInFiat):
 * - Include ALL fees (all settlements, all scopes)
 * - Fees increase what you paid to acquire the asset
 *
 * For Balance Calculation (balance-calculator.js):
 * - UTXO chains (settlement='on-chain'): Deduct grossAmount (fee embedded), skip fee subtraction
 * - Account-based chains (settlement='balance'): Deduct grossAmount + fee amount separately
 * - This ensures accurate balance tracking across different blockchain architectures
 */
export const FeeMovementSchema = z
  .object({
    // Asset identity (required)
    assetId: z.string().min(1, 'Asset ID must not be empty'), // Unique key for math & storage (e.g., blockchain:ethereum:0xa0b8...)
    assetSymbol: z.string().min(1, 'Asset symbol must not be empty'), // Display symbol (e.g., USDC, ETH)
    amount: DecimalSchema,

    // Fee semantics (required)
    scope: z.enum(['network', 'platform', 'spread', 'tax', 'other']),
    settlement: z.enum(['on-chain', 'balance', 'external']),

    // Price metadata
    priceAtTxTime: PriceAtTxTimeSchema.optional(),
  })
  .refine((data) => hasNoUnknownTokenRef(data.assetId), {
    message:
      'Invalid assetId format: blockchain assets with unknown token reference are not allowed. ' +
      'Fee movements must have contract address, mint address, policyId, or denom. ' +
      'Import should fail if this data is missing.',
  })
  .refine((data) => hasValidBlockchainAssetIdFormat(data.assetId), {
    message:
      'Invalid blockchain assetId format: must be blockchain:<chain>:native or blockchain:<chain>:<tokenRef>. ' +
      'Token reference (contract/mint/denom) must not be empty.',
  });

// Transaction note schema - allows additional properties for flexible metadata
export const TransactionNoteSchema = z.object({
  type: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const hasAccountingImpact = (data: {
  fees?: unknown[] | undefined;
  movements: { inflows?: unknown[] | undefined; outflows?: unknown[] | undefined };
}): boolean => {
  const hasInflows = (data.movements.inflows?.length ?? 0) > 0;
  const hasOutflows = (data.movements.outflows?.length ?? 0) > 0;
  const hasFees = (data.fees?.length ?? 0) > 0;
  return hasInflows || hasOutflows || hasFees;
};

// Base transaction schema (without id and accountId)
// Used for ProcessedTransaction type in processors before saving to database
const BaseUniversalTransactionObjectSchema = z.object({
  // Core fields
  externalId: z.string().min(1, 'Transaction ID must not be empty'),
  datetime: z.string().min(1, 'Datetime string must not be empty'),
  timestamp: z.number().int().positive('Timestamp must be a positive integer'),
  source: z.string().min(1, 'Source must not be empty'),
  sourceType: SourceTypeSchema,
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
  notes: z.array(TransactionNoteSchema).optional(),

  // Spam detection
  isSpam: z.boolean().optional(),

  // Accounting exclusion
  excludedFromAccounting: z.boolean().optional(),
});

const accountingImpactValidation = {
  message:
    'Transaction must have at least one movement (inflow/outflow) or fee entry. ' +
    'Transactions with no accounting impact should not be stored.',
};

const BaseUniversalTransactionSchema = BaseUniversalTransactionObjectSchema.refine(
  (data) => hasAccountingImpact(data),
  accountingImpactValidation
);

// Universal Transaction schema (full version with id and accountId)
// Used for database storage and retrieval
export const UniversalTransactionSchema = BaseUniversalTransactionObjectSchema.extend({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
}).refine((data) => hasAccountingImpact(data), accountingImpactValidation);

// Export base schema for use in processors (ProcessedTransaction type)
export { BaseUniversalTransactionSchema };

export type MovementDirection = z.infer<typeof MovementDirectionSchema>;
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export type OperationCategory = z.infer<typeof OperationCategorySchema>;
export type OperationType = z.infer<typeof OperationTypeSchema>;

export type TransactionNote = z.infer<typeof TransactionNoteSchema>;
export type PriceAtTxTime = z.infer<typeof PriceAtTxTimeSchema>;
export type AssetMovement = z.infer<typeof AssetMovementSchema>;
export type FeeMovement = z.infer<typeof FeeMovementSchema>;

/**
 * Operation classification result with optional notes
 * Used by transaction processors to classify operations
 */
export interface OperationClassification {
  operation: {
    category: OperationCategory;
    type: OperationType;
  };
  notes?: TransactionNote[] | undefined;
}

/**
 * Input DTO for creating universal transaction records
 * Used by processors before persistence
 * Write-side
 */
export type UniversalTransactionData = z.infer<typeof UniversalTransactionSchema>;
