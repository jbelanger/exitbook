Detailed Plan: Transaction-Level Dependency Resolution

Estimated Effort: 10-14 hours (including regressions and test hardening)

---

Current State Analysis

Files in Scope

1. lot-matcher.ts - Asset-grouped processing (lines 157-182)
2. lot-matcher-utils.ts - Asset-level topo sort (lines 60-145) + comparator-based tx sort (line 45)
3. lot-matcher.test.ts, lot-matcher-transfers.test.ts - Test updates

Core Problems
┌──────────────────────────┬─────────────────────────────────────────────────┬───────────────────────────────────────────┐
│ Issue │ Location │ Impact │
├──────────────────────────┼─────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ Asset-level grouping │ lot-matcher.ts:157 │ Prevents cross-asset interleaving │
├──────────────────────────┼─────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ Asset-level topo sort │ lot-matcher-utils.ts:70 │ Wrong dependency granularity │
├──────────────────────────┼─────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ Comparator-based sorting │ lot-matcher-utils.ts:45 sortWithLogicalOrdering │ Not true topo sort, can't detect cycles │
├──────────────────────────┼─────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ Late failure │ lot-matcher-utils.ts:1194 │ Cryptic error 100+ lines after root cause │
└──────────────────────────┴─────────────────────────────────────────────────┴───────────────────────────────────────────┘

---

Target Architecture

Dependency Model

Transaction Graph (directed):
Node: Transaction ID
Edge: Link (sourceTransactionId → targetTransactionId)

Invariants: 1. Source tx must be processed before target tx 2. For each tx: outflows before inflows (preserve current logic) 3. Deterministic ordering: topo-sort, tie-break by (timestamp ASC, tx.id ASC)

Processing Flow

// Current (broken):
groupByAsset() → sortAssetGroups() → for each asset { processAssetTxs() }

// Target (correct):
buildTxDependencyGraph(links) → topoSortTransactions() → for each tx { processTx() }

State Management

// Per-asset lot state
const assetLotState = new Map<string, {
lots: Lot[];
disposals: Disposal[];
}>();

// Fast transfer lookup (avoid O(n) scans)
const transfersByLinkId = new Map<number, LotTransfer[]>();

---

Phase 0: Immediate Guardrail (1 hour)

Goal: Fail fast with clear diagnostics when current code hits cycles.

0.1 Add Cycle Detection to Asset-Level Sort

File: lot-matcher-utils.ts (line 134)

// After line 140, replace throw with Result error flow:
if (sorted.length < entries.length) {
const cycleAssets = entries
.map(([id]) => id)
.filter(id => !sorted.includes(id));

    logger.warn(
      { cycleAssets, totalAssets: entries.length, sortedCount: sorted.length },
      'Cross-asset dependency cycle detected in asset-level sort'
    );

    // DON'T throw - return error via Result in caller
    // Store cycle info for caller to handle
    for (const [id] of entries) {
      if (!sorted.includes(id)) {
        sorted.push(id); // Keep appending for now
      }
    }

}

0.2 Update lot-matcher.ts to Handle Cycle Detection

File: lot-matcher.ts (line 161)

const sortedAssetEntries = sortAssetGroupsByDependency([...transactionsByAsset.entries()], confirmedLinks);

// Add cycle detection check
const allAssetIds = new Set([...transactionsByAsset.keys()]);
const sortedAssetIds = new Set(sortedAssetEntries.map(([id]) => id));
if (sortedAssetIds.size < allAssetIds.size) {
const cycleAssets = [...allAssetIds].filter(id => !sortedAssetIds.has(id));
logger.error(
{ cycleAssets },
'Cross-asset dependency cycle detected - bidirectional transfers require transaction-level resolution'
);
return err(
new Error(
`Cross-asset dependency cycle detected between assets: ${cycleAssets.join(' ↔ ')}. ` +
`This indicates bidirectional transfers in the same period. ` +
`Transaction-level dependency resolution is required (not yet implemented).`
)
);
}

0.3 Test Guardrail

File: lot-matcher.test.ts (new test)

