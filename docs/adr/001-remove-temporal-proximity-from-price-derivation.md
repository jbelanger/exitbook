# ADR 001: Remove Temporal Proximity from Price Derivation

**Date**: 2025-01-30
**Status**: Accepted
**Deciders**: Joel Belanger (maintainer), Technical Reviewer
**Tags**: price-derivation, accuracy, simplification

---

## Context and Problem Statement

The price enrichment system uses **temporal proximity** to reuse prices from recent transactions when filling gaps. The current implementation uses a **1-hour temporal window** (`maxTimeDeltaMs = 3,600,000ms`), which attempts to avoid excessive API calls to external price providers by reusing prices from transactions that occurred within the last hour.

This creates both **accuracy problems** and **unnecessary complexity**.

### The Problem with Temporal Proximity

**Scenario: Exchange Withdrawal → In-Wallet Swap**

```
Jan 1, 10:00 AM:  Buy 1 BTC @ $50,000 on Kraken
                  ✅ Priced from fiat trade

June 1, 3:00 PM:  Withdraw 1 BTC from Kraken (BTC now @ $60,000)
                  ❌ No price (last trade was >1 hour ago)
                  ❌ With 1-hour window: nothing found
                  ❌ With 30-day window: uses $50k (WRONG! Should be $60k)

June 1, 3:05 PM:  Receive 1 BTC in wallet
                  ❌ No price (linked withdrawal has no price to copy)

June 1, 3:10 PM:  Swap 1 BTC → 20 ETH (in wallet)
                  ❌ Cannot derive ETH price
                  - BTC side has no FMV
                  - Multi-pass inference fails: ETH = ??? / 20
```

### Why Temporal Proximity Creates Inaccuracy

**Example: Volatile market with 1-hour window**

```
10:00 AM - Buy BTC @ $50,000
11:00 AM - BTC moves to $51,500 (3% in 1 hour)
           - Withdraw BTC
           - Temporal proximity finds 10:00 AM trade
           - Uses $50,000 (stale!)
           - Actual FMV is $51,500
           - Error: $1,500 per BTC (3%)
```

**Example: Wider window makes it worse**

```
Jan 1  - Buy BTC @ $50,000
Feb 15 - BTC moves to $60,000 (20% gain)
        - Withdraw BTC
        - Temporal proximity (30-day window) finds Jan 1 trade
        - Uses $50,000 (very stale!)
        - Actual FMV is $60,000
        - Error: $10,000 per BTC (20%)
```

### Why Temporal Proximity Adds Complexity

The system must answer:

- Is there a price within the time window?
- Is that price "close enough" to be accurate?
- Should I use it or fetch from API?
- What if the price changed significantly in that window?
- What window size balances cost vs accuracy?

**This complexity is unnecessary** because temporal proximity helps almost nothing.

## Decision

**Remove temporal proximity entirely** by setting `maxTimeDeltaMs = 0`.

**Rely exclusively on:**

1. Fiat/stablecoin trade prices (immediate, accurate)
2. Same-transaction multi-pass inference (immediate, accurate)
3. Link propagation across platforms (immediate, accurate)
4. External API fetch for gaps (Binance, accurate)

### Implementation

```typescript
// packages/accounting/src/price-enrichment/price-enrichment-service.ts:60
this.config = {
  maxTimeDeltaMs: 0, // Disable temporal proximity entirely (was 3,600,000)
  maxIterations: config?.maxIterations ?? 10,
};
```

### Workflow (Unchanged)

```bash
# Step 1: Derive prices from trades, multi-pass inference, link propagation
pnpm run dev prices derive

# Step 2: Fill remaining gaps with Binance
pnpm run dev prices fetch
```

## Rationale

### What Actually Provides Prices?

With `maxTimeDeltaMs = 0`, prices come from four sources:

#### 1. Fiat/Stablecoin Trades (Same Transaction)

```typescript
// Trade: 50,000 USDT → 1 BTC
tx.movements = {
  inflow: { asset: 'BTC', amount: 1 }, // ❌ No price yet
  outflow: { asset: 'USDT', amount: 50000 }, // ✅ Fiat
};

// extractKnownPrices() + calculatePriceFromTrade():
// USDT is fiat → BTC price = 50,000 / 1 = $50,000 ✅
// This is IMMEDIATE (same transaction), NOT temporal lookup
```

