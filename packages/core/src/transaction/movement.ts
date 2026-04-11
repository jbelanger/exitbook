import {
  CurrencySchema,
  DateSchema,
  DecimalSchema,
  hasNoUnknownTokenRef,
  hasValidBlockchainAssetIdFormat,
  MoneySchema,
} from '@exitbook/foundation';
import { Decimal } from 'decimal.js';
import { z } from 'zod';

// Movement direction schema
export const MovementDirectionSchema = z.enum(['in', 'out', 'neutral']);

export const MovementRoleSchema = z.enum(['principal', 'staking_reward', 'protocol_overhead', 'refund_rebate']);

export const PriceAtTxTimeSchema = z.object({
  price: MoneySchema, // Always in USD after normalization (storage currency)
  quotedPrice: MoneySchema.optional(), // Transaction-time quoted price before normalization
  source: z.string(), // exchange-execution | derived-trade | derived-ratio | link-propagated | <provider-name>
  fetchedAt: DateSchema,
  granularity: z.enum(['exact', 'minute', 'hour', 'day']).optional(),
  // FX rate metadata (populated when original currency was converted to USD)
  fxRateToUSD: DecimalSchema.optional(), // Exchange rate used (e.g., 1.08 for EUR to USD)
  fxSource: z.string().optional(), // Source of FX rate (e.g., "ecb", "coingecko", "manual")
  fxTimestamp: DateSchema.optional(), // When FX rate was fetched
});

// Reusable assetId schema with format validation (blockchain, exchange, fiat namespaces)
export const AssetIdSchema = z
  .string()
  .min(1, 'Asset ID must not be empty')
  .refine(hasNoUnknownTokenRef, {
    message:
      'Invalid assetId format: blockchain assets with unknown token reference are not allowed. ' +
      'Token movements must have contract address, mint address, policyId, or denom. ' +
      'Import should fail if this data is missing.',
  })
  .refine(hasValidBlockchainAssetIdFormat, {
    message:
      'Invalid blockchain assetId format: must be blockchain:<chain>:native or blockchain:<chain>:<tokenRef>. ' +
      'Token reference (contract/mint/denom) must not be empty.',
  });

const AssetMovementFieldsSchema = z.object({
  assetId: AssetIdSchema, // Unique key for math & storage (e.g., blockchain:ethereum:0xa0b8...)
  assetSymbol: CurrencySchema, // Display symbol (e.g., USDC, ETH)
  grossAmount: DecimalSchema, // Amount venue debited/credited (REQUIRED)
  netAmount: DecimalSchema.optional(), // Amount on-chain (repository defaults to grossAmount during save)
  movementRole: MovementRoleSchema.optional(),
  priceAtTxTime: PriceAtTxTimeSchema.optional(),
});

const amountRefinement = (data: { grossAmount: Decimal; netAmount?: Decimal | undefined }) =>
  !data.netAmount || data.netAmount.lte(data.grossAmount);
const amountRefinementMessage = { message: 'netAmount cannot exceed grossAmount' };

/** Pre-persistence asset movement — no fingerprint yet. */
export const AssetMovementDraftSchema = AssetMovementFieldsSchema.refine(amountRefinement, amountRefinementMessage);

/** Persisted asset movement with canonical movementFingerprint. */
export const AssetMovementSchema = AssetMovementFieldsSchema.extend({
  movementFingerprint: z.string().min(1, 'Movement fingerprint must not be empty'),
}).refine(amountRefinement, amountRefinementMessage);

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
 * For Disposal Proceeds (lot-fee-utils.js:calculateFeesInFiat):
 * - Include ONLY fees where settlement='on-chain' (reduces what you received)
 * - Exclude fees where settlement='balance' (separate cost, doesn't affect proceeds)
 *
 * For Acquisition Cost Basis (lot-fee-utils.js:calculateFeesInFiat):
 * - Include ALL fees (all settlements, all scopes)
 * - Fees increase what you paid to acquire the asset
 *
 * For Balance Calculation (balance-utils.js):
 * - UTXO chains (settlement='on-chain'): Deduct grossAmount (fee embedded), skip fee subtraction
 * - Account-based chains (settlement='balance'): Deduct grossAmount + fee amount separately
 * - This ensures accurate balance tracking across different blockchain architectures
 */
export const FeeMovementDraftSchema = z.object({
  // Asset identity (required)
  assetId: AssetIdSchema, // Unique key for math & storage (e.g., blockchain:ethereum:0xa0b8...)
  assetSymbol: CurrencySchema, // Display symbol (e.g., USDC, ETH)
  amount: DecimalSchema,

  // Fee semantics (required)
  scope: z.enum(['network', 'platform', 'spread', 'tax', 'other']),
  settlement: z.enum(['on-chain', 'balance', 'external']),

  // Price metadata
  priceAtTxTime: PriceAtTxTimeSchema.optional(),
});

export const FeeMovementSchema = FeeMovementDraftSchema.extend({
  movementFingerprint: z.string().min(1, 'Movement fingerprint must not be empty'),
});

export type MovementDirection = z.infer<typeof MovementDirectionSchema>;
export type MovementRole = z.infer<typeof MovementRoleSchema>;
export type PriceAtTxTime = z.infer<typeof PriceAtTxTimeSchema>;
export type AssetMovementDraft = z.infer<typeof AssetMovementDraftSchema>;
export type AssetMovement = z.infer<typeof AssetMovementSchema>;
export type FeeMovementDraft = z.infer<typeof FeeMovementDraftSchema>;
export type FeeMovement = z.infer<typeof FeeMovementSchema>;
