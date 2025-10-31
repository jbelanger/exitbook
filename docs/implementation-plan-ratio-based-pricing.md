# Implementation Plan: Fix Crypto-Crypto Swap Ratio Pricing

**Issue**: After removing temporal proximity and relying on fetch, crypto-crypto swaps get both sides priced independently at market rates, losing the execution price from the swap ratio.

**Example Problem**:

```
Swap: 1 BTC → 1,000 ADA (ratio 1:1000)

After fetch:
  BTC = $60,000 (correct)
  ADA = $61 per coin (market price) ❌

Should be:
  BTC = $60,000 (from fetch)
  ADA = $60 per coin (from 1:1000 ratio) ✅
```

---

## Solution: Add Pass N+2 to Recalculate Crypto-Crypto Ratios

### File to Modify

`packages/accounting/src/price-enrichment/price-enrichment-service.ts`

### Location

In the `inferMultiPass()` method (line 473-611), **after** the Pass N+1 temporal proximity section (line 562-595), add a new **Pass N+2** section.

### Code to Add

Insert this **after line 595** (after the temporal proximity section ends):

```typescript
// Pass N+2: Recalculate crypto-crypto swap ratios
// When both sides have prices but neither is fiat, recalculate the inflow (acquisition)
// side from the outflow (disposal) side using the swap ratio.
// This ensures we use execution price, not market price, for cost basis.
for (const tx of transactions) {
  const enriched = enrichedMovements.get(tx.id);
  const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
  const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
  const timestamp = new Date(tx.datetime).getTime();

  const trade = extractTradeMovements(inflows, outflows, timestamp);
  if (!trade) {
    continue;
  }

  // Both sides must have prices
  if (!trade.inflow.priceAtTxTime || !trade.outflow.priceAtTxTime) {
    continue;
  }

  // Check if this is a crypto-crypto swap (neither side is fiat/stable)
  const inflowCurrency = Currency.create(trade.inflow.asset);
  const outflowCurrency = Currency.create(trade.outflow.asset);

  if (inflowCurrency.isFiatOrStablecoin() || outflowCurrency.isFiatOrStablecoin()) {
    continue; // Keep fiat-based prices (they're already execution prices)
  }

  // Both are crypto: recalculate inflow from outflow using swap ratio
  // We trust the outflow price (disposal side) as it should be FMV from fetch
  // Then calculate inflow (acquisition) from the ratio
  const ratio = parseDecimal(trade.outflow.amount.toFixed()).dividedBy(parseDecimal(trade.inflow.amount.toFixed()));
  const derivedPrice = parseDecimal(trade.outflow.priceAtTxTime.price.amount.toFixed()).times(ratio);

  const ratioPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [
    {
      asset: trade.inflow.asset,
      priceAtTxTime: {
        price: {
          amount: derivedPrice,
          currency: trade.outflow.priceAtTxTime.price.currency,
        },
        source: 'derived-ratio',
        fetchedAt: new Date(timestamp),
        granularity: trade.outflow.priceAtTxTime.granularity,
      },
    },
  ];

  // Overwrite the fetched market price with ratio-based execution price
  const updatedInflows = this.enrichMovements(inflows, ratioPrices, true); // overwriteDerivedHistory=true
  const updatedOutflows = outflows; // Keep outflow prices (disposal FMV)

  enrichedMovements.set(tx.id, {
    inflows: updatedInflows,
    outflows: updatedOutflows,
  });
}

logger.debug({ transactionsRecalculated: enrichedMovements.size }, 'Pass N+2: Recalculated crypto-crypto swap ratios');
```

### Required Import

Add `Currency` to the imports at the top of the file (line 1):

```typescript
import type { AssetMovement, Currency, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { wrapError, Currency as CurrencyClass } from '@exitbook/core';
```

Wait, actually check if `Currency` is already imported. If not, import it:

```typescript
import { Currency } from '@exitbook/core';
```

### Type Addition (Optional)

Update the `PriceAtTxTime` source type to include `'derived-ratio'`.

**File**: `packages/core/src/schemas/price-at-tx-time.schema.ts`

Find the source enum and add:

```typescript
source: z.enum([
  'exchange-execution',
  'derived-history',
  'derived-trade',
  'link-propagated',
  'derived-ratio', // NEW: Execution price from crypto-crypto swap ratio
  // ... other sources
]);
```

---

## Testing Plan

### Test Case 1: Crypto-Crypto Swap with Fetch

**Setup**:

1. Import a deposit: 1 BTC on June 1
2. Import a swap: 1 BTC → 1,000 ADA on June 2

**Run**:

```bash
pnpm run dev prices derive  # First pass
pnpm run dev prices fetch   # Fills BTC=$60k, ADA=$61
pnpm run dev prices derive  # Second pass (triggers Pass N+2)
```

**Expected**:

- BTC outflow: $60,000 (from fetch)
- ADA inflow: $60 per coin (from ratio: $60,000 / 1,000)
- NOT $61 per coin (market price)

**Verify**:

```sql
SELECT
  id,
  datetime,
  movements_inflows,
  movements_outflows
FROM transactions
WHERE id = <swap_transaction_id>;
```

Check that ADA price is $60, not $61.

### Test Case 2: Fiat Trade (Should Not Change)

**Setup**:

1. Import a fiat trade: 50,000 USDT → 1 BTC

**Run**:

```bash
pnpm run dev prices derive
```

**Expected**:

- BTC inflow: $50,000 (from USDT fiat leg)
- Pass N+2 should skip this (one side is fiat)

**Verify**: BTC price is $50,000 from execution, not from fetch.

### Test Case 3: Swap After Fiat Trade

**Setup**:

1. Import fiat trade: 50,000 USDT → 1 BTC (Jan 1)
2. Import swap: 1 BTC → 10 ETH (June 1)

**Run**:

```bash
pnpm run dev prices derive  # First pass (BTC gets $50k)
pnpm run dev prices fetch   # Fills BTC=$60k (June 1 FMV), ETH=$6,100
pnpm run dev prices derive  # Second pass
```

**Expected**:

- BTC outflow: $60,000 (from fetch - disposal FMV)
- ETH inflow: $6,000 per coin (from ratio: $60,000 / 10)
- NOT $6,100 (market price)

---

## Edge Cases to Consider

### 1. Stablecoin Swaps

```
Swap: 1,000 USDT → 1,000 USDC

Should NOT recalculate (both are stablecoins)
Keep market prices from fetch
```

**Handled by**: `isFiatOrStablecoin()` check

### 2. Three-Way Swaps (Rare)

```
1 BTC → 10 ETH → 5000 ADA (all in one transaction)

Current code assumes 1 inflow + 1 outflow
extractTradeMovements() returns undefined for 2+ inflows/outflows
```

**Handled by**: `if (!trade)` check (skips non-simple trades)

### 3. Partial Fills

```
Swap: 1 BTC → 950 ADA (expected 1,000, slippage)

Ratio calculation: $60,000 / 950 = $63.16 per ADA
This is correct (effective execution price)
```

**Handled correctly**: Ratio uses actual amounts received

---

## Alternative: Only Recalculate if Source is 'external-fetch'

If you want to be more conservative, only recalculate when the prices came from fetch (not from previous derivations):

```typescript
// Check if prices came from external fetch
if (
  trade.inflow.priceAtTxTime.source !== 'binance' &&
  trade.inflow.priceAtTxTime.source !== 'coingecko' &&
  trade.inflow.priceAtTxTime.source !== 'cryptocompare'
) {
  continue; // Skip if not from external fetch
}
```

This prevents overwriting prices that were already derived correctly.

**Recommended**: Implement this check for safety.

---

## Additional Change: Set maxTimeDeltaMs = 0

**File**: `packages/accounting/src/price-enrichment/price-enrichment-service.ts`

**Line 60**:

```typescript
this.config = {
  maxTimeDeltaMs: 0, // Disable temporal proximity (was 3_600_000)
  maxIterations: config?.maxIterations ?? 10,
};
```

---

## Workflow After Implementation

```bash
# Step 1: Extract execution prices from fiat trades, propagate links
pnpm run dev prices derive

# Step 2: Fetch market FMV for gaps (withdrawals, deposits, swap originating sides)
pnpm run dev prices fetch

# Step 3: Recalculate crypto-crypto swap ratios (Pass N+2)
pnpm run dev prices derive
```

**What happens in each step**:

1. **First derive**:
   - Extract fiat trade execution prices
   - Propagate through links
   - Multi-pass inference (limited without temporal proximity)

2. **Fetch**:
   - Fill ALL gaps with market FMV
   - This includes both sides of crypto-crypto swaps

3. **Second derive**:
   - Pass N+2 detects crypto-crypto swaps
   - Keeps outflow (disposal) FMV from fetch
   - Recalculates inflow (acquisition) from ratio
   - Now inflow has execution price, not market price

---

## Summary

**Lines to modify**: ~60 lines in one file
**Complexity**: Medium (need to understand the flow)
**Testing**: Critical (verify ratios calculate correctly)
**Risk**: Low (only affects crypto-crypto swaps, skips fiat trades)

**Next chat prompt**:

```
I need to implement crypto-crypto swap ratio pricing.

Context:
- We removed temporal proximity (maxTimeDeltaMs = 0)
- Fetch now fills gaps with market prices
- Problem: Both sides of crypto swaps get market prices
- Need: Recalculate acquisition side from disposal FMV × ratio

Plan: docs/implementation-plan-ratio-based-pricing.md

Please implement Pass N+2 in price-enrichment-service.ts
```