#### 2. Multi-Pass Inference (Same Transaction)

```typescript
// In-wallet swap: 1 BTC → 20 ETH
tx.movements = {
  inflow: { asset: 'ETH', amount: 20 }, // ❌ No price yet
  outflow: { asset: 'BTC', amount: 1 }, // ✅ Has price ($60k from link)
};

// inferPriceFromTrade():
// BTC has price → ETH = $60,000 / 20 = $3,000 per ETH ✅
// This is IMMEDIATE (same transaction), NOT temporal lookup
```

#### 3. Link Propagation (Cross-Platform)

```typescript
// Kraken withdrawal → Blockchain deposit (linked)
source: withdrawal { asset: 'BTC', priceAtTxTime: $60,000 }
target: deposit   { asset: 'BTC', priceAtTxTime: null }

// propagatePricesAcrossLinks():
// Copy $60,000 from source to target ✅
// This is IMMEDIATE (via confirmed link), NOT temporal lookup
```

#### 4. External API Fetch (Binance)

```typescript
// Withdrawal (no fiat side, no recent trades)
tx.movements = {
  outflow: { asset: 'BTC', amount: 1 }, // ❌ No price
};

// Multi-pass inference: Nothing to derive (no trade pair)
// Link propagation: Nothing to copy (no confirmed link)
// Temporal proximity (disabled): Skipped
// External fetch: Binance gets BTC FMV at tx.datetime ✅
```

### What Temporal Proximity Actually Helps

**Answer: Almost nothing.**

Let's check each scenario:

| Scenario               | Needs Temporal Proximity? | Why/Why Not                                   |
| ---------------------- | ------------------------- | --------------------------------------------- |
| Fiat trade (buy/sell)  | ❌ NO                     | Price derived from fiat leg (same tx)         |
| Same-tx crypto swap    | ❌ NO                     | Multi-pass inference (same tx)                |
| Withdrawal             | ❌ NO                     | Should fetch current FMV, not reuse old price |
| Linked deposit         | ❌ NO                     | Link propagation copies from source           |
| Batch CSV import       | ❌ NO                     | Timestamps differ by seconds; fetch is better |
| In-wallet swap         | ❌ NO                     | Multi-pass inference (same tx)                |
| Mining/staking receive | ❌ NO                     | Should fetch FMV at receive time              |

**Temporal proximity only helps if:**

- You have a non-trade transaction (no fiat side)
- AND it's not linked to anything
- AND it happens within the time window of another transaction
- AND you're willing to use a potentially stale price

**This is exactly what we DON'T want for tax accuracy.**

### Code Simplification

**Before (with temporal proximity):**

```typescript
// Complex decision tree in fillGapsWithTemporalProximity():
for (const movement of allMovements) {
  if (movement.priceAtTxTime) {
    continue; // Already has price
  }

  // Should we reuse a price from another transaction?
  const closestPrice = findClosestPrice(
    movement.asset,
    timestamp,
    priceIndex,
    this.config.maxTimeDeltaMs // ← Complex: what window size?
  );

  if (closestPrice) {
    // Is this price accurate enough?
    // Did the market move significantly since then?
    // Should we fetch fresh data instead?
    proximityPrices.push({
      asset: movement.asset,
      priceAtTxTime: closestPrice, // ← Potentially stale!
    });
  }
}
```

**After (without temporal proximity):**

```typescript
// Simple contract:
// If movement has no price after inference + propagation → external fetch handles it
// NO complex decision tree, NO stale prices, NO guessing
```

The `fillGapsWithTemporalProximity()` method can be simplified or removed entirely since `maxTimeDeltaMs = 0` means `findClosestPrice()` never returns a match.

### Accuracy Improvement

**Scenario: Withdrawal months after purchase**

