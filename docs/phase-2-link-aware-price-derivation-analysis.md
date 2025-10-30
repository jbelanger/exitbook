# Phase 2: Link-Aware Price Derivation - Implementation Analysis

**Date**: 2025-10-30
**Parent Issue**: #111 - Phase 2
**Tracking Issue**: #145
**Goal**: Enable price derivation to use cross-wallet/cross-platform transaction links

---

## Executive Summary

Two viable approaches exist for implementing link-aware price derivation:

1. **Approach A: Pre-Processing Link Graph** (RECOMMENDED)
   - **Success Probability**: 85%
   - Minimal changes to existing code
   - Clear separation of concerns
   - Easier to test and debug

2. **Approach B: Runtime Link Resolution**
   - **Success Probability**: 60%
   - More complex integration
   - Higher performance for large datasets
   - Tighter coupling between systems

---

## Current Architecture Analysis

### Price Derivation Flow (Current)

```
1. PriceEnrichmentService.enrichPrices()
2. Group transactions by exchange (source_id)
   - Kraken transactions → Process independently
   - Coinbase transactions → Process independently
3. Group blockchain transactions separately
   - Bitcoin transactions → Process independently
   - Ethereum transactions → Process independently
4. Multi-pass inference WITHIN each group
5. Update database
```

**Key Limitation**: Price knowledge stays siloed within each exchange/blockchain.

### Transaction Linking System (Existing)

```sql
transaction_links
├── source_transaction_id (FK to transactions.id)
├── target_transaction_id (FK to transactions.id)
├── link_type (exchange_to_blockchain, blockchain_to_blockchain, exchange_to_exchange)
├── confidence_score (0-1)
└── status (suggested, confirmed, rejected)
```

**Example Link**:

- Source: Kraken withdrawal (tx_id: 100, 1 BTC @ $50,000)
- Target: Bitcoin deposit (tx_id: 200, 1 BTC @ unknown price)
- Link Type: `exchange_to_blockchain`
- Status: `confirmed`

### What Phase 2 Should Enable

**Scenario**: User bought 1 BTC on Kraken @ $50,000, withdrew it to their Bitcoin wallet, then sent 0.5 BTC to a merchant.

**Before Phase 2**:

- Kraken: Buy 1 BTC @ $50,000 ✓ (has price)
- Kraken: Withdraw 1 BTC ✓ (has price from buy)
- Bitcoin: Receive 1 BTC ❌ (no price - blockchain doesn't know about exchange)
- Bitcoin: Send 0.5 BTC ❌ (no price - can't derive without knowing receive price)

**After Phase 2**:

- Kraken: Buy 1 BTC @ $50,000 ✓
- Kraken: Withdraw 1 BTC ✓
- **Bitcoin: Receive 1 BTC ✓ (price $50,000 from linked Kraken withdrawal)**
- **Bitcoin: Send 0.5 BTC ✓ (can derive from receive price via temporal proximity)**

---

## Approach A: Pre-Processing Link Graph (RECOMMENDED)

### Architecture

```typescript
// New service in packages/ingestion/src/services/price-enrichment/

class LinkGraphBuilder {
  /**
   * Build a unified transaction graph from links
   * Returns grouped transactions where linked transactions are in the same group
   */
  async buildLinkGraph(transactions: UniversalTransaction[], links: TransactionLink[]): Promise<TransactionGroup[]> {
    // Use Union-Find algorithm to group linked transactions
    // Each group contains all transitively linked transactions
  }
}

// TransactionGroup structure
interface TransactionGroup {
  groupId: string;
  transactions: UniversalTransaction[];
  sources: Set<string>; // ['kraken', 'bitcoin', 'ethereum']
  linkChain: TransactionLink[]; // All links within this group
}
```

### Modified PriceEnrichmentService

```typescript
class PriceEnrichmentService {
  async enrichPrices(): Promise<Result<{ transactionsUpdated: number }, Error>> {
    // 1. Fetch all transactions
    const allTransactions = await this.transactionRepository.getTransactions();

    // 2. Fetch confirmed links
    const linkRepo = new TransactionLinkRepository(this.db);
    const links = await linkRepo.findAll('confirmed');

    // 3. BUILD LINK GRAPH (NEW)
    const linkGraphBuilder = new LinkGraphBuilder();
    const groups = await linkGraphBuilder.buildLinkGraph(allTransactions.value, links.value);

    // 4. Process each group independently (MODIFIED)
    //    Now groups contain cross-platform transactions!
    for (const group of groups) {
      await this.enrichTransactionGroup(group);
    }
  }

  private async enrichTransactionGroup(group: TransactionGroup): Promise<number> {
    // Same multi-pass inference logic
    // But now price index includes ALL transactions in group
    // (exchange + linked blockchain transactions)
    // Example: If Kraken withdrawal is linked to Bitcoin deposit,
    // the Bitcoin deposit inherits the price from Kraken withdrawal
  }
}
```

### Implementation Steps

**1. Create LinkGraphBuilder Service** (~150 LOC)

```typescript
// packages/ingestion/src/services/price-enrichment/link-graph-builder.ts

export class LinkGraphBuilder {
  buildLinkGraph(transactions: UniversalTransaction[], links: TransactionLink[]): TransactionGroup[] {
    // Union-Find to group linked transactions
    const uf = new UnionFind(transactions.map((tx) => tx.id));

    // Union all linked transactions
    for (const link of links) {
      if (link.status === 'confirmed') {
        uf.union(link.sourceTransactionId, link.targetTransactionId);
      }
    }

    // Group transactions by their root
    const groups = new Map<number, UniversalTransaction[]>();
    for (const tx of transactions) {
      const root = uf.find(tx.id);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(tx);
    }

    // Convert to TransactionGroup objects
    return Array.from(groups.values()).map((txs) => ({
      groupId: crypto.randomUUID(),
      transactions: txs,
      sources: new Set(txs.map((tx) => tx.source)),
      linkChain: this.extractGroupLinks(txs, links),
    }));
  }
}
```

**2. Modify PriceEnrichmentService** (~50 LOC changes)

- Add LinkGraphBuilder integration
- Change from `groupByExchange()` to `buildLinkGraph()`
- Rest of logic stays the same!

**3. Add Price Propagation Logic** (~100 LOC)

```typescript
private propagatePricesAcrossLinks(
  group: TransactionGroup,
  priceIndex: Map<string, PriceAtTxTime[]>
): void {
  // For each link in the group
  for (const link of group.linkChain) {
    const source = group.transactions.find(tx => tx.id === link.sourceTransactionId);
    const target = group.transactions.find(tx => tx.id === link.targetTransactionId);

    if (source && target) {
      // Propagate prices from source movements to target movements
      // Match by asset and amount similarity (accounting for fees)
      this.propagateMovementPrices(source, target, link, priceIndex);
    }
  }
}
```

**4. Update Tests** (~200 LOC)

- Test link graph building
- Test cross-platform price propagation
- Test edge cases (circular links, rejected links, etc.)

### Pros & Cons

**Pros**:
✅ **Minimal changes to existing code** - Core inference logic unchanged
✅ **Clear separation of concerns** - LinkGraphBuilder is independent
✅ **Easy to test** - Can test graph building separately from price derivation
✅ **Handles complex link chains** - Works with multi-hop links (Kraken → Bitcoin → Ethereum)
✅ **Performance predictable** - O(n log n) for Union-Find
✅ **Backward compatible** - Falls back to single-transaction groups if no links

**Cons**:
⚠️ **Extra memory** - Builds link graph upfront
⚠️ **Two-phase approach** - Graph building + enrichment (slightly more complex flow)

### Risk Assessment

| Risk                         | Probability  | Mitigation                                                |
| ---------------------------- | ------------ | --------------------------------------------------------- |
| Union-Find bugs              | Low (15%)    | Well-understood algorithm, extensive testing              |
| Graph building performance   | Low (10%)    | Union-Find is O(n log n), acceptable for typical datasets |
| Price propagation edge cases | Medium (30%) | Comprehensive test suite covering various link scenarios  |
| Integration complexity       | Low (20%)    | Minimal changes to existing service                       |

**Overall Success Probability: 85%**

---

## Approach B: Runtime Link Resolution

### Architecture

```typescript
class PriceEnrichmentService {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly linkRepository: TransactionLinkRepository, // NEW
    config?: PriceEnrichmentConfig
  ) {}

  async enrichPrices(): Promise<Result<{ transactionsUpdated: number }, Error>> {
    // Same grouping by exchange
    const txsByExchange = this.groupByExchange(allTransactions);

    // Process each exchange
    for (const [exchange, txs] of txsByExchange.entries()) {
      // Build price index for this exchange
      const priceIndex = this.extractKnownPrices(txs);

      // NEW: Dynamically resolve linked transactions during inference
      await this.enrichWithLinkResolution(txs, priceIndex);
    }
  }

  private async enrichWithLinkResolution(
    transactions: UniversalTransaction[],
    priceIndex: Map<string, PriceAtTxTime[]>
  ): Promise<void> {
    for (const tx of transactions) {
      // Check if transaction has links
      const links = await this.linkRepository.findBySourceTransactionId(tx.id);

      if (links.isOk() && links.value.length > 0) {
        // Fetch linked target transactions
        for (const link of links.value) {
          if (link.status === 'confirmed') {
            const target = await this.transactionRepository.findById(link.targetTransactionId);

            if (target.isOk() && target.value) {
              // Add target transaction's prices to price index
              this.mergePricesFromTransaction(target.value, priceIndex);
            }
          }
        }
      }

      // Now infer prices with expanded price index
      const inferredPrices = inferPriceFromTrade(
        extractTradeMovements(tx.movements.inflows, tx.movements.outflows, timestamp),
        priceIndex,
        this.config.maxTimeDeltaMs
      );
    }
  }
}
```

### Implementation Steps

**1. Inject TransactionLinkRepository** (~20 LOC)

```typescript
constructor(
  private readonly transactionRepository: TransactionRepository,
  private readonly linkRepository: TransactionLinkRepository, // NEW
  config?: PriceEnrichmentConfig
) {}
```

**2. Add Link Resolution Method** (~150 LOC)

```typescript
private async resolveLinkedPrices(
  tx: UniversalTransaction,
  priceIndex: Map<string, PriceAtTxTime[]>
): Promise<void> {
  // Recursively fetch linked transactions
  // Add their prices to the index
  // Handle circular references with visited set
}
```

**3. Integrate into Multi-Pass Inference** (~100 LOC changes)

- Modify `inferMultiPass()` to call `resolveLinkedPrices()` before each iteration
- Cache link lookups to avoid repeated DB queries

**4. Add Caching Layer** (~80 LOC)

```typescript
private linkCache = new Map<number, TransactionLink[]>();

private async getCachedLinks(txId: number): Promise<TransactionLink[]> {
  if (!this.linkCache.has(txId)) {
    const result = await this.linkRepository.findBySourceTransactionId(txId);
    this.linkCache.set(txId, result.isOk() ? result.value : []);
  }
  return this.linkCache.get(txId)!;
}
```

### Pros & Cons

**Pros**:
✅ **Lazy loading** - Only fetches links when needed
✅ **Memory efficient** - Doesn't build full graph upfront
✅ **Fine-grained control** - Can control link resolution depth

**Cons**:
⚠️ **More database queries** - N queries for N transactions with links
⚠️ **Complex caching** - Need to cache link lookups and linked transactions
⚠️ **Harder to test** - Tighter coupling between services
⚠️ **Risk of circular references** - Need careful visited tracking
⚠️ **Performance unpredictable** - Depends on link structure
⚠️ **Code complexity** - Many changes to existing inference logic

### Risk Assessment

| Risk                      | Probability  | Mitigation                                    |
| ------------------------- | ------------ | --------------------------------------------- |
| Performance degradation   | High (40%)   | Aggressive caching, link depth limits         |
| Circular reference bugs   | Medium (35%) | Visited tracking, max depth limits            |
| Integration bugs          | High (45%)   | More invasive changes to existing code        |
| Cache invalidation issues | Medium (30%) | Clear cache strategy, comprehensive testing   |
| Difficult debugging       | High (40%)   | Runtime resolution makes flow harder to trace |

**Overall Success Probability: 60%**

---

## Comparison Matrix

| Criteria                | Approach A (Pre-Processing)   | Approach B (Runtime)                |
| ----------------------- | ----------------------------- | ----------------------------------- |
| **Code Complexity**     | Low - ~300 LOC                | High - ~350 LOC + major refactoring |
| **Testing Complexity**  | Low - Clear boundaries        | High - Integration-heavy            |
| **Performance**         | Predictable O(n log n)        | Unpredictable (depends on links)    |
| **Memory Usage**        | Higher (full graph)           | Lower (lazy loading)                |
| **Maintainability**     | High - Separation of concerns | Medium - Tight coupling             |
| **Debuggability**       | High - Clear phases           | Low - Runtime resolution            |
| **Success Probability** | **85%**                       | **60%**                             |
| **Time to Implement**   | ~3-4 days                     | ~5-7 days                           |
| **Risk Level**          | Low                           | Medium-High                         |

---

## Recommendation

**Choose Approach A: Pre-Processing Link Graph**

### Why?

1. **Higher Success Probability** (85% vs 60%)
2. **Lower Risk** - Minimal changes to battle-tested inference logic
3. **Better Separation of Concerns** - LinkGraphBuilder is independent
4. **Easier to Test & Debug** - Clear phases, predictable flow
5. **Handles Complex Cases** - Multi-hop links work naturally with Union-Find
6. **Faster Implementation** - 3-4 days vs 5-7 days

### Trade-offs

The main trade-off is slightly higher memory usage (building full link graph upfront). However:

- Most users have < 100k transactions, so memory impact is negligible
- Graph building is O(n log n), acceptable performance
- Clearer code architecture outweighs minor memory cost

---

## Implementation Plan (Approach A)

### Phase 1: Core Link Graph (2-3 days)

**Day 1**: Create LinkGraphBuilder

- [ ] Implement Union-Find algorithm
- [ ] Implement `buildLinkGraph()` method
- [ ] Unit tests for graph building
- [ ] Handle edge cases (no links, circular links, rejected links)

**Day 2**: Integrate with PriceEnrichmentService

- [ ] Add TransactionLinkRepository dependency
- [ ] Replace `groupByExchange()` with `buildLinkGraph()`
- [ ] Update `enrichExchangePrices()` to `enrichTransactionGroup()`
- [ ] Ensure backward compatibility (single-tx groups when no links)

**Day 3**: Price Propagation Logic

- [ ] Implement `propagatePricesAcrossLinks()`
- [ ] Match source/target movements by asset and amount
- [ ] Add price source tracking ('link-propagated')
- [ ] Integration tests with real linked transactions

### Phase 2: Testing & Refinement (1-2 days)

**Day 4**: Comprehensive Testing

- [ ] End-to-end tests with Kraken → Bitcoin links
- [ ] Multi-hop link tests (Kraken → Bitcoin → Ethereum)
- [ ] Performance tests with large datasets
- [ ] Edge case tests (partial links, low confidence, etc.)

**Day 5** (Optional): Polish & Documentation

- [ ] Update CLAUDE.md with Phase 2 notes
- [ ] Add logging for link-aware derivation
- [ ] Performance profiling and optimization
- [ ] Code review and refactoring

### Phase 3: User Validation (1 day)

**Day 6**: Real-world Testing

- [ ] Test with actual user data (Kraken + Bitcoin)
- [ ] Verify price propagation accuracy
- [ ] Check gap reduction metrics
- [ ] User feedback and adjustments

---

## Success Metrics

**Quantitative**:

- ✅ Price gap reduction: Target 20-30% fewer gaps for users with cross-platform activity
- ✅ Link utilization: >80% of confirmed links result in price propagation
- ✅ Performance: No more than 20% increase in `prices derive` runtime

**Qualitative**:

- ✅ User reports improved price coverage for blockchain transactions
- ✅ Code maintains high test coverage (>90%)
- ✅ No regressions in existing price derivation

---

## Open Questions

1. **Link Confidence Threshold**: Should we use links with confidence < 95%?
   - **Recommendation**: Only use `confirmed` links (status = 'confirmed') for Phase 2
   - Reasoning: Price propagation should be conservative

2. **Circular Links**: How to handle circular reference detection?
   - **Recommendation**: Union-Find naturally handles this - transactions in cycle end up in same group
   - No special handling needed

3. **Price Source Priority**: When multiple links provide prices, which wins?
   - **Recommendation**: Use earliest timestamp (closest to transaction time)
   - Existing `findClosestPrice()` logic handles this

4. **Link Updates**: What if links change after derivation runs?
   - **Recommendation**: User re-runs `prices derive` after `link` command
   - Document this workflow in CLAUDE.md

---

## Files to Create/Modify

### New Files (~300 LOC)

- `packages/ingestion/src/services/price-enrichment/link-graph-builder.ts`
- `packages/ingestion/src/services/price-enrichment/__tests__/link-graph-builder.test.ts`
- `packages/ingestion/src/services/price-enrichment/types.ts` (TransactionGroup interface)

### Modified Files (~150 LOC changes)

- `packages/ingestion/src/services/price-enrichment/price-enrichment-service.ts`
  - Add LinkGraphBuilder integration
  - Replace `groupByExchange()` with link graph groups
  - Add price propagation logic
- `packages/ingestion/src/services/price-enrichment/__tests__/price-enrichment-service.test.ts`
  - Add link-aware test cases

### Documentation (~100 LOC)

- `CLAUDE.md` - Update workflow to mention link-aware derivation
- `README.md` - Update pipeline diagram
- Issue #111 - Update with implementation notes

---

## Conclusion

**Approach A (Pre-Processing Link Graph) is strongly recommended** for Phase 2 implementation due to:

- Higher success probability (85%)
- Lower implementation risk
- Better code architecture
- Faster time to completion

The Union-Find approach is well-understood, battle-tested, and provides a clean separation between link graph construction and price derivation logic.

**Estimated Timeline**: 4-6 days for full implementation and testing.

**Next Steps**:

1. Get approval for Approach A
2. Create implementation issue/PR
3. Start with LinkGraphBuilder service
4. Iterate with testing and refinement