it('should detect cross-asset dependency cycles and fail with clear error', async () => {
// Setup bidirectional transfers between two assets
const assetA = 'exchange:kraken:btc';
const assetB = 'blockchain:bitcoin:native';

    // A → B transfer
    const tx1 = createMockTransaction({ id: 1, assetId: assetA, timestamp: new Date('2024-01-01') });
    const tx2 = createMockTransaction({ id: 2, assetId: assetB, timestamp: new Date('2024-01-02') });
    const link1 = { sourceTransactionId: 1, targetTransactionId: 2, sourceAssetId: assetA, targetAssetId: assetB };

    // B → A transfer (creates cycle)
    const tx3 = createMockTransaction({ id: 3, assetId: assetB, timestamp: new Date('2024-01-03') });
    const tx4 = createMockTransaction({ id: 4, assetId: assetA, timestamp: new Date('2024-01-04') });
    const link2 = { sourceTransactionId: 3, targetTransactionId: 4, sourceAssetId: assetB, targetAssetId: assetA };

    const result = await lotMatcher.match([tx1, tx2, tx3, tx4], [link1, link2]);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Cross-asset dependency cycle');
    expect(result._unsafeUnwrapErr().message).toContain(assetA);
    expect(result._unsafeUnwrapErr().message).toContain(assetB);

});

Deliverable: Clear error message instead of cryptic "No lot transfers found" failure.

---

Phase 1: Design & Spike (3 hours)

1.1 Design Transaction-Level Topological Sort

File: lot-matcher-utils.ts (new function, replace sortWithLogicalOrdering)

/\*\*

- Topological sort of transactions by link dependencies using Kahn's algorithm.
-
- Dependencies:
- - Transfer links: sourceTransactionId → targetTransactionId (target depends on source)
- - Intra-transaction: outflows before inflows (for same tx, process outflows first)
-
- Tie-breaking (stable, deterministic):
- 1.  Topological order (dependency-first)
- 2.  Timestamp ASC (chronological)
- 3.  Transaction ID ASC (database insertion order)
-
- Cycle handling:
- - Detects cycles and returns error with explicit cycle path
- - True transaction cycles indicate invalid data (circular transfers impossible)
-
- @returns Result<sorted transactions, error with cycle details>
  \*/
  export function sortTransactionsByDependency(
  transactions: UniversalTransactionData[],
  links: TransactionLink[]
  ): Result<UniversalTransactionData[], Error> {
  // Build dependency graph
  const graph = new Map<number, Set<number>>(); // txId → [dependent txIds]
  const inDegree = new Map<number, number>();
  const txMap = new Map(transactions.map(tx => [tx.id, tx]));

  // Initialize nodes
  for (const tx of transactions) {
  graph.set(tx.id, new Set());
  inDegree.set(tx.id, 0);
  }

  // Add edges from links (source → target)
  for (const link of links) {
  const source = link.sourceTransactionId;
  const target = link.targetTransactionId;

      // Only add edge if both txs in current batch
      if (txMap.has(source) && txMap.has(target) && source !== target) {
        const edges = graph.get(source)!;
        if (!edges.has(target)) {
          edges.add(target);
          inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
        }
      }

  }

  // Kahn's algorithm with deterministic tie-breaking
  const queue: number[] = [];
  for (const [txId, degree] of inDegree.entries()) {
  if (degree === 0) {
  queue.push(txId);
  }
  }

  // Sort queue by (timestamp ASC, txId ASC) for stable ordering
  queue.sort((a, b) => {
  const txA = txMap.get(a)!;
  const txB = txMap.get(b)!;
  const timeCompare = txA.timestamp.getTime() - txB.timestamp.getTime();
  return timeCompare !== 0 ? timeCompare : a - b;
  });

  const sorted: number[] = [];

  while (queue.length > 0) {
  const current = queue.shift()!;
  sorted.push(current);

      // Process neighbors
      for (const neighbor of graph.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0) {
          // Insert maintaining (timestamp, txId) order
          const neighborTx = txMap.get(neighbor)!;
          let insertAt = queue.length;

          for (let i = 0; i < queue.length; i++) {
            const queueTx = txMap.get(queue[i]!)!;
            const timeCompare = neighborTx.timestamp.getTime() - queueTx.timestamp.getTime();
            const shouldInsertHere = timeCompare < 0 || (timeCompare === 0 && neighbor < queue[i]!);

            if (shouldInsertHere) {
              insertAt = i;
              break;
            }
          }

          queue.splice(insertAt, 0, neighbor);
        }
      }

  }

  // Detect cycles
  if (sorted.length < transactions.length) {
  const cycleNodes = transactions
  .map(tx => tx.id)
  .filter(id => !sorted.includes(id));

      // Find cycle path for better diagnostics
      const cyclePath = findCyclePath(cycleNodes, graph);

      logger.error(
        { cycleNodes, cyclePath, totalTxs: transactions.length, sortedCount: sorted.length },
        'Transaction dependency cycle detected'
      );

      return err(
        new Error(
          `Transaction dependency cycle detected: ${cyclePath.join(' → ')}. ` +
          `This indicates circular transfer relationships, which should not exist in valid data. ` +
          `Check transaction links for data integrity issues.`
        )
      );

  }

  // Return sorted transactions
  return ok(sorted.map(id => txMap.get(id)!));

}