```
Before (1-hour window):
  Jan 1:  Buy BTC @ $50k
  June 1: Withdraw BTC (now $60k)
          - Temporal proximity: nothing within 1 hour
          - Result: No price ❌
          - User must run external fetch anyway

Before (30-day window):
  Jan 1:  Buy BTC @ $50k
  Jan 15: Withdraw BTC (now $52k)
          - Temporal proximity: finds Jan 1 trade ($50k)
          - Result: Wrong price ❌ ($50k instead of $52k)
          - Error: $2,000 per BTC

After (no temporal proximity):
  Jan 1:  Buy BTC @ $50k
  June 1: Withdraw BTC (now $60k)
          - Temporal proximity: disabled
          - Result: No price (expected)
          - External fetch: Binance gets $60k ✅
          - Accurate FMV at withdrawal time
```

### Canadian Tax Compliance

For crypto-to-crypto swaps (taxable disposals in Canada):

**Required:**

- Disposal proceeds = **FMV at disposal time** (not historical cost basis)
- New acquisition cost basis = **FMV paid** (in crypto value)

**Example: BTC→ETH Swap**

```
Cost Basis Tracking:
  Jan 1:  Buy BTC @ $50k → acquisition_lots: cost_basis = $50k
  June 1: Swap BTC→ETH (BTC FMV = $60k)

Tax Calculation:
  BTC Disposal:
    Proceeds: $60,000 (FMV at swap time) ← Must be accurate!
    Cost:     $50,000 (from acquisition_lots)
    Gain:     $10,000 (taxable)

  ETH Acquisition:
    Cost basis: $60,000 (FMV paid in BTC)
    Per unit:   $60,000 / 20 = $3,000 per ETH

Wrong Calculation (if we used stale $50k from temporal proximity):
  BTC Disposal:
    Proceeds: $50,000 (WRONG! Used stale price)
    Cost:     $50,000
    Gain:     $0 (WRONG! Should be $10,000)

  ETH Acquisition:
    Cost basis: $50,000 (WRONG! Should be $60,000)
    Per unit:   $2,500 per ETH (WRONG! Should be $3,000)

Result: $10,000 in unreported capital gains → CRA audit risk
```

### Why Binance is Sufficient

- ✅ **Free tier**: No API key required for historical data
- ✅ **High limits**: 1,200 requests/minute, 6,000 requests/hour
- ✅ **1-minute granularity**: FMV accurate to the minute
- ✅ **365-day history**: Covers all recent transactions at minute-level
- ✅ **Daily candles**: Automatic fallback for data >365 days old
- ✅ **Comprehensive coverage**: 1,000+ trading pairs
- ✅ **Auto-enabled**: Already integrated in provider registry

### Cost Analysis

**Before (with temporal proximity):**

- Purpose: Avoid API calls
- Reality: Still need external fetch for most gaps
- Hidden cost: Stale prices → incorrect tax reporting → manual fixes
- Developer cost: Complex code, hard to reason about

**After (without temporal proximity):**

- API calls: ~1 per withdrawal/deposit transaction
- Actual cost: $0 (Binance free tier)
- Accuracy: Near-perfect (1-minute granularity)
- Code: Simpler, easier to reason about
- Contract: "No price? Fetch it."

## Consequences

### Positive

✅ **Simpler code**: Remove complex temporal matching logic
✅ **Clearer contract**: "If no price after derive, fetch fills it"
✅ **Better accuracy**: Always use current FMV, never stale prices
✅ **Tax compliance**: Correct proceeds and cost basis for CRA
✅ **Predictable**: No "what window size?" decisions
✅ **Maintainable**: Less code, fewer edge cases

### Negative

