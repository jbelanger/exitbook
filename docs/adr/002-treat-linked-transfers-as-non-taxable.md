# ADR 002: Treat Linked Transfers as Non-Taxable Events

**Date**: 2025-11-01
**Status**: Proposed
**Deciders**: Joel Belanger (maintainer)
**Tags**: cost-basis, taxation, transfers, transaction-linking

---

## Context and Problem Statement

The cost basis calculator currently treats **all asset movements as taxable events**:

- Inflows (deposits/receives) → Create acquisition lots
- Outflows (withdrawals/sends) → Create disposals that trigger capital gains/losses

This creates **incorrect tax treatment** for transfers between a user's own accounts (exchange → wallet, wallet → wallet, wallet → exchange), which are **non-taxable events** in most tax jurisdictions.

### The Problem: Transfers Treated as Taxable Disposals

**Scenario: User transfers BTC from Kraken to their personal wallet**

```
Jan 1, 2024:   Buy 1 BTC @ $50,000 on Kraken
               ✅ Cost basis: $50,000

Feb 1, 2024:   Withdraw 1 BTC from Kraken (BTC @ $60,000)
               - Network fee: 0.0005 BTC
               - Platform fee: $1.50
               ❌ CURRENT: Entire 1 BTC treated as DISPOSAL
               ❌ Creates $10,000 capital gain (WRONG!)

Feb 1, 2024:   Receive 0.9995 BTC in wallet
               ❌ CURRENT: Treated as NEW ACQUISITION at $60,000
               ❌ Breaks cost basis chain from original purchase
```

**Current Cost Basis Chain (INCORRECT)**:

```
Kraken lot:    1 BTC @ $50,000  →  [DISPOSED] → $10,000 gain ❌
Wallet lot:    0.9995 BTC @ $60,000 (new cost basis) ❌
```

**Correct Cost Basis Chain (SHOULD BE)**:

```
Kraken lot:    1 BTC @ $50,000  →  [TRANSFERRED] → No gain/loss ✅
               ├─ 0.0005 BTC network fee → [DISPOSED] → Taxable ✅
               └─ $1.50 platform fee → Added to cost basis ✅
Wallet lot:    0.9995 BTC @ $50,000 + $1.50 = $50,001.50 total ✅
```

### Tax Treatment Requirements

According to tax regulations in major jurisdictions:

- **United States (IRS)**: Transfers between your own wallets are not taxable events. Only trades, sales, and exchanges trigger capital gains. Network fees paid in crypto are taxable disposals.
- **Canada (CRA)**: Moving cryptocurrency between your own accounts is not a disposition. Cost basis carries forward. Transaction fees are expenses that may be deductible or added to cost basis.
- **United Kingdom (HMRC)**: Transfers between your own wallets are not disposals for Capital Gains Tax purposes. Fees paid in crypto may constitute disposals.
- **European Union**: Most member states treat self-to-self transfers as non-taxable movements.

### Infrastructure Already in Place

The system **already has** the necessary infrastructure:

✅ **Transaction Linking** (`packages/accounting/src/linking/`)

- Detects and links related transactions based on asset, amount, timing, addresses
- Confidence scoring with auto-confirmation for high-confidence matches
- Status tracking: `suggested`, `confirmed`, `rejected`

✅ **Link Graph Builder** (`packages/accounting/src/price-enrichment/link-graph-builder.ts`)

- Uses Union-Find algorithm to group transitively linked transactions
- Groups entire multi-hop transfer chains together
- Already used for price propagation across platforms

❌ **Missing**: Cost basis calculator doesn't use links to identify non-taxable transfers

---

## Decision

We will **introduce a transfer graph preprocessing stage** that analyzes confirmed transaction links and produces explicit `TransferEvent` aggregates. These events are then consumed by the cost basis calculator to handle transfers as **non-taxable movements** rather than taxable disposals and acquisitions.

### Key Principles

1. **Separation of Concerns**: Transfer detection is decoupled from cost basis calculation through a clean event interface.

2. **Multi-hop First-Class**: Transfer chains (exchange → blockchain → exchange) are detected and rolled up to the final destination explicitly. Intermediate transactions are excluded from lot matching.

3. **Cost Basis Preservation**: The original cost basis flows through transfers via TransferEvent fields, prorated by the amount received.

4. **Complex Fee Support**:
   - Crypto fees (paid in same asset): Create taxable disposals
   - External fees (fiat): Increase cost basis of received asset
   - Third-asset fees (e.g., BNB for BTC withdrawal): Create separate taxable disposals
   - **Hybrid scenarios**: Multiple fee types can occur simultaneously

5. **Explicit State Tracking**: Transfer events track their processing state (`pending` → `source_processed` → `completed`) to prevent misuse of incomplete data.

6. **Link Quality Assurance**: Only confirmed links with ≥95% confidence are used for cost basis calculations.

7. **Price Data Requirements**: Calculation blocks if prices are missing for fee disposals. Manual price entry command provided.

8. **Separate Tracking**: Transfers are tracked separately from disposals in dedicated tables to maintain a complete audit trail.

9. **Strategy-Aware**: The lot matching strategy (FIFO/LIFO) determines which lots are transferred when multiple lots exist.

10. **Explicit Ordering**: Source transactions MUST be processed before target transactions. The system fails fast with clear errors if this constraint is violated.

---

## Architecture

### Three-Stage Pipeline