/\*\*

- Find a cycle path for diagnostic purposes using DFS.
  \*/
  function findCyclePath(
  cycleNodes: number[],
  graph: Map<number, Set<number>>
  ): number[] {
  const visited = new Set<number>();
  const recStack = new Set<number>();
  const path: number[] = [];

  function dfs(node: number): boolean {
  visited.add(node);
  recStack.add(node);
  path.push(node);

      for (const neighbor of graph.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          // Found cycle - trim path to just the cycle
          const cycleStart = path.indexOf(neighbor);
          path.splice(0, cycleStart);
          path.push(neighbor); // Close the cycle
          return true;
        }
      }

      recStack.delete(node);
      path.pop();
      return false;

  }

  for (const node of cycleNodes) {
  if (!visited.has(node)) {
  if (dfs(node)) return path;
  }
  }

  return cycleNodes; // Fallback if DFS doesn't find cycle

}

1.2 Design Intra-Transaction Outflow/Inflow Ordering

Current invariant: For each transaction, outflows are processed before inflows.

Question: How to preserve this in global sort?

Solution: Expand each transaction into two virtual nodes:

- tx\_${id}\_outflows (processed first)
- tx\_${id}\_inflows (processed second, depends on outflows)

Alternative (simpler): Process each transaction in two phases within single loop:
for (const tx of sortedTransactions) {
// Phase 1: Process outflows
processOutflows(tx);

    // Phase 2: Process inflows (may depend on other tx outflows via links)
    processInflows(tx);

}

Decision: Use two-phase approach within loop (simpler, preserves current logic structure).

1.3 Design Fast Transfer Lookup

Current: lotTransfers.filter(t => t.linkId === link.id) (O(n) scan per link)

Target: transfersByLinkId.get(link.id) (O(1) lookup)

// Build index after each transfer creation
const transfersByLinkId = new Map<number, LotTransfer[]>();

function recordLotTransfer(transfer: LotTransfer): void {
sharedLotTransfers.push(transfer);

    // Index by linkId for fast lookup
    const existing = transfersByLinkId.get(transfer.linkId) ?? [];
    existing.push(transfer);
    transfersByLinkId.set(transfer.linkId, existing);

}

// Later, in processTransferTarget:
const transfers = transfersByLinkId.get(link.id) ?? [];
if (transfers.length === 0) {
return err(new Error(`No lot transfers found for link ${link.id}...`));
}

1.4 Spike: Write Minimal Prototype

Goal: Validate core logic before full refactor.

Test case: Two-asset bidirectional transfer (the failing case).

Prototype in: lot-matcher-utils.test.ts

