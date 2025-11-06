# Implementation Plan: ADR-005 Fee Semantics Normalization

**Status:** Ready for Implementation
**ADR:** [ADR-005: Fee Semantics Normalization](../adr/005-fee-semantics-normalization.md)
**Created:** 2025-11-04

---

## Executive Summary

This plan implements fee semantics normalization to distinguish:

1. **On-chain fees** (gas, miner tips) - may or may not reduce transfer amounts depending on blockchain model
2. **Platform/off-chain fees** charged separately from transfers
3. **Cross-asset fees** paid in different currencies

The implementation uses gross/net movement amounts and explicit fee metadata (`scope`, `settlement`) to make transfer reconciliation deterministic and eliminate "Transfer amount mismatch" errors.

**Critical Note:** Different blockchain architectures handle fees differently:

- **UTXO chains (Bitcoin):** Fees implicit in amounts → `netAmount = grossAmount - fee`
- **Account-based chains (Ethereum/Solana/etc):** Fees paid separately → `netAmount = grossAmount`

---

## Core Design Decisions

### Fee Container Structure

Use a simple array structure - naturally supports multiple fees of the same scope without schema changes.

```typescript
fees: FeeMovement[]  // Array of all fees, each tagged with scope
```

**Advantages:**

- Naturally handles multiple fees of same scope (DEX multi-hop, compound transactions)
- No redundancy between slot name and scope field
- Consistent with movements pattern (both are arrays)
- More flexible for future fee types

### Movement Amount Fields

Per ADR-005:

- `grossAmount`: Amount venue debited/credited (what user initiated) - REQUIRED
- `netAmount`: Amount transmitted/received on-chain (after on-chain fees, if applicable) - OPTIONAL, defaults to grossAmount
- Legacy `amount`: DEPRECATED - kept for backward compatibility only

**When netAmount differs from grossAmount:**

| Blockchain Type         | netAmount Calculation | Example                                           |
| ----------------------- | --------------------- | ------------------------------------------------- |
| **UTXO (Bitcoin)**      | `grossAmount - fee`   | Send 0.5 BTC + 0.0004 fee → gross=0.5, net=0.4996 |
| **Account (Ethereum)**  | `grossAmount`         | Send 2 ETH + 0.0001 gas → gross=2.0, net=2.0      |
| **Account (Solana)**    | `grossAmount`         | Send 2 SOL + 0.000005 → gross=2.0, net=2.0        |
| **Platform (Coinbase)** | `grossAmount - fee`   | Withdraw 18 UNI - 0.164 → gross=18, net=17.836    |

---

## Phase 1: Schema & Type Updates

### 1.1 Core Schema Changes

**File:** `packages/core/src/schemas/universal-transaction.ts`

```typescript
import { z } from 'zod';

// Enhanced AssetMovement with gross/net semantics
export const AssetMovementSchema = z.object({
  asset: z.string().min(1, 'Asset must not be empty'),

  // Amount fields
  grossAmount: DecimalSchema,          // Amount venue debited/credited (REQUIRED)
  netAmount: DecimalSchema.optional(), // Amount on-chain (repository defaults to grossAmount during save)

  // Deprecated fields
  amount: DecimalSchema.optional(),    // DEPRECATED: Use grossAmount instead. Kept for query compatibility only.

  // Price metadata
  priceAtTxTime: PriceAtTxTimeSchema.optional(),
}).refine(
  (data) => {
    // Validation: netAmount cannot exceed grossAmount
    if (data.netAmount && data.grossAmount) {
      return parseDecimal(data.netAmount).lte(parseDecimal(data.grossAmount));
    }
    return true;
  },
  { message: 'netAmount cannot exceed grossAmount' }
);

// Fee-specific schema (distinct from AssetMovement)
export const FeeMovementSchema = z.object({
  asset: z.string().min(1, 'Asset must not be empty'),
  amount: DecimalSchema,

  // Fee semantics (required)
  scope: z.enum(['network', 'platform', 'spread', 'tax', 'other']),
  settlement: z.enum(['on-chain', 'balance', 'external']),

  // Price metadata
  priceAtTxTime: PriceAtTxTimeSchema.optional(),
});

// Update UniversalTransactionSchema fees structure
fees: z.array(FeeMovementSchema).default([]),
```

**Validation Rules (enforced in schema):**

- `netAmount` must never exceed `grossAmount`
- `scope` and `settlement` are required on every fee entry
- All observed combinations from real venues must pass validation (no hard-coded ban on `scope='platform'` + `settlement='on-chain'`)

> **Actionable:** Update the current schema to drop the `settlement='on-chain'` + `scope='platform'` guard and add regression tests for venues like Coinbase that report platform fees withheld from the on-chain send.

### Fee Semantics Matrix

**Understanding Scope vs Settlement:**

- **`scope`** = WHO receives the fee (network miners vs platform vs government)
- **`settlement`** = HOW it's paid (carved from transfer vs separate ledger entry)

**Valid Combinations & Their Meanings:**