```
Stage 1: Transfer Graph Analysis
├─ Input: UniversalTransaction[], TransactionLink[] (≥95% confidence)
├─ Process: Group transitively linked transactions
├─ Detect: Simple (1:1) and multi-hop transfer patterns
├─ Rollup: Multi-hop chains collapse to final destination
├─ Fee Analysis:
│  ├─ Crypto fees (same asset): amount difference
│  ├─ External fees (fiat): from transaction metadata
│  └─ Third-asset fees: detected from fee movements
└─ Output: TransferEvent[] (state=pending, cost basis empty)

Stage 2: Lot Matching (Modified)
├─ Input: UniversalTransaction[], TransferEvent[]
├─ Skip: Intermediate transactions in multi-hop chains
├─ Process: Match transactions to lots using strategy (FIFO/LIFO)
├─ Source Processing:
│  ├─ Create disposal for crypto fees (taxable)
│  ├─ Create disposal for third-asset fees (taxable)
│  ├─ Calculate and populate cost basis on TransferEvent
│  └─ Update state: pending → source_processed
├─ Target Processing:
│  ├─ Read cost basis from TransferEvent (fail if missing)
│  ├─ Add external fees to cost basis
│  └─ Update state: source_processed → completed
├─ Price Validation:
│  └─ Block if any fee disposal has zero proceeds
└─ Output: AcquisitionLot[], LotDisposal[], LotTransfer[], ThirdAssetFeeDisposal[]

Stage 3: Gain/Loss Calculation (Unchanged)
├─ Input: LotDisposal[] (includes all fee disposals)
├─ Process: Apply jurisdiction rules
└─ Output: Capital gains/losses for tax reporting
```

### Why This Approach?

**Leverages Existing Infrastructure:**

- `LinkGraphBuilder` already groups transitively linked transactions
- `TransactionGroup` represents complete transfer chains
- Reuses proven Union-Find algorithm

**Clean Boundaries:**

- Transfer detection is independent and reusable
- Accounting layer receives events, not raw links
- No mutation of linking domain objects
- Cost basis flows through explicit TransferEvent fields

**Multi-Hop Native:**

- Handles exchange→blockchain→exchange chains
- Collapses to final destination transaction
- Intermediate transactions excluded from lot matching
- Accumulates fees across all hops

**Tax Compliant:**

- Fees paid in crypto (same or different asset) are properly treated as taxable disposals
- External fiat fees increase cost basis
- Original acquisition dates preserved through transfers
- Hybrid fee scenarios fully supported

**Explicit State Machine:**

- Transfer events track processing state
- Prevents using incomplete cost basis data
- Clear error messages for state violations

---

## Link Quality Assurance

Transaction linking is **critical infrastructure** for this feature. Incorrect links will cause incorrect tax calculations.

### Confidence Threshold

- **Auto-confirmation**: Links with ≥95% confidence are automatically confirmed
- **Manual review**: Links with 85-94% confidence remain `suggested` status
- **Rejection**: Links with <85% confidence are not used

### Link Quality Requirements

For a link to be used in cost basis calculation:

1. **Status**: Must be `confirmed`
2. **Confidence**: Must be ≥95% (for auto-confirmed links)
3. **Asset match**: Source outflow asset must match target inflow asset
4. **Amount reasonable**: Within 10% variance (accounts for fees)
5. **Timing reasonable**: Target within 24 hours of source (blockchain finality)

### User Review Workflow

Before cost basis calculation:

1. **Link detection** runs automatically during import/processing
2. **User reviews** suggested links via CLI:
   ```bash
   pnpm run dev links review --status suggested
   pnpm run dev links confirm <link-id>
   pnpm run dev links reject <link-id>
   ```
3. **Cost basis calculation** only uses confirmed links

### Audit Trail

All links log their matching criteria:

- `metadata.matchedFields`: Which fields contributed to confidence
- `metadata.confidenceBreakdown`: Score per matching criterion
- `metadata.confirmedBy`: 'auto' or 'user'
- `metadata.confirmedAt`: ISO 8601 timestamp

### Validation

Link sanity checks before use:

- Source and target transactions exist
- Asset symbols normalized (BTC = XBT = bitcoin)
- No circular links (A→B→A)
- No duplicate links for same transaction pair

---

## Price Data Requirements

Accurate price data is **required** for calculating proceeds on fee disposals. Missing prices result in incomplete tax calculations.

### Blocking Behavior

Cost basis calculation will **fail** if:

- Any crypto fee disposal has zero proceeds (missing price)
- Any third-asset fee disposal has zero proceeds (missing price)

Error message includes:

- Transaction ID and date
- Asset symbol
- Required price timestamp
- Suggested price sources

### Price Resolution Order

For fee disposal proceeds:

1. **Transaction metadata**: Use `fiatValue / amount` if present
2. **Price enrichment service**: Use derived or fetched prices
3. **Manual entry**: User provides price via CLI
4. **Fallback**: Zero proceeds, block calculation

### Manual Price Entry Command

New CLI command for adding missing prices:

```bash
# Add single price
pnpm run dev prices add --asset BTC --date "2024-02-01T12:00:00Z" --price 60000

# Add from CSV (batch)
pnpm run dev prices import --csv ./missing-prices.csv

# Re-run calculation after adding prices
pnpm run dev cost-basis calculate --recalculate
```

CSV format:

```csv
asset,timestamp,price_usd
BTC,2024-02-01T12:00:00Z,60000.00
ETH,2024-02-01T12:00:00Z,3200.00
```

### Price Status Tracking

Each disposal tracks price availability:

```typescript
export interface LotDisposal {
  // ... existing fields ...
  priceStatus: 'available' | 'estimated' | 'manual' | 'missing';
  priceSource?: string; // e.g., "transaction_metadata", "coingecko", "manual_entry"
}
```

### User-Facing Reports

Calculation summary includes:

```
Cost Basis Calculation Summary
==============================
Disposals: 45 total
├─ Complete: 40 (prices available)
├─ Manual prices: 3 (user-provided)
└─ Missing prices: 2 (REQUIRES ATTENTION)

Missing Prices:
- BTC @ 2024-02-01 12:00:00 UTC (tx #12345, network fee)
- ETH @ 2024-03-15 08:30:00 UTC (tx #67890, platform fee)

Run: pnpm run dev prices add --help
```