describe('sortTransactionsByDependency', () => {
it('should handle cross-asset bidirectional transfers', () => {
const tx1 = { id: 1, timestamp: new Date('2024-01-01T10:00:00Z'), assetId: 'A' }; // A sends
const tx2 = { id: 2, timestamp: new Date('2024-01-01T11:00:00Z'), assetId: 'B' }; // B receives (depends on tx1)
const tx3 = { id: 3, timestamp: new Date('2024-01-01T12:00:00Z'), assetId: 'B' }; // B sends
const tx4 = { id: 4, timestamp: new Date('2024-01-01T13:00:00Z'), assetId: 'A' }; // A receives (depends on tx3)

      const link1 = { sourceTransactionId: 1, targetTransactionId: 2 }; // A → B
      const link2 = { sourceTransactionId: 3, targetTransactionId: 4 }; // B → A

      const result = sortTransactionsByDependency([tx1, tx2, tx3, tx4], [link1, link2]);

      expect(result.isOk()).toBe(true);
      const sorted = result._unsafeUnwrap();

      // Expected order: tx1 (no deps) → tx2 (depends on tx1) → tx3 (no deps after tx2) → tx4 (depends on tx3)
      expect(sorted.map(tx => tx.id)).toEqual([1, 2, 3, 4]);
    });

    it('should detect true transaction cycles', () => {
      const tx1 = { id: 1, timestamp: new Date('2024-01-01'), assetId: 'A' };
      const tx2 = { id: 2, timestamp: new Date('2024-01-02'), assetId: 'B' };

      // Circular dependency (should never happen in valid data)
      const link1 = { sourceTransactionId: 1, targetTransactionId: 2 };
      const link2 = { sourceTransactionId: 2, targetTransactionId: 1 }; // Creates cycle

      const result = sortTransactionsByDependency([tx1, tx2], [link1, link2]);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('dependency cycle');
      expect(result._unsafeUnwrapErr().message).toContain('1 → 2 → 1'); // Cycle path
    });

});

Deliverable: Working sortTransactionsByDependency function with tests.

---

Phase 2: Core Implementation (6-8 hours)

2.1 Refactor lot-matcher.ts Processing Loop

File: lot-matcher.ts (lines 150-190)

Before (asset-grouped):
// Group by asset
const transactionsByAsset = new Map<string, { assetSymbol, transactions }>();
// ... grouping logic ...

// Sort asset groups
const sortedAssetEntries = sortAssetGroupsByDependency([...transactionsByAsset.entries()], confirmedLinks);

// Process each asset
const sharedLotTransfers: LotTransfer[] = [];
for (const [assetId, { assetSymbol, transactions }] of sortedAssetEntries) {
const result = await this.matchAsset(assetId, assetSymbol, transactions, config, linkIndex, sharedLotTransfers);
// ...
}

After (transaction-level):
// Sort all transactions by dependency
const sortResult = sortTransactionsByDependency(transactions, confirmedLinks);
if (sortResult.isErr()) {
return err(sortResult.error); // Bubble up cycle detection errors
}
const sortedTransactions = sortResult.value;

// Group by asset for state management (but don't process by group)
const assetLotState = new Map<string, {
assetSymbol: string;
lots: Lot[];
disposals: Disposal[];
}>();

// Initialize state for each asset
for (const tx of sortedTransactions) {
if (!assetLotState.has(tx.assetId)) {
assetLotState.set(tx.assetId, {
assetSymbol: tx.symbol,
lots: [],
disposals: []
});
}
}

// Shared structures
const sharedLotTransfers: LotTransfer[] = [];
const transfersByLinkId = new Map<number, LotTransfer[]>(); // Fast lookup index

// Process each transaction in dependency order
for (const tx of sortedTransactions) {
const assetState = assetLotState.get(tx.assetId)!;

    const result = await this.matchTransaction(
      tx,
      assetState,
      config,
      linkIndex,
      sharedLotTransfers,
      transfersByLinkId
    );

    if (result.isErr()) {
      return err(result.error);
    }

}

// Calculate totals per asset
const assetResults: AssetLotMatchResult[] = [];
for (const [assetId, state] of assetLotState.entries()) {
assetResults.push({
assetId,
assetSymbol: state.assetSymbol,
lots: state.lots,
disposals: state.disposals,
// ... totals calculation ...
});
}

2.2 Implement matchTransaction()

File: lot-matcher.ts (new method)

/\*\*