⚠️ **More API calls**: Every gap triggers external fetch (but that's the point!)
⚠️ **Network dependency**: Requires internet for `prices fetch` step

### Mitigation

- Binance rate limits are generous (1,200 req/min = 72,000 req/hour)
- Provider manager has automatic retry with backoff
- Price cache (300s TTL) deduplicates same-asset requests
- Multiple providers available as fallback (CoinGecko, CryptoCompare)

### Neutral

- **No breaking changes**: Workflow remains the same (`derive` → `fetch`)
- **Backward compatible**: Existing data unaffected
- **Still configurable**: `maxTimeDeltaMs` parameter remains (just defaults to 0)

## Alternatives Considered

### Alternative 1: Keep 1-Hour Window

**Pros**: No changes needed, avoids some API calls
**Cons**: Inaccurate for volatile markets, still misses most gaps
**Rejected**: Accuracy is non-negotiable for tax reporting

### Alternative 2: Reduce to 1 Minute

**Pros**: Better accuracy than 1 hour
**Cons**: Still adds complexity, helps ~0% of cases (same-tx is instant, cross-tx needs exact match)
**Rejected**: Adds complexity for negligible benefit

### Alternative 3: Configurable Window via CLI

```bash
pnpm run dev prices derive --max-time-window 30d
```

**Pros**: Flexibility for different use cases
**Cons**: Complex, users must understand trade-offs, wrong defaults lead to bad data
**Rejected**: Simple is better; accuracy is always the right choice

### Alternative 4: Transaction-Type-Aware Windows

```typescript
if (isTrade(tx)) {
  maxTimeDeltaMs = 0; // No temporal reuse for trades
} else if (isTransfer(tx)) {
  maxTimeDeltaMs = 86_400_000; // 24 hours for transfers
}
```

**Pros**: Optimizes API usage for transfers
**Cons**: Still complex, transfers need accurate FMV for subsequent swaps
**Rejected**: Transfers need current FMV too (for in-wallet swap derivation)

## Implementation Plan

### Phase 1: Disable Temporal Proximity

```typescript
// packages/accounting/src/price-enrichment/price-enrichment-service.ts:60
this.config = {
  maxTimeDeltaMs: 0, // Disable temporal proximity entirely
  maxIterations: config?.maxIterations ?? 10,
};
```

### Phase 2: Simplify Code (Optional)

Since `maxTimeDeltaMs = 0` means `findClosestPrice()` never matches:

- Keep the code as-is (it safely does nothing)
- OR remove `fillGapsWithTemporalProximity()` calls
- OR add early return: `if (maxTimeDeltaMs === 0) return transactions;`

No rush - the code already handles this correctly.

### Phase 3: Documentation

- ✅ Update this ADR
- Update CLAUDE.md workflow section
- Add comment explaining why `maxTimeDeltaMs = 0`

### Testing

Verify the workflow produces accurate FMV:

1. Import Kraken trades (Jan 1: Buy BTC @ $50k)
2. Import Kraken withdrawals (June 1: Withdraw BTC)
3. Import blockchain deposits (June 1: Receive BTC)
4. Run `pnpm run dev link` (create confirmed links)
5. Run `pnpm run dev prices derive` (propagate via links)
6. Run `pnpm run dev prices fetch` (Binance fills gaps with $60k)
7. Import in-wallet swap (June 1: BTC→ETH)
8. Run `pnpm run dev prices derive` (derives ETH = $60k/20 = $3k)

## Related Decisions

- **Phase 2: Link-Aware Price Derivation** (See: `docs/phase-2-link-aware-price-derivation-analysis.md`)
  - Enables price propagation across exchange→blockchain links
  - Critical for this ADR: linked deposits get FMV from source

- **Binance Provider Integration** (Already implemented)
  - Auto-enabled in provider factory registry
  - 1-minute candles for last 365 days
  - Free tier sufficient for typical users

## References

- **Discussion**: Price derivation reviewer feedback
- **Code**: `packages/accounting/src/price-enrichment/price-enrichment-service.ts:59-61`
- **Code**: `packages/accounting/src/price-enrichment/price-calculation-utils.ts:111-143` (findClosestPrice)
- **Provider**: `packages/price-providers/src/binance/provider.ts`
- **Tax Context**: Canadian tax treatment requires FMV at disposal time

## Key Insight

**Temporal proximity was designed to save API calls, but:**

- It doesn't save many calls (most gaps need fresh data anyway)
- It sacrifices accuracy (stale prices)
- It adds complexity (what window size?)
- External APIs (Binance) are free and accurate

**Better approach:**

- Multi-pass inference handles same-transaction derivations (instant, accurate)
- Link propagation handles cross-platform transfers (instant, accurate)
- External fetch handles everything else (near-instant, accurate, free)
- No temporal proximity needed

---

**Decision**: Remove temporal proximity by setting `maxTimeDeltaMs = 0`
**Rationale**: Simpler code, better accuracy, sufficient external API coverage
**Implementation**: Change default from `3_600_000` to `0`
**Testing**: Verify withdrawal→deposit→swap workflow produces accurate FMV from Binance