---

## Timestamp Handling

Chronological transaction ordering is **required** for correct FIFO/LIFO lot matching.

### Ordering Rules

Transactions sorted by:

1. **Primary**: `datetime` field (ISO 8601 timestamp)
2. **Tiebreaker**: `id` field (transaction ID, stable sort)

### Timestamp Normalization

All transaction timestamps normalized during import:

- Convert to UTC
- Precision: Seconds (milliseconds preserved but not used for ordering)
- Validation: No future dates, no dates before 2009-01-03 (Bitcoin genesis)

### Same-Second Transactions

When multiple transactions have the same timestamp:

- Use transaction ID as tiebreaker (ascending)
- Ensures deterministic, reproducible ordering
- Prevents ambiguity in FIFO/LIFO calculations

Example:

```
datetime                  id    order
2024-02-01T12:00:00Z     105      1  (lower ID processed first)
2024-02-01T12:00:00Z     107      2
2024-02-01T12:00:01Z     103      3  (newer timestamp)
```

### Exchange vs Blockchain Timing

**Known issue**: Exchange timestamps (trade execution) may differ from blockchain timestamps (block confirmation) by minutes/hours.

**Mitigation**: Transaction linking uses 24-hour window to account for this variance. User can manually adjust timestamps if needed:

```bash
pnpm run dev transactions adjust-time --id 12345 --datetime "2024-02-01T12:05:00Z"
```

---

## Implementation

### 1. Updated Transfer Event Schema

```typescript
// packages/accounting/src/transfers/schemas.ts

import { DateSchema, DecimalSchema } from '@exitbook/core';
import { z } from 'zod';

/**
 * Processing state of transfer event
 */
export const TransferProcessingStateSchema = z.enum([
  'pending', // Created in Stage 1, cost basis not yet calculated
  'source_processed', // Source transaction processed, cost basis populated
  'completed', // Target transaction processed successfully
]);

/**
 * Type of transfer event
 */
export const TransferEventTypeSchema = z.enum([
  'simple', // 1 source → 1 target (most common)
  'multi_hop', // source → intermediate(s) → target (collapsed to endpoints)
]);

/**
 * Fee entry for transfers
 * Supports multiple simultaneous fees (hybrid scenarios)
 */
export const TransferFeeSchema = z.object({
  // Fee asset (e.g., "BTC" for crypto fee, "USD" for fiat fee, "BNB" for third-asset fee)
  asset: z.string(),

  // Fee amount in the asset
  amount: DecimalSchema,

  // Fee type determines tax treatment
  type: z.enum([
    'crypto_fee', // Fee paid in same asset as transfer (taxable disposal)
    'external_fee', // Fee paid in fiat (increases cost basis)
    'third_asset_fee', // Fee paid in different crypto (separate taxable disposal)
  ]),

  // Fiat value (required for external_fee and third_asset_fee)
  fiatValue: DecimalSchema.optional(),
});

export type TransferFee = z.infer<typeof TransferFeeSchema>;

/**
 * Transfer event schema (REVISED)
 *
 * Supports complex fee scenarios:
 * - Multiple fees on one transfer (e.g., 0.0005 BTC network + $1.50 platform)
 * - Fees paid in third asset (e.g., BNB for BTC withdrawal)
 * - Hybrid combinations of above
 *
 * Processing lifecycle:
 * 1. Stage 1: Created with state=pending, costBasisPerUnit=undefined
 * 2. Stage 2 (source): Populated with cost basis, state=source_processed
 * 3. Stage 2 (target): Uses cost basis, state=completed
 */
export const TransferEventSchema = z
  .object({
    id: z.string().uuid(),
    asset: z.string(), // Primary asset being transferred

    // Processing state (explicit state machine)
    processingState: TransferProcessingStateSchema,

    // Source transaction (where assets leave)
    sourceTransactionId: z.number().int().positive(),
    sourceAmount: DecimalSchema,

    // Target transaction (where assets arrive) - FINAL destination for multi-hop
    targetTransactionId: z.number().int().positive(),
    targetAmount: DecimalSchema,

    // For multi-hop: intermediate transaction IDs between source and target
    // These transactions are SKIPPED during lot matching to avoid double-counting
    intermediateTransactionIds: z.array(z.number().int().positive()).default([]),

    // Fee analysis (REVISED: supports multiple fees)
    fees: z.array(TransferFeeSchema).default([]),

    // Event type
    eventType: TransferEventTypeSchema,

    // All link IDs forming the chain
    linkChain: z.array(z.string()),

    // Cost basis (populated during source transaction processing in Stage 2)
    // REQUIRED before target transaction can be processed
    costBasisPerUnit: DecimalSchema.optional(),
    totalCostBasis: DecimalSchema.optional(),

    createdAt: DateSchema,
    updatedAt: DateSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => {
      // Validate state transitions
      if (data.processingState === 'pending') {
        // Pending: cost basis must be empty
        return !data.costBasisPerUnit && !data.totalCostBasis;
      }
      if (data.processingState === 'source_processed' || data.processingState === 'completed') {
        // Processed states: cost basis must be populated
        return data.costBasisPerUnit && data.totalCostBasis;
      }
      return true;
    },
    {
      message: 'Processing state must match cost basis population: pending=empty, source_processed/completed=populated',
    }
  )
  .refine(
    (data) => {
      // Validate fee types
      for (const fee of data.fees) {
        if (fee.type === 'crypto_fee' && fee.asset !== data.asset) {
          return false; // Crypto fee must be in same asset as transfer
        }
        if ((fee.type === 'external_fee' || fee.type === 'third_asset_fee') && !fee.fiatValue) {
          return false; // External and third-asset fees require fiat value
        }
      }
      return true;
    },
    {
      message: 'Fee types must be consistent: crypto_fee in same asset, external/third_asset with fiatValue',
    }
  );

export type TransferEvent = z.infer<typeof TransferEventSchema>;
```