- Process a single transaction in dependency order.
-
- Two-phase processing:
- 1.  Outflows (creates lots/disposals, may create lot transfers)
- 2.  Inflows (consumes lot transfers from other transactions)
      \*/
      private async matchTransaction(
      tx: UniversalTransactionData,
      assetState: { assetSymbol: string; lots: Lot[]; disposals: Disposal[] },
      config: LotMatchingConfig,
      linkIndex: LinkIndex,
      sharedLotTransfers: LotTransfer[],
      transfersByLinkId: Map<number, LotTransfer[]>
      ): Promise<Result<void, Error>> {
      const logger = getLogger('lot-matcher:matchTransaction');

  // Phase 1: Process outflows first (may create lot transfers)
  const outflowResult = await this.processOutflows(
  tx,
  assetState,
  config,
  linkIndex,
  sharedLotTransfers,
  transfersByLinkId
  );

  if (outflowResult.isErr()) {
  return err(outflowResult.error);
  }

  // Phase 2: Process inflows (may consume lot transfers from earlier txs)
  const inflowResult = await this.processInflows(
  tx,
  assetState,
  config,
  linkIndex,
  transfersByLinkId
  );

  if (inflowResult.isErr()) {
  return err(inflowResult.error);
  }

  return ok(undefined);

}

/\*\*

- Process outflows: disposals, transfer-outs.
- Creates lot transfers for confirmed transfer-outs.
  \*/
  private async processOutflows(
  tx: UniversalTransactionData,
  assetState: { lots: Lot[]; disposals: Disposal[] },
  config: LotMatchingConfig,
  linkIndex: LinkIndex,
  sharedLotTransfers: LotTransfer[],
  transfersByLinkId: Map<number, LotTransfer[]>
  ): Promise<Result<void, Error>> {
  // Extract current logic from matchAsset for outflows
  // - Process disposals (sales, sends, fees)
  // - Process transfer-outs (if confirmed link exists)
  // - Create lot transfers and index them

  // ... implementation follows current matchAsset outflow logic ...

  // When creating lot transfer:
  const recordTransfer = (transfer: LotTransfer) => {
  sharedLotTransfers.push(transfer);
  const existing = transfersByLinkId.get(transfer.linkId) ?? [];
  existing.push(transfer);
  transfersByLinkId.set(transfer.linkId, existing);
  };

  return ok(undefined);

}

/\*\*

- Process inflows: acquisitions, transfer-ins.
- Consumes lot transfers from earlier processed transactions.
  \*/
  private async processInflows(
  tx: UniversalTransactionData,
  assetState: { lots: Lot[]; disposals: Disposal[] },
  config: LotMatchingConfig,
  linkIndex: LinkIndex,
  transfersByLinkId: Map<number, LotTransfer[]>
  ): Promise<Result<void, Error>> {
  // Extract current logic from matchAsset for inflows
  // - Process acquisitions (buys, receives)
  // - Process transfer-ins (consume lot transfers)

  // When looking up transfers:
  const transfers = transfersByLinkId.get(link.id) ?? [];
  if (transfers.length === 0) {
  return err(new Error(`No lot transfers found for link ${link.id}...`));
  }

  return ok(undefined);

}

2.3 Extract Business Logic from matchAsset

Current: matchAsset() contains ~200 lines of mixed concerns.

Target: Split into:

- matchTransaction() - orchestration (calls processOutflows/processInflows)
- processOutflows() - outflow logic (disposals, transfer-outs)
- processInflows() - inflow logic (acquisitions, transfer-ins)
- Move pure functions to lot-matcher-utils.ts

Approach: Incremental extraction, preserve existing tests.

2.4 Remove Obsolete Asset-Level Code

Delete:

- sortAssetGroupsByDependency() in lot-matcher-utils.ts (lines 60-145)
- Asset grouping logic in lot-matcher.ts (lines 157-161)

Keep (refactor):

- matchAsset() → matchTransaction() (logic extraction)

  2.5 Update processTransferTarget

File: lot-matcher-utils.ts (lines 1192-1209)

Change: Use indexed lookup instead of filter.

// Before:
const transfers = lotTransfers.filter((t) => t.linkId === link.id);

// After (passed as parameter):
const transfers = transfersByLinkId.get(link.id) ?? [];

Update function signature:
export function processTransferTarget(
tx: UniversalTransactionData,
link: TransactionLink,
transfersByLinkId: Map<number, LotTransfer[]>, // NEW: indexed lookup
config: { variance: { error: number; warn: number } },
warnings: TransferWarning[]
): Result<Lot[], Error>