| Scope      | Settlement | Meaning                                            | Example                       | Disposal Proceeds          | Acquisition Cost  | Balance Impact           |
| ---------- | ---------- | -------------------------------------------------- | ----------------------------- | -------------------------- | ----------------- | ------------------------ |
| `network`  | `on-chain` | Miner fee carved from inputs (UTXO chains)         | Bitcoin miner fee             | ✅ Reduces (use netAmount) | ✅ Included       | Deducted via grossAmount |
| `network`  | `balance`  | Gas paid separately from balance (account-based)   | Ethereum/Solana/Cosmos gas    | ❌ Does NOT reduce         | ✅ Included       | Separate debit           |
| `platform` | `on-chain` | Exchange fee carved from transfer before broadcast | Coinbase withdrawal fee (UNI) | ✅ Reduces (use netAmount) | ✅ Included       | Deducted via netAmount   |
| `platform` | `balance`  | Exchange fee charged as separate ledger entry      | Kraken withdrawal fee (BTC)   | ❌ Does NOT reduce         | ✅ Included       | Separate debit           |
| `tax`      | `balance`  | Withholding/levy charged separately                | FATCA withholding             | ❌ Does NOT reduce         | ✅ Included       | Separate debit           |
| `spread`   | `balance`  | Implicit price deviation (informational only)      | RFQ desk markup               | ❌ Not applicable          | ❌ Not applicable | No impact (derived)      |

**Decision Tree for Processors:**

```
When processing a fee, ask:

1. BLOCKCHAIN TYPE:
   ├─ UTXO Chain (Bitcoin)?
   │   └─ Miner fee is carved from inputs
   │       → settlement='on-chain', scope='network'
   │       → grossAmount = inputs - change (includes fee)
   │       → netAmount = actual amount transferred
   │
   ├─ Account-Based Chain (Ethereum, Solana, Cosmos, Substrate)?
   │   └─ Gas is paid separately from account balance
   │       → settlement='balance', scope='network'
   │       → grossAmount = netAmount = amount recipient receives
   │       → Fee recorded separately
   │
   └─ Exchange/Custodial Fee?
       ├─ Fee carved from transfer before blockchain broadcast?
       │   → settlement='on-chain', scope='platform'
       │   → netAmount = grossAmount - fee.amount
       │
       └─ Fee charged as separate ledger entry?
           → settlement='balance'
           ├─ Exchange revenue? → scope='platform'
           ├─ Tax/regulatory? → scope='tax'
           └─ Other? → scope='other'
```

**Downstream Logic:**

- **For Disposal Proceeds Calculation** (lot-matcher-utils.ts:calculateFeesInFiat):
  - Include fees where `settlement='on-chain'` (regardless of scope)
  - Exclude fees where `settlement='balance'`
  - Rationale: On-chain fees reduce what you actually received; balance fees are separate costs

- **For Acquisition Cost Basis** (lot-matcher-utils.ts:calculateFeesInFiat):
  - Include ALL fees (all settlements, all scopes except 'spread')
  - Rationale: Any fee paid to acquire an asset increases your cost basis

- **For Balance Calculation** (balance-calculator.ts):
  - Deduct `outflow.grossAmount` for all movements
  - For fees with `settlement='on-chain'` (UTXO chains): Skip fee subtraction (already in grossAmount)
  - For fees with `settlement='balance'` (account-based chains, exchanges): Subtract fee separately
  - This ensures accurate balance tracking across UTXO and account-based blockchain architectures

### 1.2 Database Schema Updates

**File:** `packages/platform/data/src/schema/database-schema.ts`

Update interface to use single `fees` column:

```typescript
export interface TransactionsTable {
  // ... existing fields ...

  // Structured movements (JSON: Array<AssetMovement>)
  // Each movement: { asset, grossAmount, netAmount?, priceAtTxTime? }
  movements_inflows: JSONString | null;
  movements_outflows: JSONString | null;

  // Structured fees (JSON: Array<FeeMovement>)
  // Each fee: { asset, amount, scope, settlement, priceAtTxTime? }
  fees: JSONString | null;

  // DEPRECATED: Remove these columns in migration
  // fees_network: JSONString | null;
  // fees_platform: JSONString | null;
  // fees_total: JSONString | null;

  // ... rest of fields ...
}
```

**File:** `packages/platform/data/src/migrations/001_initial_schema.ts`

Update the CREATE TABLE statement to use single `fees` column:

```sql
CREATE TABLE transactions (
  -- ... existing columns ...

  movements_inflows TEXT,
  movements_outflows TEXT,

  fees TEXT, -- Stores fees array: Array<FeeMovement>

  -- Remove old columns (replaced by single fees column):
  -- fees_network TEXT,
  -- fees_platform TEXT,
  -- fees_total TEXT,

  -- ... rest of columns ...
);
```

**Note:** Database is dropped during development, so no migration needed. Clean break - no backward compatibility.

### 1.3 Type Exports

**File:** `packages/core/src/types/index.ts`

```typescript
import type { z } from 'zod';
import { AssetMovementSchema, FeeMovementSchema } from '../schemas/universal-transaction.ts';

export type AssetMovement = z.infer<typeof AssetMovementSchema>;
export type FeeMovement = z.infer<typeof FeeMovementSchema>;
```