### 2. Third-Asset Fee Disposal Schema

```typescript
// packages/accounting/src/domain/schemas.ts

/**
 * Disposal created for fees paid in a different crypto asset
 * Example: Using BNB to pay withdrawal fee for BTC
 *
 * These are tracked separately from regular disposals for clarity
 */
export const ThirdAssetFeeDisposalSchema = z.object({
  id: z.string().uuid(),
  transferEventId: z.string().uuid(), // Associated transfer event
  disposalTransactionId: z.number().int().positive(),

  // Fee asset (different from transfer asset)
  feeAsset: z.string(),
  feeAmount: DecimalSchema,

  // Lot information (which lot the fee came from)
  lotId: z.string().uuid(),
  costBasisPerUnit: DecimalSchema,
  totalCostBasis: DecimalSchema,

  // Proceeds (market value at time of fee payment)
  proceedsPerUnit: DecimalSchema,
  totalProceeds: DecimalSchema,
  priceStatus: z.enum(['available', 'estimated', 'manual', 'missing']),
  priceSource: z.string().optional(),

  disposalDate: DateSchema,
  createdAt: DateSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ThirdAssetFeeDisposal = z.infer<typeof ThirdAssetFeeDisposalSchema>;
```

### 3. Modified Transfer Graph Analyzer

The analyzer is updated to detect multiple fee types:

```typescript
// packages/accounting/src/transfers/transfer-graph-analyzer.ts

/**
 * Analyze fee structure to determine all fees
 *
 * Returns array of fees (supports hybrid scenarios)
 */
private analyzeFees(
  sourceTx: UniversalTransaction,
  targetTx: UniversalTransaction,
  asset: string,
  sourceAmount: Decimal,
  targetAmount: Decimal
): TransferFee[] {
  const fees: TransferFee[] = [];

  // 1. Check for crypto fee (amount difference in transferred asset)
  const amountDifference = sourceAmount.minus(targetAmount);
  if (amountDifference.isPositive()) {
    fees.push({
      asset,
      amount: amountDifference,
      type: 'crypto_fee',
    });
  }

  // 2. Check for external fiat fees from transaction metadata
  const fiatFees = this.extractFiatFees(sourceTx);
  if (fiatFees.isPositive()) {
    fees.push({
      asset: 'USD', // Assume USD for now, TODO: multi-currency support
      amount: fiatFees,
      type: 'external_fee',
      fiatValue: fiatFees,
    });
  }

  // 3. Check for third-asset fees (e.g., BNB for BTC withdrawal)
  const thirdAssetFees = this.extractThirdAssetFees(sourceTx, asset);
  fees.push(...thirdAssetFees);

  return fees;
}

/**
 * Extract fees paid in a different crypto asset
 */
private extractThirdAssetFees(
  tx: UniversalTransaction,
  transferAsset: string
): TransferFee[] {
  const fees: TransferFee[] = [];

  // Check transaction fee movements for different assets
  const feeMovements = tx.movements.fees || [];

  for (const fee of feeMovements) {
    // Skip if fee is in the same asset (handled as crypto_fee)
    if (fee.asset === transferAsset) {
      continue;
    }

    // This is a third-asset fee (e.g., BNB for BTC withdrawal)
    fees.push({
      asset: fee.asset,
      amount: fee.amount,
      type: 'third_asset_fee',
      fiatValue: fee.fiatValue,
    });
  }

  return fees;
}
```

### 4. Modified LotMatcher for Complex Fees

Updated `handleTransferOut()` to process all fee types:

```typescript
// packages/accounting/src/services/lot-matcher.ts

private handleTransferOut(
  transaction: UniversalTransaction,
  outflow: AssetMovement,
  transferEvent: TransferEvent,
  allLots: AcquisitionLot[],
  config: LotMatcherConfig
): Result<{
  transfers: LotTransfer[];
  cryptoFeeDisposal?: LotDisposal;
  thirdAssetFeeDisposals: ThirdAssetFeeDisposal[];
}, Error> {
  // Verify state transition
  if (transferEvent.processingState !== 'pending') {
    return err(new Error(
      `Transfer event ${transferEvent.id} state is ${transferEvent.processingState}, expected pending. ` +
      `This indicates duplicate or out-of-order processing.`
    ));
  }

  // ... existing lot matching logic ...

  // Process fees by type
  let cryptoFeeDisposal: LotDisposal | undefined;
  const thirdAssetFeeDisposals: ThirdAssetFeeDisposal[] = [];

  for (const fee of transferEvent.fees) {
    if (fee.type === 'crypto_fee') {
      // Crypto fee: create disposal from transfer lots (already handled above)
      // ... existing crypto fee logic ...
    } else if (fee.type === 'external_fee') {
      // External fee: add to cost basis (handled in createLotFromTransfer)
      // No disposal created
    } else if (fee.type === 'third_asset_fee') {
      // Third-asset fee: create separate disposal
      const feeDisposalResult = this.createThirdAssetFeeDisposal(
        transaction,
        fee,
        transferEvent,
        allLots,
        config
      );
      if (feeDisposalResult.isErr()) return err(feeDisposalResult.error);
      thirdAssetFeeDisposals.push(feeDisposalResult.value);
    }
  }

  // UPDATE STATE: pending → source_processed
  transferEvent.processingState = 'source_processed';
  transferEvent.costBasisPerUnit = avgCostBasisPerUnit;
  transferEvent.totalCostBasis = totalTransferCostBasis;
  transferEvent.updatedAt = new Date();

  return ok({ transfers, cryptoFeeDisposal, thirdAssetFeeDisposals });
}

/**
 * Create disposal for fee paid in different crypto asset
 */
private createThirdAssetFeeDisposal(
  transaction: UniversalTransaction,
  fee: TransferFee,
  transferEvent: TransferEvent,
  allLots: AcquisitionLot[],
  config: LotMatcherConfig
): Result<ThirdAssetFeeDisposal, Error> {
  // Find open lots for the fee asset
  const openLots = allLots.filter(
    lot => lot.asset === fee.asset &&
           (lot.status === 'open' || lot.status === 'partially_disposed')
  );

  if (openLots.length === 0) {
    return err(new Error(
      `No open lots available for third-asset fee: ${fee.amount} ${fee.asset} ` +
      `in transaction ${transaction.id}. Cannot create fee disposal.`
    ));
  }

  // Use strategy to match which lot to use
  const disposal = {
    transactionId: transaction.id,
    asset: fee.asset,
    quantity: fee.amount,
    date: new Date(transaction.datetime),
    proceedsPerUnit: new Decimal(0), // Will be calculated from price
  };

  const lotDisposals = config.strategy.matchDisposal(disposal, openLots);

  if (lotDisposals.length === 0) {
    return err(new Error(`Failed to match lot for third-asset fee disposal`));
  }

  // Take first lot disposal (should only be one for fee)
  const lotDisposal = lotDisposals[0];
  const lot = openLots.find(l => l.id === lotDisposal.lotId);

  if (!lot) {
    return err(new Error(`Lot ${lotDisposal.lotId} not found`));
  }

  // Update lot
  lot.remainingQuantity = lot.remainingQuantity.minus(fee.amount);
  if (lot.remainingQuantity.isZero()) {
    lot.status = 'fully_disposed';
  } else {
    lot.status = 'partially_disposed';
  }
  lot.updatedAt = new Date();

  // Calculate proceeds from price
  const priceResult = this.getAssetPrice(transaction, fee.asset);

  let priceStatus: 'available' | 'estimated' | 'manual' | 'missing';
  let priceSource: string | undefined;
  let price: Decimal;

  if (priceResult.isOk()) {
    price = priceResult.value.price;
    priceStatus = priceResult.value.status;
    priceSource = priceResult.value.source;
  } else {
    // Price missing - block calculation
    price = new Decimal(0);
    priceStatus = 'missing';
    this.logger.error(
      { txId: transaction.id, asset: fee.asset, amount: fee.amount.toString() },
      'Missing price for third-asset fee disposal - calculation will be blocked'
    );
  }

  const proceeds = price.times(fee.amount);

  return ok({
    id: uuidv4(),
    transferEventId: transferEvent.id,
    disposalTransactionId: transaction.id,
    feeAsset: fee.asset,
    feeAmount: fee.amount,
    lotId: lot.id,
    costBasisPerUnit: lot.costBasisPerUnit,
    totalCostBasis: lot.costBasisPerUnit.times(fee.amount),
    proceedsPerUnit: price,
    totalProceeds: proceeds,
    priceStatus,
    priceSource,
    disposalDate: new Date(transaction.datetime),
    createdAt: new Date(),
    metadata: {
      transferFee: true,
      thirdAssetFee: true,
    },
  });
}
```

### 5. Target Transaction Processing

When processing target transaction, update state:

```typescript
private createLotFromTransfer(
  transaction: UniversalTransaction,
  inflow: AssetMovement,
  transferEvent: TransferEvent,
  config: LotMatcherConfig
): Result<AcquisitionLot, Error> {
  // Verify state
  if (transferEvent.processingState !== 'source_processed') {
    return err(new Error(
      `Transfer event ${transferEvent.id} state is ${transferEvent.processingState}, ` +
      `expected source_processed. Source transaction ${transferEvent.sourceTransactionId} ` +
      `must be processed before target transaction ${transaction.id}.`
    ));
  }

  // Cost basis should be populated
  if (!transferEvent.costBasisPerUnit || !transferEvent.totalCostBasis) {
    return err(new Error(
      `Transfer event ${transferEvent.id} is missing cost basis despite being in ` +
      `source_processed state. This indicates a bug in source processing.`
    ));
  }

  const transferredCostBasisPerUnit = transferEvent.costBasisPerUnit;

  // Add external fees to cost basis
  let adjustedCostBasis = transferredCostBasisPerUnit;

  for (const fee of transferEvent.fees) {
    if (fee.type === 'external_fee' && fee.fiatValue) {
      // Spread external fee cost across received amount
      const feePerUnit = fee.fiatValue.dividedBy(inflow.amount);
      adjustedCostBasis = adjustedCostBasis.plus(feePerUnit);
    }
  }

  // UPDATE STATE: source_processed → completed
  transferEvent.processingState = 'completed';
  transferEvent.updatedAt = new Date();

  return ok(createAcquisitionLot({
    id: uuidv4(),
    calculationId: config.calculationId,
    acquisitionTransactionId: transaction.id,
    asset: inflow.asset,
    quantity: inflow.amount,
    costBasisPerUnit: adjustedCostBasis,
    method: config.strategy.getName(),
    transactionDate: new Date(transaction.datetime),
  }));
}
```

### 6. Price Validation

Before completing calculation, validate all fee disposals have prices:

```typescript
// packages/accounting/src/services/cost-basis-calculator.ts

async calculate(
  transactions: UniversalTransaction[],
  config: CostBasisConfig,
  rules: IJurisdictionRules
): Promise<Result<CostBasisSummary, Error>> {
  // ... stages 1-2 ...

  // VALIDATION: Check for missing prices
  const allDisposals = lotMatchResult.assetResults.flatMap(r => r.disposals);
  const missingPrices = allDisposals.filter(d => d.priceStatus === 'missing');

  if (missingPrices.length > 0) {
    const errorDetails = missingPrices.map(d => {
      const tx = transactions.find(t => t.id === d.disposalTransactionId);
      return `- ${d.asset} @ ${tx?.datetime || 'unknown date'} (tx #${d.disposalTransactionId})`;
    }).join('\n');

    const errorMessage =
      `Cost basis calculation blocked due to missing price data.\n\n` +
      `Missing prices for ${missingPrices.length} fee disposal(s):\n` +
      `${errorDetails}\n\n` +
      `Resolution:\n` +
      `1. Run: pnpm run dev prices fetch (try fetching from external sources)\n` +
      `2. Or add manually: pnpm run dev prices add --asset <ASSET> --date <DATE> --price <PRICE>\n` +
      `3. Then re-run: pnpm run dev cost-basis calculate`;

    await this.updateCalculationStatus(calculationId, 'failed', errorMessage);
    return err(new Error(errorMessage));
  }

  // ... continue with stage 3 ...
}
```

### 7. Database Schema Updates

```sql
-- Migration: packages/data/src/migrations/001_initial_schema.ts