---

Phase 3: Testing & Hardening (3 hours)

3.1 Update Existing Tests

Files:

- lot-matcher.test.ts - Update mocks, expectations
- lot-matcher-transfers.test.ts - Update cross-asset transfer tests
- lot-matcher-utils.test.ts - Add sortTransactionsByDependency tests

Changes:

- Replace asset-grouped expectations with transaction-level
- Update mock setup (may need more transactions for dependency tests)
- Ensure all existing scenarios still pass

  3.2 Add Cross-Asset Cycle Tests

File: lot-matcher.test.ts (new describe block)

describe('Cross-asset dependency handling', () => {
it('should handle bidirectional transfers (deposit + withdrawal)', async () => {
// Setup: User deposits BTC to exchange, then withdraws
const depositToExchange = createMockTransaction({
id: 1,
assetId: 'blockchain:bitcoin:native',
type: 'send',
netAmount: '-1.0',
timestamp: new Date('2024-01-01T10:00:00Z')
});

      const receiveAtExchange = createMockTransaction({
        id: 2,
        assetId: 'exchange:kraken:btc',
        type: 'receive',
        netAmount: '1.0',
        timestamp: new Date('2024-01-01T10:30:00Z')
      });

      const withdrawFromExchange = createMockTransaction({
        id: 3,
        assetId: 'exchange:kraken:btc',
        type: 'send',
        netAmount: '-0.5',
        timestamp: new Date('2024-01-02T14:00:00Z')
      });

      const receiveAtWallet = createMockTransaction({
        id: 4,
        assetId: 'blockchain:bitcoin:native',
        type: 'receive',
        netAmount: '0.5',
        timestamp: new Date('2024-01-02T14:30:00Z')
      });

      const link1 = createMockLink({
        id: 1,
        sourceTransactionId: 1,
        targetTransactionId: 2,
        sourceAssetId: 'blockchain:bitcoin:native',
        targetAssetId: 'exchange:kraken:btc'
      });

      const link2 = createMockLink({
        id: 2,
        sourceTransactionId: 3,
        targetTransactionId: 4,
        sourceAssetId: 'exchange:kraken:btc',
        targetAssetId: 'blockchain:bitcoin:native'
      });

      const result = await lotMatcher.match(
        [depositToExchange, receiveAtExchange, withdrawFromExchange, receiveAtWallet],
        [link1, link2]
      );

      expect(result.isOk()).toBe(true);
      const matchResult = result._unsafeUnwrap();

      // Validate lots created correctly
      const blockchainLots = matchResult.assetResults.find(r => r.assetId === 'blockchain:bitcoin:native')?.lots;
      const exchangeLots = matchResult.assetResults.find(r => r.assetId === 'exchange:kraken:btc')?.lots;

      expect(blockchainLots).toHaveLength(1); // 0.5 BTC remaining after withdrawal
      expect(exchangeLots).toHaveLength(1); // 0.5 BTC remaining at exchange
    });

    it('should detect true transaction cycles and fail', async () => {
      // Setup: Impossible scenario - tx1 depends on tx2, tx2 depends on tx1
      const tx1 = createMockTransaction({ id: 1, assetId: 'A' });
      const tx2 = createMockTransaction({ id: 2, assetId: 'B' });

      const link1 = createMockLink({ sourceTransactionId: 1, targetTransactionId: 2 });
      const link2 = createMockLink({ sourceTransactionId: 2, targetTransactionId: 1 }); // Cycle!

      const result = await lotMatcher.match([tx1, tx2], [link1, link2]);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Transaction dependency cycle');
      expect(result._unsafeUnwrapErr().message).toMatch(/1.*2.*1/); // Cycle path includes both
    });

    it('should handle complex multi-asset dependency chains', async () => {
      // A → B → C → D (linear chain across 4 assets)
      // Validates proper ordering and lot transfer propagation

      // ... implementation ...
    });

    it('should preserve timestamp ordering when no dependencies', async () => {
      // Multiple transactions with no links, should process chronologically

      // ... implementation ...
    });

});

3.3 Add Performance Test

File: lot-matcher.test.ts