---

## Phase 2: Repository Layer Updates

### 2.1 Movement/Fee Normalization Utilities

**File:** `packages/platform/data/src/repositories/transaction-repository.ts`

Add helper functions at module level:

```typescript
/**
 * Validate and normalize movement to ensure all required fields exist
 *
 * Following "clean breaks only" principle - no fallbacks to legacy fields.
 * Processors MUST emit grossAmount in new format.
 */
function normalizeMovement(movement: AssetMovement): Result<AssetMovement, Error> {
  // Require grossAmount - fail fast if processor didn't update
  if (!movement.grossAmount) {
    return err(
      new Error(
        `Movement missing required field 'grossAmount'. ` +
          `Processors must be updated to emit new fee semantics. ` +
          `Asset: ${movement.asset}`
      )
    );
  }

  // Default: netAmount = grossAmount (valid for most transactions with no on-chain fees)
  const netAmount = movement.netAmount ?? movement.grossAmount;

  return ok({
    ...movement,
    grossAmount: movement.grossAmount,
    netAmount,
    // NOTE: 'amount' field kept in schema temporarily to avoid build errors during refactoring
    // but is NOT populated or used - all code must use grossAmount/netAmount
  });
}
```

### 2.2 Update saveTransaction()

**File:** `packages/platform/data/src/repositories/transaction-repository.ts` (lines 29-135)

```typescript
async saveTransaction(transaction: UniversalTransaction, dataSourceId: number) {
  try {
    // ... existing metadata validation ...

    // Normalize movements: ensure gross/net fields exist
    const normalizedInflows: AssetMovement[] = [];
    for (const inflow of transaction.movements.inflows ?? []) {
      const result = normalizeMovement(inflow);
      if (result.isErr()) {
        return err(result.error);
      }
      normalizedInflows.push(result.value);
    }

    const normalizedOutflows: AssetMovement[] = [];
    for (const outflow of transaction.movements.outflows ?? []) {
      const result = normalizeMovement(outflow);
      if (result.isErr()) {
        return err(result.error);
      }
      normalizedOutflows.push(result.value);
    }


    const rawDataJson = this.serializeToJson(transaction) ?? '{}';

    // Serialize fees array
    const feesJson = transaction.fees && transaction.fees.length > 0
      ? this.serializeToJson(transaction.fees)
      : undefined;

    const result = await this.db
      .insertInto('transactions')
      .values({
        // ... existing fields ...

        // Serialize normalized movements
        movements_inflows: normalizedInflows.length > 0
          ? this.serializeToJson(normalizedInflows)
          : undefined,
        movements_outflows: normalizedOutflows.length > 0
          ? this.serializeToJson(normalizedOutflows)
          : undefined,

        // Serialize fees array
        fees: feesJson,

        // ... rest ...
      })
      // ... rest of upsert logic ...
  }
}
```

### 2.3 Update Parsing Methods

**File:** `packages/platform/data/src/repositories/transaction-repository.ts`

Replace existing `parseMovements()` and `parseFee()` methods:

```typescript
/**
 * Parse movements from JSON
 */
private parseMovements(jsonString: string | null): Result<AssetMovement[], Error> {
  if (!jsonString) {
    return ok([]);
  }

  try {
    const parsed: unknown = JSON.parse(jsonString);
    const result = z.array(AssetMovementSchema).safeParse(parsed);

    if (!result.success) {
      return err(new Error(`Failed to parse movements JSON: ${result.error.message}`));
    }

    // Normalize and validate all movements
    const normalizedMovements: AssetMovement[] = [];
    for (const movement of result.data) {
      const normalizeResult = normalizeMovement(movement);
      if (normalizeResult.isErr()) {
        return err(normalizeResult.error);
      }
      normalizedMovements.push(normalizeResult.value);
    }

    return ok(normalizedMovements);
  } catch (error) {
    return err(new Error(`Failed to parse movements JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Parse fees array from JSON column
 *
 * FeeMovementSchema validation ensures:
 * - Required fields (scope, settlement) are present
 * - Amounts parse to Decimals
 * - No assumption about which combinations are "invalid"—real venue patterns pass through and can be flagged downstream if needed
 */