-- Updated table: transfer_events (with processing state and fees array)
CREATE TABLE transfer_events (
  id TEXT PRIMARY KEY,
  asset TEXT NOT NULL,

  -- Processing state (explicit state machine)
  processing_state TEXT NOT NULL DEFAULT 'pending',

  -- Source and target transactions
  source_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  source_amount TEXT NOT NULL,
  target_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  target_amount TEXT NOT NULL,

  -- Multi-hop support
  intermediate_transaction_ids TEXT, -- JSON array

  -- Fee analysis (REVISED: stored as JSON array of TransferFee objects)
  fees_json TEXT NOT NULL DEFAULT '[]',

  -- Event type
  event_type TEXT NOT NULL,

  -- Link chain
  link_chain_json TEXT NOT NULL,

  -- Cost basis (populated during Stage 2)
  cost_basis_per_unit TEXT,
  total_cost_basis TEXT,

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT,

  CONSTRAINT transfer_events_amounts_positive CHECK (
    CAST(source_amount AS REAL) > 0 AND
    CAST(target_amount AS REAL) > 0
  ),
  CONSTRAINT transfer_events_type_valid CHECK (
    event_type IN ('simple', 'multi_hop')
  ),
  CONSTRAINT transfer_events_state_valid CHECK (
    processing_state IN ('pending', 'source_processed', 'completed')
  )
);

-- Indexes for transfer_events
CREATE INDEX idx_transfer_events_source ON transfer_events(source_transaction_id);
CREATE INDEX idx_transfer_events_target ON transfer_events(target_transaction_id);
CREATE INDEX idx_transfer_events_asset ON transfer_events(asset);
CREATE INDEX idx_transfer_events_type ON transfer_events(event_type);
CREATE INDEX idx_transfer_events_state ON transfer_events(processing_state);

-- New table: third_asset_fee_disposals
CREATE TABLE third_asset_fee_disposals (
  id TEXT PRIMARY KEY,
  transfer_event_id TEXT NOT NULL REFERENCES transfer_events(id) ON DELETE CASCADE,
  disposal_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,

  -- Fee details
  fee_asset TEXT NOT NULL,
  fee_amount TEXT NOT NULL,

  -- Lot information
  lot_id TEXT NOT NULL REFERENCES acquisition_lots(id) ON DELETE CASCADE,
  cost_basis_per_unit TEXT NOT NULL,
  total_cost_basis TEXT NOT NULL,

  -- Proceeds
  proceeds_per_unit TEXT NOT NULL,
  total_proceeds TEXT NOT NULL,
  price_status TEXT NOT NULL,
  price_source TEXT,

  -- Timestamps
  disposal_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT,

  CONSTRAINT third_asset_fee_amount_positive CHECK (CAST(fee_amount AS REAL) > 0),
  CONSTRAINT third_asset_fee_price_status_valid CHECK (
    price_status IN ('available', 'estimated', 'manual', 'missing')
  )
);

-- Indexes for third_asset_fee_disposals
CREATE INDEX idx_third_asset_fee_transfer ON third_asset_fee_disposals(transfer_event_id);
CREATE INDEX idx_third_asset_fee_disposal_tx ON third_asset_fee_disposals(disposal_transaction_id);
CREATE INDEX idx_third_asset_fee_lot ON third_asset_fee_disposals(lot_id);
CREATE INDEX idx_third_asset_fee_asset ON third_asset_fee_disposals(fee_asset);
CREATE INDEX idx_third_asset_fee_date ON third_asset_fee_disposals(disposal_date);

-- Updated table: lot_disposals (add price status tracking)
ALTER TABLE lot_disposals ADD COLUMN price_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE lot_disposals ADD COLUMN price_source TEXT;

-- Update existing lot_transfers table (unchanged from original)
CREATE TABLE lot_transfers (
  id TEXT PRIMARY KEY,
  source_lot_id TEXT NOT NULL REFERENCES acquisition_lots(id) ON DELETE CASCADE,
  transfer_event_id TEXT NOT NULL REFERENCES transfer_events(id) ON DELETE CASCADE,
  source_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  target_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  quantity_transferred TEXT NOT NULL,
  cost_basis_per_unit TEXT NOT NULL,
  total_cost_basis TEXT NOT NULL,
  transfer_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT,
  CONSTRAINT lot_transfers_quantity_positive CHECK (CAST(quantity_transferred AS REAL) > 0),
  CONSTRAINT lot_transfers_cost_basis_nonnegative CHECK (CAST(cost_basis_per_unit AS REAL) >= 0)
);