describe('Performance', () => {
it('should handle 1000 transactions efficiently', async () => {
// Generate 1000 transactions across 10 assets with random dependencies
const txCount = 1000;
const assetCount = 10;
const linkCount = 200;

      const { transactions, links } = generateLargeDataset(txCount, assetCount, linkCount);

      const startTime = Date.now();
      const result = await lotMatcher.match(transactions, links);
      const duration = Date.now() - startTime;

      expect(result.isOk()).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

      console.log(`Processed ${txCount} transactions in ${duration}ms`);
    });

});

3.4 Regression Testing

Run full test suite:
pnpm test packages/accounting/src/services/lot-matcher

Check for:

- No broken tests (all existing scenarios still pass)
- No performance regressions (compare before/after times)
- Coverage maintained (aim for 90%+)

  3.5 Integration Testing

Test with real data:

# Import real exchange data

pnpm run dev import --exchange kraken --csv-dir ./test-data/kraken

# Run lot matching

pnpm run dev reprocess

# Verify no errors in output

Validate:

- No "dependency cycle" errors on valid data
- Lot transfers correctly matched across assets
- Balance reconciliation still works

---

Risk Analysis
┌────────────────────────────────┬──────────────────────────────────────────────────────────────────────────┬────────────┐
│ Risk │ Mitigation │ Owner │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┼────────────┤
│ State management bugs │ Incremental refactor, preserve existing tests, add new state tests │ Dev │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┼────────────┤
│ Performance regression │ Add performance test, profile before/after, optimize if needed │ Dev │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┼────────────┤
│ Breaking existing logic │ Keep business logic intact, only change orchestration │ Dev │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┼────────────┤
│ True cycles in production data │ Log warnings, fail gracefully with diagnostics, investigate data quality │ Dev + Data │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┼────────────┤
│ Scope creep │ Time-box to 14h, defer optimizations to future PRs │ Dev │
└────────────────────────────────┴──────────────────────────────────────────────────────────────────────────┴────────────┘

---

Success Criteria

Functional

- Bidirectional cross-asset transfers work (deposit + withdrawal scenario)
- Transaction-level topological sort handles complex dependencies
- Cycle detection fails fast with clear error messages (no exceptions, use Result)
- All existing tests pass without modification to business logic
- Fast transfer lookup (O(1) instead of O(n))

Non-Functional

- No performance regression (< 10% slower on existing benchmarks)
- Code is more maintainable (clearer separation of concerns)
- Error messages are actionable (include cycle paths, transaction IDs)
- Logging includes relevant context (cycle nodes, dependency graph size)

Completeness

- Phase 0 guardrail deployed (immediate value)
- Transaction-level sort implemented and tested
- lot-matcher.ts refactored to use new sort
- Obsolete asset-level code removed
- Documentation updated (ADR if significant architectural change)

---

Timeline
┌─────────┬────────┬───────────────────────────────────────────────┐
│ Phase │ Hours │ Deliverable │
├─────────┼────────┼───────────────────────────────────────────────┤
│ Phase 0 │ 1h │ Guardrail deployed, clear cycle errors │
├─────────┼────────┼───────────────────────────────────────────────┤
│ Phase 1 │ 3h │ Design doc, spike prototype, tests green │
├─────────┼────────┼───────────────────────────────────────────────┤
│ Phase 2 │ 6-8h │ Core refactor complete, manual testing passes │
├─────────┼────────┼───────────────────────────────────────────────┤
│ Phase 3 │ 3h │ Full test suite green, regression tests pass │
├─────────┼────────┼───────────────────────────────────────────────┤
│ Buffer │ 2h │ Bug fixes, polish, documentation │
├─────────┼────────┼───────────────────────────────────────────────┤
│ Total │ 12-14h │ Production-ready, no regressions │
└─────────┴────────┴───────────────────────────────────────────────┘

---

Next Steps

1. Approve plan - Review and confirm approach
2. Phase 0 - Immediate guardrail (can deploy today)
3. Phase 1 - Design spike (validate assumptions)
4. Phase 2 - Core implementation (focused, incremental)
5. Phase 3 - Testing and hardening (confidence)
6. Deploy - Gradual rollout, monitor production