private parseFees(jsonString: string | null): Result<FeeMovement[], Error> {
  if (!jsonString) {
    return ok([]);
  }

  try {
    const parsed: unknown = JSON.parse(jsonString);
    const result = z.array(FeeMovementSchema).safeParse(parsed);

    if (!result.success) {
      return err(new Error(`Failed to parse fees JSON: ${result.error.message}`));
    }

    return ok(result.data);
  } catch (error) {
    return err(new Error(`Failed to parse fees JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}
```

Update `toUniversalTransaction()` to use `parseFees()`:

```typescript
private toUniversalTransaction(row: Selectable<TransactionsTable>): Result<UniversalTransaction, Error> {
  // ... existing parsing ...

  // Parse movements
  const inflowsResult = this.parseMovements(row.movements_inflows as string | null);
  if (inflowsResult.isErr()) {
    return err(inflowsResult.error);
  }

  const outflowsResult = this.parseMovements(row.movements_outflows as string | null);
  if (outflowsResult.isErr()) {
    return err(outflowsResult.error);
  }

  // Parse fees array
  const feesResult = this.parseFees(row.fees as string | null);
  if (feesResult.isErr()) {
    return err(feesResult.error);
  }

  // Build UniversalTransaction
  const transaction: UniversalTransaction = {
    // ... existing fields ...
    movements: {
      inflows: inflowsResult.value,
      outflows: outflowsResult.value,
    },
    fees: feesResult.value,
    // ... rest ...
  };

  return ok(transaction);
}
```

---

## Phase 3: Linking & Transfer Reconciliation

### 3.1 Update Candidate Conversion

**File:** `packages/accounting/src/linking/matching-utils.ts` (lines 375-415)

Update `convertToCandidates()` to use `netAmount`:

```typescript
/**
 * Convert stored transactions to transaction candidates for matching.
 * Uses netAmount (on-chain amount) for transfer matching.
 */
export function convertToCandidates(transactions: UniversalTransaction[]): TransactionCandidate[] {
  const candidates: TransactionCandidate[] = [];

  for (const tx of transactions) {
    // Create candidates for all inflows
    for (const inflow of tx.movements.inflows ?? []) {
      const candidate: TransactionCandidate = {
        id: tx.id,
        externalId: tx.externalId,
        sourceId: tx.source,
        sourceType: tx.blockchain ? 'blockchain' : 'exchange',
        timestamp: new Date(tx.datetime),
        asset: inflow.asset,

        // CHANGED: Use netAmount for matching (what actually went on-chain)
        amount: inflow.netAmount ?? inflow.grossAmount ?? inflow.amount,

        direction: 'in',
        fromAddress: tx.from,
        toAddress: tx.to,
      };
      candidates.push(candidate);
    }

    // Create candidates for all outflows
    for (const outflow of tx.movements.outflows ?? []) {
      const candidate: TransactionCandidate = {
        id: tx.id,
        externalId: tx.externalId,
        sourceId: tx.source,
        sourceType: tx.blockchain ? 'blockchain' : 'exchange',
        timestamp: new Date(tx.datetime),
        asset: outflow.asset,

        // CHANGED: Use netAmount for matching (what actually went on-chain)
        amount: outflow.netAmount ?? outflow.grossAmount ?? outflow.amount,

        direction: 'out',
        fromAddress: tx.from,
        toAddress: tx.to,
      };
      candidates.push(candidate);
    }
  }

  return candidates;
}
```

**Rationale:**

- Transfer matching compares what actually went on-chain (`netAmount`)
- Kraken BTC withdrawal: `grossAmount=0.00648264`, `netAmount=0.00648264` (platform fee separate)
- Ethereum with gas: `grossAmount=1.5`, `netAmount=1.499` (gas deducted on-chain)
- Both source and target use consistent `netAmount` for comparison

**No other changes needed** in linking utilities - existing variance/similarity functions work unchanged.

---

## Phase 4: Lot Matcher Updates

### 4.1 Settlement-Aware Fee Calculation

**File:** `packages/accounting/src/services/lot-matcher.ts` (lines 368-468)

Replace `calculateFeesInFiat()` method:

```typescript
/**
 * Calculate the fiat value of fees attributable to a specific asset movement
 *
 * For INFLOWS (acquisitions):
 *   - Include ALL fees in cost basis (platform + network)
 *   - Fees increase what you paid to acquire the asset
 *
 * For OUTFLOWS (disposals):
 *   - Include only ON-CHAIN fees (settlement='on-chain')
 *   - These fees reduce your proceeds
 *   - Platform fees charged separately don't affect disposal proceeds
 *
 * @param transaction - Transaction containing fees
 * @param targetMovement - The specific movement to calculate fees for
 * @param isInflow - True for acquisitions, false for disposals
 * @returns Fee amount in fiat attributable to this movement
 */
private calculateFeesInFiat(
  transaction: UniversalTransaction,
  targetMovement: AssetMovement,
  isInflow: boolean
): Result<Decimal, Error> {
  // Filter fees based on context
  const relevantFees = isInflow
    ? transaction.fees // Acquisitions: all fees increase cost basis
    : transaction.fees.filter(fee => fee.settlement === 'on-chain'); // Disposals: only on-chain fees reduce proceeds

  if (relevantFees.length === 0) {
    return ok(new Decimal(0));
  }

  // Calculate total fee value in fiat
  let totalFeeValue = new Decimal(0);
  for (const fee of relevantFees) {
    if (fee.priceAtTxTime) {
      const feeValue = parseDecimal(fee.amount).times(fee.priceAtTxTime.price.amount);
      totalFeeValue = totalFeeValue.plus(feeValue);
    } else {
      // Fallback for fees without prices
      const feeCurrency = Currency.create(fee.asset);
      if (feeCurrency.isFiat() && targetMovement.priceAtTxTime) {
        const targetPriceCurrency = targetMovement.priceAtTxTime.price.currency;
        if (feeCurrency.equals(targetPriceCurrency)) {
          totalFeeValue = totalFeeValue.plus(parseDecimal(fee.amount));
        } else {
          return err(
            new Error(
              `Fee in ${fee.asset} cannot be converted to ${targetPriceCurrency.toString()} without FX rate. ` +
              `Transaction: ${transaction.id}, Fee: ${fee.amount}`
            )
          );
        }
      } else {
        return err(
          new Error(
            `Fee in ${fee.asset} missing priceAtTxTime. ` +
            `Transaction: ${transaction.id}, Fee: ${fee.amount}`
          )
        );
      }
    }
  }

  // Calculate proportional allocation (unchanged from existing logic)
  const inflows = transaction.movements.inflows || [];
  const outflows = transaction.movements.outflows || [];
  const allMovements = [...inflows, ...outflows];
  const nonFiatMovements = allMovements.filter((m) => {
    try {
      return !Currency.create(m.asset).isFiat();
    } catch {
      return true;
    }
  });

  // Use grossAmount for acquisitions (what you paid), netAmount for disposals (what you received)
  const targetAmount = isInflow ? targetMovement.grossAmount : targetMovement.netAmount;
  const targetMovementValue = targetMovement.priceAtTxTime
    ? parseDecimal(targetAmount).times(targetMovement.priceAtTxTime.price.amount)
    : new Decimal(0);

  let totalMovementValue = new Decimal(0);
  for (const movement of nonFiatMovements) {
    if (movement.priceAtTxTime) {
      // Use grossAmount for inflows, netAmount for outflows in proportional allocation
      const movementAmount = inflows.includes(movement) ? movement.grossAmount : movement.netAmount;
      const movementValue = parseDecimal(movementAmount).times(movement.priceAtTxTime.price.amount);
      totalMovementValue = totalMovementValue.plus(movementValue);
    }
  }

  if (totalMovementValue.isZero()) {
    if (nonFiatMovements.length === 0) {
      return ok(new Decimal(0));
    }

    const targetAmountForComparison = isInflow ? targetMovement.grossAmount : targetMovement.netAmount;
    const isTargetInNonFiat = nonFiatMovements.some((m) => {
      const mAmount = inflows.includes(m) ? m.grossAmount : m.netAmount;
      return m.asset === targetMovement.asset && parseDecimal(mAmount).equals(parseDecimal(targetAmountForComparison));
    });

    if (!isTargetInNonFiat) {
      return ok(new Decimal(0));
    }

    return ok(totalFeeValue.dividedBy(nonFiatMovements.length));
  }

  // Allocate proportionally
  return ok(totalFeeValue.times(targetMovementValue).dividedBy(totalMovementValue));
}
```

### 4.2 Update Call Sites

**File:** `packages/accounting/src/services/lot-matcher.ts`

Update method signatures and calls:

```typescript
// In createLotFromInflow() - around line 186
const feeResult = this.calculateFeesInFiat(transaction, inflow, true); // isInflow=true

// In matchOutflowToLots() - around line 232
const feeResult = this.calculateFeesInFiat(transaction, outflow, false); // isInflow=false
```

---

## Phase 5: Processor Updates

### 5.1 Interpretation Strategy Interface

**File:** `packages/ingestion/src/infrastructure/exchanges/shared/strategies/interpretation.ts`

Update `LedgerEntryInterpretation` interface:

```typescript
export interface LedgerEntryInterpretation {
  inflows: Array<{
    asset: string;
    amount: string;
    grossAmount?: string; // Defaults to amount
    netAmount?: string; // Defaults to grossAmount
  }>;

  outflows: Array<{
    asset: string;
    amount: string;
    grossAmount?: string; // Defaults to amount
    netAmount?: string; // Defaults to grossAmount
  }>;

  fees: Array<{
    asset: string;
    amount: string;
    scope: 'network' | 'platform' | 'spread' | 'tax' | 'other';
    settlement: 'on-chain' | 'balance' | 'external';
  }>;
}
```

### 5.2 Update Standard Amounts Strategy

**File:** `packages/ingestion/src/infrastructure/exchanges/shared/strategies/interpretation.ts`

```typescript
/**
 * Standard amount semantics (most exchanges like Kraken, KuCoin).
 *
 * - entry.normalized.amount is NET movement (what actually moved)
 * - entry.normalized.fee is SEPARATE deduction
 * - Balance change = amount - fee (for outflows)
 */
export const standardAmounts: InterpretationStrategy = {
  interpret(entry: RawTransactionWithMetadata, _group: RawTransactionWithMetadata[]): LedgerEntryInterpretation {
    const amount = parseDecimal(entry.normalized.amount);
    const absAmount = amount.abs();
    const asset = entry.normalized.asset;

    const feeCost =
      entry.normalized.fee && !parseDecimal(entry.normalized.fee).isZero()
        ? parseDecimal(entry.normalized.fee)
        : undefined;
    const feeCurrency = entry.normalized.feeCurrency || asset;

    return {
      inflows: amount.isPositive()
        ? [
            {
              asset,
              amount: absAmount.toFixed(),
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees, net = gross
            },
          ]
        : [],

      outflows: amount.isNegative()
        ? [
            {
              asset,
              amount: absAmount.toFixed(),
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees, net = gross
            },
          ]
        : [],

      fees: feeCost
        ? [
            {
              asset: feeCurrency,
              amount: feeCost.toFixed(),
              scope: 'platform', // Standard exchange fees are platform revenue
              settlement: 'balance', // Charged from separate balance entry
            },
          ]
        : [],
    };
  },
};
```

Update `coinbaseGrossAmounts` similarly to add `scope` and `settlement` fields to fee objects.

### 5.3 Update CorrelatingExchangeProcessor

**File:** `packages/ingestion/src/infrastructure/exchanges/shared/correlating-exchange-processor.ts` (lines 72-108)

```typescript
const universalTransaction: UniversalTransaction = {
  id: 0,
  externalId: primaryEntry.normalized.id,
  datetime: new Date(fundFlow.timestamp).toISOString(),
  timestamp: fundFlow.timestamp,
  source: this.sourceId,
  status: primaryEntry.normalized.status,

  movements: {
    inflows: fundFlow.inflows.map((inflow) => {
      const gross = parseDecimal(inflow.grossAmount);
      const net = parseDecimal(inflow.netAmount ?? inflow.grossAmount);

      return {
        asset: inflow.asset,
        grossAmount: gross,
        netAmount: net,
      };
    }),

    outflows: fundFlow.outflows.map((outflow) => {
      const gross = parseDecimal(outflow.grossAmount);
      const net = parseDecimal(outflow.netAmount ?? outflow.grossAmount);

      return {
        asset: outflow.asset,
        grossAmount: gross,
        netAmount: net,
      };
    }),
  },

  fees: fundFlow.fees.map((fee) => ({
    asset: fee.asset,
    amount: parseDecimal(fee.amount),
    scope: fee.scope,
    settlement: fee.settlement,
  })),

  operation: classification.operation,
  note: classification.note,

  metadata: {
    correlatedEntryCount: fundFlow.entryCount,
    correlationId: fundFlow.correlationId,
    ledgerEntries: entryGroup.map((e) => e.normalized.id),
  },
};
```

### 5.4 Blockchain Processor Examples

#### Bitcoin Processor

**File:** `packages/ingestion/src/infrastructure/blockchains/bitcoin/processor.ts`

```typescript
// Bitcoin transaction with miner fee
const inputAmount = /* sum of inputs */;
const outputAmount = /* sum of outputs */;
const minerFee = inputAmount.minus(outputAmount);

const universalTransaction: UniversalTransaction = {
  // ... other fields ...

  movements: {
    outflows: [{
      asset: 'BTC',
      grossAmount: outputAmount,
      netAmount: outputAmount,     // Full output received (fee paid from inputs)
    }],
  },

  fees: [{
    asset: 'BTC',
    amount: minerFee,
    scope: 'network',
    settlement: 'on-chain',      // Paid to miners on-chain
  }],
};
```

#### Ethereum Processor

**File:** `packages/ingestion/src/infrastructure/blockchains/evm/processor.ts`

```typescript
// ETH transfer with gas paid separately (account-based chain)
const transferAmount = /* amount recipient receives */;
const gasUsed = /* actual gas cost */;

const universalTransaction: UniversalTransaction = {
  // ... other fields ...

  movements: {
    outflows: [{
      asset: 'ETH',
      grossAmount: transferAmount,     // Amount recipient receives
      netAmount: transferAmount,       // Same as gross for account-based chains
    }],
  },

  fees: [{
    asset: 'ETH',
    amount: gasUsed,
    scope: 'network',
    settlement: 'balance',           // Paid separately from account balance
  }],
};
```

### 5.5 Price Enrichment Service Updates

#### Update enrichFeePricesFromMovements()

**File:** `packages/accounting/src/price-enrichment/price-enrichment-utils.ts` (lines 424-486)

Replace the function to work with the new fee array structure:

```typescript
/**
 * Enrich fee movements with prices from regular movements
 *
 * Since fees occur at the same timestamp as the transaction, we can copy prices
 * from inflows/outflows that share the same asset. For fiat fees that still don't
 * have prices after copying, stamp identity prices.
 *
 * @param transactions - Transactions to enrich
 * @returns Transactions with enriched fee prices
 */
export function enrichFeePricesFromMovements(transactions: UniversalTransaction[]): UniversalTransaction[] {
  return transactions.map((tx) => {
    const timestamp = new Date(tx.datetime).getTime();
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];
    const allMovements = [...inflows, ...outflows];

    // Build price lookup map by asset from movements
    const pricesByAsset = new Map<string, PriceAtTxTime>();
    for (const movement of allMovements) {
      if (movement.priceAtTxTime && !pricesByAsset.has(movement.asset)) {
        pricesByAsset.set(movement.asset, movement.priceAtTxTime);
      }
    }

    // CHANGED: Process fees array instead of fees.platform/fees.network
    const fees = tx.fees ?? [];
    if (fees.length === 0) {
      return tx; // No fees to enrich
    }

    let feesModified = false;
    const enrichedFees = fees.map((fee) => {
      // Skip if fee already has price
      if (fee.priceAtTxTime) {
        return fee;
      }

      // Try to copy price from movement with same asset
      const price = pricesByAsset.get(fee.asset);
      if (price) {
        feesModified = true;
        return { ...fee, priceAtTxTime: price };
      }

      return fee;
    });

    // Stamp identity prices on any remaining fiat fees
    const fiatFeeIdentityPrices = stampFiatIdentityPrices(enrichedFees, timestamp);

    if (fiatFeeIdentityPrices.length > 0) {
      const fiatPricesMap = new Map(fiatFeeIdentityPrices.map((p) => [p.asset, p.priceAtTxTime]));

      const finalFees = enrichedFees.map((fee) => {
        if (!fee.priceAtTxTime && fiatPricesMap.has(fee.asset)) {
          feesModified = true;
          return { ...fee, priceAtTxTime: fiatPricesMap.get(fee.asset)! };
        }
        return fee;
      });

      if (feesModified) {
        return { ...tx, fees: finalFees };
      }
    }

    // Return transaction with enriched fees if any changed
    if (feesModified) {
      return { ...tx, fees: enrichedFees };
    }

    return tx;
  });
}
```

**Key Changes:**

- Process `tx.fees` as an array instead of `tx.fees.platform` / `tx.fees.network`
- Map over all fees in the array
- Return updated `fees` array maintaining all fee properties (`scope`, `settlement`, etc.)
- Preserve fees that already have prices

---

## Phase 6: Testing

### 6.1 Unit Tests

**File:** `packages/accounting/src/services/__tests__/lot-matcher-fee-semantics.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { LotMatcher } from '../lot-matcher.ts';
import { parseDecimal } from '@exitbook/core';

describe('LotMatcher - Fee Semantics', () => {
  describe('Acquisition fees (inflows)', () => {
    it('should include all fees in cost basis for acquisitions', () => {
      const acquisition = createTestTransaction({
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
            },
          ],
        },
        fees: [
          {
            asset: 'USD',
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      });

      // Lot cost basis should include platform fee
      // Expected: (1.0 BTC * $50000) + $10 = $50010
    });
  });

  describe('Disposal fees (outflows)', () => {
    it('should include only on-chain fees in disposal proceeds', () => {
      const disposal = createTestTransaction({
        movements: {
          outflows: [
            {
              asset: 'ETH',
              amount: parseDecimal('1.0'),
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('0.999'), // After gas
            },
          ],
        },
        fees: [
          {
            asset: 'ETH',
            amount: parseDecimal('0.001'),
            scope: 'network',
            settlement: 'on-chain',
          },
          {
            asset: 'USD',
            amount: parseDecimal('5'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      });

      // Proceeds should subtract network fee only
      // Expected: (1.0 ETH * $3000) - (0.001 ETH * $3000) = $2997
      // Platform fee NOT subtracted (charged separately)
    });

    it('should exclude balance-settled fees from disposal proceeds (Kraken scenario)', () => {
      const disposal = createTestTransaction({
        movements: {
          outflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.00648264'),
              grossAmount: parseDecimal('0.00648264'),
              netAmount: parseDecimal('0.00648264'), // Net = gross
            },
          ],
        },
        fees: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.0004'),
            scope: 'platform',
            settlement: 'balance', // Separate ledger entry
          },
        ],
      });

      // Proceeds = 0.00648264 BTC * $50000 = $324.13
      // Fee NOT subtracted (charged from balance)
    });
  });

  describe('Transfer reconciliation', () => {
    it('should match transfers using netAmount', () => {
      const withdrawal = createTestTransaction({
        source: 'kraken',
        movements: {
          outflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('0.00648264'),
              netAmount: parseDecimal('0.00648264'),
            },
          ],
        },
        fees: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.0004'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      });

      const deposit = createTestTransaction({
        source: 'bitcoin',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('0.00648264'),
              netAmount: parseDecimal('0.00648264'),
            },
          ],
        },
        fees: [],
      });

      // Should match: both netAmounts = 0.00648264
    });
  });
});
```

### 6.2 Integration Tests

**File:** `packages/ingestion/src/infrastructure/exchanges/__tests__/fee-semantics.e2e.test.ts`

End-to-end scenarios:

1. Import Kraken withdrawal → process → verify fee semantics correct
2. Import Ethereum transfer → process → verify gas handling
3. Run linking → verify netAmount matching works
4. Run cost basis → verify fee allocation by settlement type

### 6.3 Test Fixtures

Create example data for each scenario:

- `__tests__/fixtures/kraken-withdrawal-platform-fee.json`
- `__tests__/fixtures/ethereum-gas-on-chain.json`
- `__tests__/fixtures/binance-cross-asset-fee.json`

---

## Phase 7: Rollout & Migration

### 7.1 Migration Strategy

Following the "clean breaks only" principle - no backward compatibility for legacy data:

- Database is dropped during development (no migration needed)
- Repository expects new schema format - legacy data will fail validation
- All data must be re-ingested after schema changes
- No runtime migration or conservative defaults

### 7.2 Re-ingestion Strategy

After updating processors, re-process historical data:

```bash
# List completed sessions
pnpm run dev sessions view --source kraken --status completed

# Re-process specific session
pnpm run dev process --session-id <id>
```

### 7.3 Validation CLI Command

Add audit command to check fee data quality:

```bash
pnpm run dev fees audit
```

Checks for:

- Transactions with fees missing scope/settlement
- Network fees in fiat currency (likely bugs)
- Platform fees with on-chain settlement (contradictions)
- Movements where netAmount > grossAmount (invalid)

---

## Phase 8: Documentation

### 8.1 Update CLAUDE.md

Add section explaining fee semantics:

```markdown
## Fee Semantics

All fees have two required dimensions:

### Scope (Why was this fee charged?)

- `network`: Paid to miners/validators (gas, miner fees)
- `platform`: Revenue for the venue (withdrawal fees, trading fees)
- `spread`: Implicit fee in price quote
- `tax`: Regulatory levy (GST, VAT, FATCA)
- `other`: Edge cases (penalties, staking commissions)

### Settlement (How was this fee paid?)

- `on-chain`: Deducted from the on-chain transfer (typical gas)
- `balance`: Separate ledger entry from venue balance (typical exchange fees)
- `external`: Paid outside tracked balances (ACH, credit card)

### Common Patterns

**Exchange withdrawal fees:**

- Scope: `platform` (exchange revenue)
- Settlement: `balance` (separate ledger debit)
- Example: Kraken BTC withdrawal fee (0.0004 BTC charged separately)

**Blockchain gas fees:**

- Scope: `network` (paid to miners)
- Settlement: `on-chain` (deducted during transfer)
- Example: Ethereum transaction gas

**Exchange trading fees:**

- Scope: `platform`
- Settlement: `balance`
```

### 8.2 Processor Implementation Guide

Create `docs/guides/implementing-fee-semantics.md` with:

- Decision tree for determining scope/settlement
- Examples for each exchange/blockchain
- Common pitfalls
- Validation checklist

---

## Implementation Order

Following vertical slice approach:

1. **Phase 1** (Schema) - Foundation
2. **Phase 2** (Repository) - Persistence layer
3. **Phase 5.5** (Price Enrichment) - Update fee enrichment for new array structure
4. **Phase 5.1-5.3** (Kraken processor) - One complete exchange
5. **Phase 6.1** (Unit tests for Kraken) - Validate approach
6. **Phase 3** (Linking) - Transfer matching with netAmount
7. **Phase 4** (Lot Matcher) - Cost basis with settlement awareness
8. **Phase 6.2-6.3** (Integration tests) - End-to-end validation
9. **Phase 5.4** (Blockchain processors) - Roll out to blockchains
10. **Phase 7** (Migration) - Production readiness
11. **Phase 8** (Documentation) - Knowledge capture

---

## Success Criteria

- ✅ Kraken BTC withdrawal processes without "Transfer amount mismatch" error
- ✅ Transfer linking uses `netAmount` consistently
- ✅ Lot matcher distinguishes on-chain vs balance fees correctly
- ✅ All tests pass including new fee semantics tests
- ✅ Fee array structure supports multiple fees of same scope
- ✅ Clear error messages for missing/invalid fee metadata
- ✅ Documentation explains scope/settlement decision tree

---

## Risk Mitigation

| Risk                   | Mitigation                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Breaking existing data | Database dropped during development, clean re-ingestion required                      |
| Processor complexity   | Shared interpretation strategies, clear decision tree documentation                   |
| Ambiguous settlement   | Canonical decision tree + regression tests covering all scope/settlement combinations |
| Incomplete rollout     | Audit command identifies transactions needing re-ingestion                            |
| Multiple fees handling | Array structure naturally supports any number of fees per scope                       |

---

## Open Questions for Implementation

1. **Cross-asset fee linking:** When BTC withdrawal has BNB fee, record fee only or create BNB movement?
   - **Recommendation:** Record fee only; if exchange shows separate BNB debit, processor creates separate transaction

2. **Multiple fees of same scope:** How to handle 2+ network fees (multi-hop DEX swap)?
   - **Resolution:** Array structure naturally supports multiple fees of the same scope. No additional changes needed.

3. **Spread fees without explicit amount:** How to handle implicit costs in RFQ trades?
   - **Status:** Future extension (informational/reporting only)
   - **Rationale:** Spread costs are already reflected in execution prices. Adding them as explicit fees would double-count in cost basis calculations. Does not affect transaction linking or cost-basis, so safe to defer.
   - **When implemented:**
     - Derive spread by comparing execution vs mid-market price
     - Store with `scope='spread'`
     - **Exclude from cost basis calculations** (update `calculateFeesInFiat()` to skip `scope='spread'`)
     - Use for reporting/analytics only (e.g., "You paid $X in spreads this year")
   - **Blockers:** Requires reliable mid-market price data at transaction time