-- Indexes for lot_transfers (unchanged)
CREATE INDEX idx_lot_transfers_source_lot ON lot_transfers(source_lot_id);
CREATE INDEX idx_lot_transfers_event ON lot_transfers(transfer_event_id);
CREATE INDEX idx_lot_transfers_source_tx ON lot_transfers(source_transaction_id);
CREATE INDEX idx_lot_transfers_target_tx ON lot_transfers(target_transaction_id);
CREATE INDEX idx_lot_transfers_date ON lot_transfers(transfer_date);
```

---

## Reporting and Visibility

### Multi-Hop Chain Display

Intermediate transactions are visible but de-emphasized:

```
Transaction List (with transfers)
═══════════════════════════════════════════════════════════
ID    Date                Type         Amount        Status
12345 2024-02-01 12:00   Withdrawal   1.0000 BTC    Transfer (source)
                                      └─ Network fee: 0.0005 BTC (taxable)
                                      └─ Platform fee: $1.50 (to cost basis)
                                      └─ BNB fee: 0.01 BNB (taxable)

12346 2024-02-01 12:05   Deposit      0.9995 BTC    [Intermediate - click to expand]

12347 2024-02-01 14:30   Deposit      0.9995 BTC    Transfer (target)
                                      └─ Received: 0.9995 BTC
                                      └─ Cost basis: $50,001.50 (inherited + fees)
```

Expanded view shows full chain:

```
Transfer Chain Details
═══════════════════════════════════════════════════════════
Transfer ID: abc-123-def
Type: Multi-hop (3 transactions)
Asset: BTC

Source: Kraken (tx #12345)
├─ Sent: 1.0000 BTC
├─ Fees:
│  ├─ Network (BTC): 0.0005 BTC → Disposal @ $60,000 = $30 proceeds
│  ├─ Platform (USD): $1.50 → Added to cost basis
│  └─ BNB: 0.01 BNB → Disposal @ $550 = $5.50 proceeds
└─ Cost basis: $50,000 (from original lot #789)

Hop 1: Blockchain (tx #12346) [SKIPPED IN ACCOUNTING]
├─ Received: 0.9995 BTC
└─ Status: Intermediate transaction, not processed

Target: Personal Wallet (tx #12347)
├─ Received: 0.9995 BTC
├─ Cost basis: $50,001.50 total ($50,015.03 per BTC)
│  └─ Inherited: $50,000 (from source)
│  └─ Platform fee: $1.50
└─ New lot created: #890
```

### Calculation Summary

```
Cost Basis Calculation Summary
══════════════════════════════════════════════════════════
Period: 2024-01-01 to 2024-12-31
Method: FIFO
Jurisdiction: United States (IRS)

Transactions Processed: 1,234 total
├─ Acquisitions: 567
├─ Disposals: 445
├─ Transfers: 222 (non-taxable)
└─ Skipped (intermediate): 35

Transfers: 222 events
├─ Simple (1:1): 180
├─ Multi-hop: 42
└─ Fee breakdown:
   ├─ Crypto fees (taxable): 156 disposals
   ├─ External fees (to cost basis): 89 items
   └─ Third-asset fees (taxable): 23 disposals

Lots Created: 567
├─ From purchases: 532
├─ From transfers: 222
└─ Remaining open: 145

Disposals: 445 total
├─ Sales/trades: 266
├─ Transfer fees (crypto): 156
├─ Transfer fees (third-asset): 23
└─ Price status:
   ├─ Available: 440
   ├─ Manual entry: 3
   └─ Missing: 2 ⚠️  BLOCKED CALCULATION

Tax Events:
├─ Capital gains: $45,230.50 (short-term)
├─ Capital gains: $12,450.00 (long-term)
└─ Capital losses: ($3,200.00)

⚠️  Action Required: 2 fee disposals missing prices
Run: pnpm run dev cost-basis report --missing-prices
```

---

## Consequences

### Positive

✅ **Tax Accuracy**: Transfers no longer create phantom capital gains/losses
✅ **Cost Basis Preservation**: Original cost basis flows correctly through transfers, prorated by amount received
✅ **Complex Fee Support**:

- Crypto fees (same asset) properly treated as taxable disposals
- External fees (fiat) properly increase cost basis
- Third-asset fees (e.g., BNB) create separate taxable disposals
- Hybrid scenarios (multiple simultaneous fees) fully supported
  ✅ **Explicit State Machine**: Processing state tracked, prevents misuse of incomplete data
  ✅ **Link Quality Assurance**: 95% confidence threshold with manual review workflow
  ✅ **Price Data Validation**: Blocks calculation if prices missing, provides clear resolution steps
  ✅ **Complete Audit Trail**: Transfer events, lot transfers, and fee disposals tracked separately
  ✅ **Regulatory Compliance**: Aligns with tax treatment in US, CA, UK, EU
  ✅ **Multi-hop Support**: Chains collapse to final destination with intermediate transactions excluded
  ✅ **Clean Architecture**: Transfer detection decoupled from cost basis calculation
  ✅ **Reuses Infrastructure**: Leverages existing LinkGraphBuilder and Union-Find algorithm
  ✅ **Deterministic Ordering**: Transaction ID tiebreaker ensures reproducible calculations

### Neutral

⚠️ **Requires High-Confidence Links**: Only confirmed links ≥95% confidence used for cost basis
⚠️ **Database Migration**: Three new tables and schema updates required
⚠️ **Test Coverage**: Comprehensive tests needed for complex fee scenarios
⚠️ **Processing Order**: Source transactions MUST be processed before targets (enforced at runtime with clear errors)
⚠️ **Manual Intervention**: Users may need to review suggested links and add missing prices

### Negative

❌ **Additional Storage**: Three new tables (transfer_events, lot_transfers, third_asset_fee_disposals)
❌ **Processing Overhead**: Transfer graph analysis adds preprocessing step
❌ **Link Quality Dependency**: Incorrect links cause incorrect cost basis (mitigated by 95% threshold and manual review)
❌ **Price Data Dependency**: Calculation blocks if fee disposal prices missing (provides clear resolution via manual entry)
❌ **Increased Complexity**: Fee analysis supports multiple simultaneous fee types
❌ **State Mutation**: TransferEvent objects are mutated during Stage 2 (but state is explicitly tracked)

---

## Implementation Plan

### Phase 1: Schema & Infrastructure (Week 1)

1. Update `TransferEvent` schema with `processingState` and `fees[]`
2. Create `ThirdAssetFeeDisposal` schema
3. Add `priceStatus` to `LotDisposal` schema
4. Update database migration with new tables and fields
5. Add Zod validation for state transitions and fee types

### Phase 2: Transfer Graph Analyzer (Week 2)

1. Update `TransferGraphAnalyzer.analyzeFees()` to return array
2. Implement third-asset fee detection logic
3. Support hybrid fee scenarios (crypto + external + third-asset)
4. Add unit tests for all fee type combinations
5. Add unit tests for state validation

### Phase 3: Lot Matching Updates (Week 2-3)

1. Update `handleTransferOut()` for explicit state transitions
2. Implement `createThirdAssetFeeDisposal()`
3. Update `createLotFromTransfer()` for state validation
4. Add price validation logic
5. Add tests for complex fee processing
6. Add tests for state transition violations

### Phase 4: Price Management (Week 3)

1. Implement `prices add` CLI command
2. Implement `prices import` CLI command (CSV batch)
3. Add price status tracking to repository
4. Implement missing price validation in calculator
5. Add user-facing error messages with resolution steps
6. Add tests for price blocking and manual entry

### Phase 5: Link Quality (Week 4)

1. Update linking service to enforce 95% threshold
2. Implement `links review` CLI command
3. Implement `links confirm` CLI command
4. Implement `links reject` CLI command
5. Add link validation checks
6. Add audit trail logging

### Phase 6: Integration & Testing (Week 4-5)

1. Integrate all components into `CostBasisCalculator`
2. Add comprehensive integration tests:
   - Simple transfer with crypto fee
   - Simple transfer with external fee
   - Simple transfer with third-asset fee (BNB)
   - Hybrid scenario (all three fee types)
   - Multi-hop transfer with fees
   - State transition violations
   - Missing price blocking
   - Link quality validation
3. Test FIFO/LIFO strategies with transfers
4. Test timestamp tiebreaking
5. Performance testing with large datasets

### Phase 7: Reporting & Documentation (Week 5)

1. Update calculation summary to show transfer breakdown
2. Implement detailed transfer chain view
3. Add missing price report
4. Update CLI help text
5. Write user documentation for link review workflow
6. Write user documentation for manual price entry
7. Update ADR based on implementation findings

---

## Related Issues

- Issue #101 - Transaction linking: propagate cost basis from exchanges to blockchain wallets
- Issue #96 - Implement accounting package for cost basis calculations
- Issue #99 - Implement post-processing price enrichment service

---

## References

- [IRS Virtual Currency Guidance](https://www.irs.gov/businesses/small-businesses-self-employed/virtual-currencies)
- [CRA Cryptocurrency Guide](https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/compliance/digital-currency/cryptocurrency-guide.html)
- [HMRC Cryptoassets Manual](https://www.gov.uk/hmrc-internal-manuals/cryptoassets-manual)
- Transaction Linking README: `packages/accounting/src/linking/README.md`
- Link Graph Builder: `packages/accounting/src/price-enrichment/link-graph-builder.ts`
- Price Enrichment Service: `packages/accounting/src/price-enrichment/price-enrichment-service.ts`

---

## Appendix: Fee Scenarios & Examples

### Scenario 1: Simple Transfer with Crypto Fee

```
Withdraw 1 BTC from Kraken to wallet
- Network fee: 0.0005 BTC (deducted from amount)
- Platform fee: None

Result:
- Transfer: 0.9995 BTC (non-taxable)
- Disposal: 0.0005 BTC @ $60,000 = $30 proceeds (taxable)
- New lot: 0.9995 BTC with inherited cost basis
```

### Scenario 2: Hybrid Fee (Crypto + Fiat)

```
Withdraw 1 BTC from Kraken to wallet
- Network fee: 0.0005 BTC (deducted from amount)
- Platform fee: $1.50 (charged to credit card)

Result:
- Transfer: 0.9995 BTC (non-taxable)
- Disposal: 0.0005 BTC @ $60,000 = $30 proceeds (taxable)
- New lot: 0.9995 BTC with cost basis = $50,000 + $1.50 = $50,001.50
```

### Scenario 3: Third-Asset Fee

```
Withdraw 1 BTC from Binance to wallet
- Network fee: None (Binance covers it)
- Platform fee: 0.01 BNB (deducted from BNB balance)

Result:
- Transfer: 1 BTC (non-taxable)
- Disposal: 0.01 BNB @ $550 = $5.50 proceeds (taxable)
- New lot: 1 BTC with inherited cost basis
```

### Scenario 4: All Three Fee Types

```
Withdraw 1 BTC from hybrid exchange to wallet
- Network fee: 0.0005 BTC (deducted from amount)
- Platform fee: $1.50 (fiat)
- Priority fee: 0.01 BNB (faster withdrawal)

Result:
- Transfer: 0.9995 BTC (non-taxable)
- Disposal: 0.0005 BTC @ $60,000 = $30 proceeds (taxable)
- Disposal: 0.01 BNB @ $550 = $5.50 proceeds (taxable)
- New lot: 0.9995 BTC with cost basis = $50,000 + $1.50 = $50,001.50
```

### Scenario 5: Multi-Hop with Fees

```
Transfer from Kraken → Blockchain → Personal Wallet
Hop 1: Kraken withdrawal
- Network fee: 0.0005 BTC
- Platform fee: $1.50

Hop 2: Blockchain to wallet (no additional fees)

Result:
- Transfer: 0.9995 BTC (non-taxable, collapsed to final destination)
- Disposal: 0.0005 BTC @ $60,000 = $30 proceeds (taxable)
- New lot: 0.9995 BTC with cost basis = $50,000 + $1.50 = $50,001.50
- Intermediate transaction (blockchain) skipped in accounting
```
