# ADR 004: Treat Linked Transfers as Non-Taxable Events

**Date**: 2025-11-03
**Status**: Proposed
**Deciders**: Joel Belanger (maintainer)
**Tags**: cost-basis, taxation, transfers, transaction-linking

---

**Prerequisites**: This ADR builds on ADR003 (Unified Price and FX Rate Enrichment Architecture). All external fees are assumed to have USD-normalized prices with FX metadata populated by the enrichment pipeline.

---

## Context and Problem Statement

The cost basis calculator currently treats all asset movements as taxable events. When a user transfers cryptocurrency between their own accounts (exchange → wallet, wallet → wallet, wallet → exchange), the system incorrectly:

1. Creates a **taxable disposal** at the source (triggering phantom capital gains/losses)
2. Creates a **new acquisition** at the target (breaking the cost basis chain)

This violates tax regulations in most jurisdictions, where self-to-self transfers are **non-taxable movements**.

### Example Problem

```
Jan 1:  Buy 1 BTC @ $50,000 on Kraken
        ✅ Cost basis: $50,000 total

Feb 1:  Withdraw 1 BTC from Kraken (BTC @ $60,000)
        Network fee: 0.0005 BTC
        Platform fee: $1.50

        ❌ CURRENT BEHAVIOR:
        - Disposal: 1 BTC @ $60,000 = $60,000 proceeds
        - Capital gain: $10,000 (WRONG!)
        - New acquisition: 0.9995 BTC @ $60,000 (WRONG!)

        ✅ CORRECT BEHAVIOR (US/disposal policy):
        - Transfer: 0.9995 BTC (non-taxable, inherits $49,975 basis)
        - Fee disposal: 0.0005 BTC @ $60,000 = $30 proceeds, $25 cost basis, $5 gain (taxable)
        - New lot: 0.9995 BTC with $49,976.50 total basis ($49,975 + $1.50 fiat fee)
        - Per-unit basis: $50,001.50/BTC
```

### Tax Compliance Requirements

**United States (IRS)**: Transfers between own wallets are not taxable. Network fees paid in crypto are taxable disposals.

**Canada (CRA)**: Self-transfers are not dispositions. Fees may be added to cost basis or treated as disposals.

**United Kingdom (HMRC)**: Self-transfers are not disposals for CGT. Fees paid in crypto may constitute disposals.

**European Union**: Most member states treat self-to-self transfers as non-taxable.

### Existing Infrastructure

The system already has the necessary components:

- **Transaction Linking** (`packages/accounting/src/linking/`) - Detects related transactions with confidence scoring
- **Lot Matcher** (`packages/accounting/src/services/lot-matcher.ts`) - Chronologically processes transactions, creates lots and disposals

**What's missing**:

- `transaction_links` table lacks `asset`, `source_amount`, `target_amount` columns needed for reconciliation
- Lot matcher doesn't consult transaction links to identify transfers

---

## User Mental Model

From a user's perspective, the workflow is straightforward:

1. **Import transactions** from exchanges and blockchains
2. **Review suggested links** between related transactions (withdrawals and deposits)
3. **Confirm or reject links** based on whether they represent the same funds moving
4. **Calculate cost basis** - The system automatically:
   - Treats confirmed links as non-taxable transfers (preserves original cost basis)
   - Treats unlinked movements as taxable sales/purchases
   - Only taxes the fees paid during transfers

Users don't need to understand complex transfer logic. They simply link transactions that represent the same money moving between their accounts and get correct tax treatment.

---

## Decision

We will extend the existing lot matcher to be **transfer-aware** by consulting confirmed transaction links during chronological processing. Transfers are treated as non-taxable movements that preserve cost basis, while fees are properly handled as taxable disposals or cost basis adjustments.

### Core Principles

1. **Lazy Processing**: Check links during lot matching (no pre-computation)
2. **Logical Ordering**: Process linked transactions in logical order (source before target) regardless of timestamps
3. **One Link = One Transfer**: Multi-hop is just sequential transfers, not a special case
4. **No Transaction Skipping**: Process all transactions to preserve inventory and holding periods
5. **Gross Outflow Model**: Links reference gross outflow amounts; fees are extracted from fee metadata
6. **Minimal Persistence**: Single `lot_transfers` table tracks cost basis flow
7. **Cost Basis Preservation**: Original cost basis flows through transfers via lot references
8. **Jurisdiction-Aware Fee Handling**: Configurable tax treatment of same-asset transfer fees
9. **Fee Taxonomy**:
   - **Crypto fees** (same asset): Disposal or added to basis (jurisdiction-dependent)
   - **External fees** (fiat): Added to target cost basis from both source and target transactions
   - **Third-asset fees** (e.g., BNB for BTC): Separate outflows → disposals
10. **Link Quality**: Only confirmed links ≥95% confidence used
11. **Graduated Reconciliation**: Configurable variance tolerance with warnings for moderate mismatches
12. **Graceful Degradation**: Calculate what's possible, report missing prices clearly

---

## Architecture

### Data Model

Transaction structure (gross outflow model):

```typescript
// Withdrawal transaction: 1 BTC total deducted
{
  id: 100,
  movements: {
    outflows: [
      { asset: 'BTC', amount: 1.0 }  // GROSS amount (includes fee)
    ]
  },
  fees: {
    network: { asset: 'BTC', amount: 0.0005 },  // Fee metadata
    platform: { asset: 'USD', amount: 1.5 }     // External fee
  }
}

// Deposit transaction: 0.9995 BTC received
{
  id: 101,
  movements: {
    inflows: [
      { asset: 'BTC', amount: 0.9995 }  // Net received (after on-chain fee)
    ]
  }
}

// Link connects gross outflow to net inflow
TransactionLink {
  sourceTransactionId: 100,
  targetTransactionId: 101,
  sourceAmount: 1.0,      // Gross outflow
  targetAmount: 0.9995,   // Net inflow
  asset: 'BTC'
}
```

**Key insight**: The difference (1.0 - 0.9995 = 0.0005) is the on-chain fee, which should match `fees.network.amount`.

### Database Schema

**Updated table: `transaction_links`** (CRITICAL - Required for reconciliation logic)

```sql
ALTER TABLE transaction_links ADD COLUMN asset TEXT NOT NULL;
ALTER TABLE transaction_links ADD COLUMN source_amount TEXT NOT NULL; -- Gross outflow amount
ALTER TABLE transaction_links ADD COLUMN target_amount TEXT NOT NULL; -- Net received amount

-- Add index for link lookup by source
CREATE INDEX idx_transaction_links_source ON transaction_links(source_transaction_id, asset, source_amount);

-- Add index for link lookup by target
CREATE INDEX idx_transaction_links_target ON transaction_links(target_transaction_id, asset);
```

**Rationale**: The LinkIndex requires `asset` and `source_amount` for O(1) lookups during lot matching. The `target_amount` is needed for graduated tolerance validation during reconciliation.

**TypeScript interface** (after migration):

```typescript
interface TransactionLinksTable {
  id: string;
  source_transaction_id: number;
  target_transaction_id: number;
  asset: string; // NEW - transferred asset symbol
  source_amount: DecimalString; // NEW - gross outflow amount
  target_amount: DecimalString; // NEW - net received amount
  link_type: 'exchange_to_blockchain' | 'blockchain_to_blockchain' | 'exchange_to_exchange';
  confidence_score: DecimalString;
  match_criteria_json: JSONString;
  status: 'suggested' | 'confirmed' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: DateTime | null;
  created_at: DateTime;
  updated_at: DateTime;
  metadata_json: JSONString | null;
}
```

**New table: `lot_transfers`**

```sql
CREATE TABLE lot_transfers (
  id TEXT PRIMARY KEY,
  calculation_id TEXT NOT NULL REFERENCES cost_basis_calculations(id) ON DELETE CASCADE,
  source_lot_id TEXT NOT NULL REFERENCES acquisition_lots(id),
  link_id TEXT NOT NULL REFERENCES transaction_links(id),

  quantity_transferred TEXT NOT NULL,
  cost_basis_per_unit TEXT NOT NULL,

  source_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  target_transaction_id INTEGER NOT NULL REFERENCES transactions(id),

  metadata_json TEXT, -- Stores jurisdiction-specific data (e.g., cryptoFeeUsdValue for add-to-basis)

  created_at TEXT NOT NULL,

  CONSTRAINT lot_transfers_quantity_positive CHECK (
    CAST(quantity_transferred AS REAL) > 0
  )
);

CREATE INDEX idx_lot_transfers_link ON lot_transfers(link_id);
CREATE INDEX idx_lot_transfers_calculation ON lot_transfers(calculation_id);
CREATE INDEX idx_lot_transfers_source_lot ON lot_transfers(source_lot_id);
```

**Example metadata for add-to-basis policy:**

```json
{
  "cryptoFeeUsdValue": "30.00"
}
```

**Updated table: `lot_disposals`**

```sql
ALTER TABLE lot_disposals ADD COLUMN metadata_json TEXT;

-- Example metadata for transfer fee disposal:
-- { "transferFee": true, "linkId": "uuid", "feeType": "network" | "platform" | "third_asset" }
```

### Link Index (In-Memory Lookup)

Build a simple index at the start of lot matching:

```typescript
/**
 * In-memory index for O(1) link lookups during lot matching
 *
 * Handles multiple links per (txId, asset, amount) for batched withdrawals
 */
class LinkIndex {
  // Array of links per key to handle batched withdrawals (e.g., 2 × 1 BTC)
  private sourceMap = new Map<string, TransactionLink[]>();
  private targetMap = new Map<string, TransactionLink[]>(); // Also array for multiple inflows

  constructor(links: TransactionLink[]) {
    for (const link of links) {
      // Source: match on txId, asset, AND amount
      const sourceKey = this.buildSourceKey(link.sourceTransactionId, link.asset, link.sourceAmount);

      const existingSource = this.sourceMap.get(sourceKey) ?? [];
      existingSource.push(link);
      this.sourceMap.set(sourceKey, existingSource);

      // Target: match on txId and asset (array to handle multiple inflows of same asset)
      const targetKey = `${link.targetTransactionId}:${link.asset}`;
      const existingTarget = this.targetMap.get(targetKey) ?? [];
      existingTarget.push(link);
      this.targetMap.set(targetKey, existingTarget);
    }
  }

  private buildSourceKey(txId: number, asset: string, amount: Decimal): string {
    return `${txId}:${asset}:${amount.toFixed()}`;
  }

  /**
   * Find next unconsumed link for source outflow
   *
   * Returns single link (first match) to ensure one outflow processes one link
   */
  findBySource(txId: number, asset: string, amount: Decimal): TransactionLink | null {
    const key = this.buildSourceKey(txId, asset, amount);
    const links = this.sourceMap.get(key) ?? [];
    return links[0] ?? null; // Return first unconsumed link
  }

  /**
   * Find next unconsumed link for target inflow
   *
   * Returns single link (first match) to ensure one inflow processes one link
   */
  findByTarget(txId: number, asset: string): TransactionLink | null {
    const key = `${txId}:${asset}`;
    const links = this.targetMap.get(key) ?? [];
    return links[0] ?? null; // Return first unconsumed link
  }

  /**
   * Mark a link as consumed from source side
   *
   * Only removes from source map; target map remains for inflow processing
   */
  consumeSourceLink(link: TransactionLink): void {
    const sourceKey = this.buildSourceKey(link.sourceTransactionId, link.asset, link.sourceAmount);
    const sourceLinks = this.sourceMap.get(sourceKey) ?? [];
    const filteredSource = sourceLinks.filter((l) => l.id !== link.id);

    if (filteredSource.length === 0) {
      this.sourceMap.delete(sourceKey);
    } else {
      this.sourceMap.set(sourceKey, filteredSource);
    }
  }

  /**
   * Mark a link as consumed from target side
   *
   * Only removes from target map; source already processed
   */
  consumeTargetLink(link: TransactionLink): void {
    const targetKey = `${link.targetTransactionId}:${link.asset}`;
    const targetLinks = this.targetMap.get(targetKey) ?? [];
    const filteredTarget = targetLinks.filter((l) => l.id !== link.id);

    if (filteredTarget.length === 0) {
      this.targetMap.delete(targetKey);
    } else {
      this.targetMap.set(targetKey, filteredTarget);
    }
  }
}
```

**Key features**:

- Both source and target maps use arrays to handle multiple movements
- Returns single link (first unconsumed) to ensure one outflow processes one link
- `consumeSourceLink()` removes from source map only (called after outflow processing)
- `consumeTargetLink()` removes from target map only (called after inflow processing)
- Link remains in target map until inflow is processed (preserves chronological flow)
- Handles batched withdrawals: each outflow consumes one link sequentially

### Transfer-Aware Lot Matcher

Extend existing `LotMatcher.match()` to check links:

```typescript
class TransferAwareLotMatcher {
  async match(
    transactions: UniversalTransaction[],
    config: LotMatcherConfig,
    calculationId: string
  ): Promise<Result<LotMatchResult, Error>> {
    // Load confirmed links once (≥95% confidence)
    const confirmedLinksResult = await this.linkRepo.findConfirmed();
    if (confirmedLinksResult.isErr()) return err(confirmedLinksResult.error);

    const linkIndex = new LinkIndex(confirmedLinksResult.value);

    const lots: AcquisitionLot[] = [];
    const disposals: LotDisposal[] = [];
    const lotTransfers: LotTransfer[] = [];

    // Sort transactions with link-aware ordering
    // Ensures source transactions process before their linked targets
    const sorted = this.sortTransactionsWithLogicalOrdering(transactions, confirmedLinksResult.value);

    for (const tx of sorted) {
      // Process each outflow
      for (const outflow of tx.movements.outflows) {
        const link = linkIndex.findBySource(tx.id, outflow.asset, outflow.amount);

        if (link) {
          // TRANSFER: Process this link (one outflow → one link)
          const result = await this.handleTransferSource(tx, outflow, link, lots, config, calculationId);
          if (result.isErr()) return err(result.error);
          lotTransfers.push(...result.value);

          // Mark link as consumed from source side only
          // Target map still has it for inflow processing
          linkIndex.consumeSourceLink(link);
        } else {
          // DISPOSAL: Normal sale or third-asset fee (taxable)
          const result = await this.handleDisposal(tx, outflow, lots, config);
          if (result.isErr()) return err(result.error);
          disposals.push(...result.value);
        }
      }

      // Process each inflow
      for (const inflow of tx.movements.inflows) {
        const link = linkIndex.findByTarget(tx.id, inflow.asset);

        if (link) {
          // TRANSFER RECEIPT: Create lot with inherited basis
          const result = await this.handleTransferTarget(tx, inflow, link, lotTransfers, config);
          if (result.isErr()) return err(result.error);
          lots.push(result.value);

          // Mark link as consumed from target side
          // (source already consumed during outflow processing)
          linkIndex.consumeTargetLink(link);
        } else {
          // ACQUISITION: Normal purchase
          const result = await this.handleAcquisition(tx, inflow, config);
          if (result.isErr()) return err(result.error);
          lots.push(result.value);
        }
      }
    }

    return ok({ lots, disposals, lotTransfers });
  }

  /**
   * Sort transactions with link-aware logical ordering
   *
   * Handles timestamp inconsistencies by ensuring linked source
   * transactions are processed before their targets
   */
  private sortTransactionsWithLogicalOrdering(
    transactions: UniversalTransaction[],
    links: TransactionLink[]
  ): UniversalTransaction[] {
    // Build dependency graph: target → source
    const mustProcessAfter = new Map<number, Set<number>>();

    for (const link of links) {
      const existing = mustProcessAfter.get(link.targetTransactionId) ?? new Set();
      existing.add(link.sourceTransactionId);
      mustProcessAfter.set(link.targetTransactionId, existing);
    }

    // Topological sort with chronological tie-breaking
    const sorted = [...transactions].sort((a, b) => {
      // Check if there's a dependency relationship
      const aAfterB = mustProcessAfter.get(a.id)?.has(b.id);
      const bAfterA = mustProcessAfter.get(b.id)?.has(a.id);

      if (aAfterB) return 1; // a depends on b → b comes first
      if (bAfterA) return -1; // b depends on a → a comes first

      // No dependency → chronological order (existing behavior)
      return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
    });

    return sorted;
  }
}
```

**Key insight**: Real-world exchange data often has timestamp inconsistencies (clock skew, backdated deposits, etc.). The logical ordering ensures correctness regardless of timestamps while maintaining chronological order for unlinked transactions.

### Transfer Source Handling

When an outflow matches a link, extract fee and create lot transfers + fee disposal:

```typescript
private async handleTransferSource(
  tx: UniversalTransaction,
  outflow: AssetMovement,
  link: TransactionLink,
  lots: AcquisitionLot[],
  config: LotMatcherConfig,
  calculationId: string
): Promise<Result<LotTransfer[], Error>> {

  // Extract fee from transaction metadata
  const cryptoFeeResult = this.extractCryptoFee(tx, outflow.asset);
  if (cryptoFeeResult.isErr()) return err(cryptoFeeResult.error);

  const cryptoFee = cryptoFeeResult.value;

  // Calculate net transfer amount (gross - fee)
  const netTransferAmount = outflow.amount.minus(cryptoFee.amount);

  // Validate reconciliation with link using graduated tolerance
  const variance = netTransferAmount.minus(link.targetAmount).abs();
  const variancePct = netTransferAmount.isZero()
    ? new Decimal(0)
    : variance.div(netTransferAmount).times(100);

  // Get tolerance for this source (exchange-specific)
  const tolerance = this.getVarianceTolerance(tx.source, config);

  if (variancePct.gt(tolerance.error)) {
    return err(new Error(
      `Transfer amount mismatch at source tx ${tx.id}: ` +
      `calculated net ${netTransferAmount.toFixed()} ${outflow.asset}, ` +
      `link expects ${link.targetAmount.toFixed()} (${variancePct.toFixed(2)}% variance, ` +
      `threshold ${tolerance.error}%). Likely not a valid transfer or missing fee metadata.`
    ));
  }

  if (variancePct.gt(tolerance.warn)) {
    this.logger.warn(
      {
        txId: tx.id,
        asset: outflow.asset,
        variancePct: variancePct.toFixed(2),
        netTransferAmount: netTransferAmount.toFixed(),
        linkTargetAmount: link.targetAmount.toFixed(),
        source: tx.source
      },
      `Transfer variance (${variancePct.toFixed(2)}%) exceeds warning threshold (${tolerance.warn}%). ` +
      `Possible hidden fees or incomplete fee metadata. Review exchange fee policies.`
    );
  }

  // Get open lots for this asset
  const openLots = lots.filter(lot =>
    lot.asset === outflow.asset && lot.remainingQuantity.gt(0)
  );

  // Determine amount to match against lots
  const feePolicy = config.jurisdiction.sameAssetTransferFeePolicy;
  const amountToMatch = feePolicy === 'add-to-basis'
    ? outflow.amount  // GROSS amount (includes fee that will be added to basis)
    : netTransferAmount; // NET amount (fee handled separately as disposal)

  // Match lots for transfer
  const transferMatchResult = config.strategy.matchDisposal(
    amountToMatch,
    openLots
  );
  if (transferMatchResult.isErr()) return err(transferMatchResult.error);

  const transferMatches = transferMatchResult.value;

  if (transferMatches.totalMatched.lt(amountToMatch)) {
    return err(new Error(
      `Insufficient lots for transfer at tx ${tx.id}: ` +
      `need ${amountToMatch.toFixed()} ${outflow.asset}, ` +
      `have ${transferMatches.totalMatched.toFixed()}`
    ));
  }

  // Calculate crypto fee USD value for add-to-basis policy
  let cryptoFeeUsdValue: Decimal | undefined;
  if (cryptoFee.amount.gt(0) && feePolicy === 'add-to-basis') {
    if (!cryptoFee.priceAtTxTime) {
      this.logger.warn(
        {
          txId: tx.id,
          asset: outflow.asset,
          feeAmount: cryptoFee.amount.toFixed()
        },
        'Crypto fee missing price for add-to-basis policy. Fee will not be added to cost basis. ' +
        'Run "prices enrich" to populate missing prices.'
      );
      cryptoFeeUsdValue = undefined;
    } else {
      cryptoFeeUsdValue = cryptoFee.amount.times(cryptoFee.priceAtTxTime.price.amount);
    }
  }

  // Create lot transfers (non-taxable)
  // Note: For add-to-basis, we match GROSS but only transfer NET quantity
  const transfers: LotTransfer[] = [];
  const quantityToTransfer = netTransferAmount; // What actually arrives at target

  for (const match of transferMatches.lotMatches) {
    const metadata: any = {};

    // For add-to-basis policy, store crypto fee info proportionally
    if (feePolicy === 'add-to-basis' && cryptoFee.amount.gt(0) && cryptoFeeUsdValue) {
      // Calculate this match's share of the fee
      const feeShare = match.quantity.div(amountToMatch).times(cryptoFeeUsdValue);
      metadata.cryptoFeeUsdValue = feeShare.toFixed();
    }

    transfers.push({
      id: uuidv4(),
      calculationId,
      sourceLotId: match.lotId,
      linkId: link.id,
      quantityTransferred: match.quantity.times(quantityToTransfer.div(amountToMatch)), // Proportional net quantity
      costBasisPerUnit: match.lot.costBasisPerUnit,
      sourceTransactionId: tx.id,
      targetTransactionId: link.targetTransactionId,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      createdAt: new Date()
    });

    // Deduct FULL matched quantity from lot (includes fee portion for add-to-basis)
    match.lot.remainingQuantity = match.lot.remainingQuantity.minus(match.quantity);
  }

  // Handle crypto fee according to jurisdiction policy
  if (cryptoFee.amount.gt(0) && feePolicy === 'disposal') {
    // US/UK approach: Create taxable disposal for fee
    // (Fee already excluded from amountToMatch, so need separate match)
    const feeMatchResult = config.strategy.matchDisposal(cryptoFee.amount, openLots);
    if (feeMatchResult.isErr()) return err(feeMatchResult.error);

    const feeMatches = feeMatchResult.value;

    for (const match of feeMatches.lotMatches) {
      const disposal = {
        id: uuidv4(),
        calculationId: config.calculationId,
        lotId: match.lotId,
        disposalTransactionId: tx.id,
        quantity: match.quantity,
        costBasisPerUnit: match.lot.costBasisPerUnit,
        proceedsPerUnit: cryptoFee.priceAtTxTime?.price.amount ?? new Decimal(0),
        disposalDate: tx.datetime,
        metadata: {
          transferFee: true,
          linkId: link.id,
          feeType: cryptoFee.feeType
        },
        createdAt: new Date()
      };

      this.disposals.push(disposal);

      // Update lot
      match.lot.remainingQuantity = match.lot.remainingQuantity.minus(match.quantity);
    }
  }

  return ok(transfers);
}

/**
 * Extract crypto fee from transaction metadata
 *
 * Sums all fees in the specified asset (network + platform)
 */
private extractCryptoFee(
  tx: UniversalTransaction,
  asset: string
): Result<{ amount: Decimal; feeType: string; priceAtTxTime?: PriceAtTxTime }, Error> {

  let totalFee = new Decimal(0);
  const feeTypes: string[] = [];
  let priceAtTxTime: PriceAtTxTime | undefined;

  // Check network fee
  if (tx.fees.network?.asset === asset) {
    totalFee = totalFee.plus(tx.fees.network.amount);
    feeTypes.push('network');
    priceAtTxTime = tx.fees.network.priceAtTxTime;  // Prefer network fee price
  }

  // Check platform fee
  if (tx.fees.platform?.asset === asset) {
    totalFee = totalFee.plus(tx.fees.platform.amount);
    feeTypes.push('platform');
    if (!priceAtTxTime) {
      priceAtTxTime = tx.fees.platform.priceAtTxTime;  // Use if network didn't have one
    }
  }

  if (totalFee.isZero()) {
    return ok({ amount: new Decimal(0), feeType: 'none' });
  }

  return ok({
    amount: totalFee,
    feeType: feeTypes.join('+'),  // "network+platform" if both
    priceAtTxTime
  });
}

/**
 * Get variance tolerance thresholds for transfer reconciliation
 *
 * Returns warn and error thresholds as percentages
 */
private getVarianceTolerance(
  source: string,
  config: LotMatcherConfig
): { warn: Decimal; error: Decimal } {
  // Exchange-specific tolerances (some exchanges have hidden fees)
  const sourceTolerances: Record<string, { warn: number; error: number }> = {
    'binance': { warn: 1.5, error: 5.0 },      // Known for small hidden fees
    'kucoin': { warn: 1.5, error: 5.0 },
    'coinbase': { warn: 1.0, error: 3.0 },
    'kraken': { warn: 0.5, error: 2.0 },       // Generally accurate
    'default': { warn: 1.0, error: 3.0 }       // Conservative default
  };

  const tolerances = sourceTolerances[source.toLowerCase()] ?? sourceTolerances['default'];

  // Allow config override
  return {
    warn: new Decimal(config.transferVarianceTolerance?.warn ?? tolerances.warn),
    error: new Decimal(config.transferVarianceTolerance?.error ?? tolerances.error)
  };
}
```

**Key points**:

- Sums ALL crypto fees in the asset (network + platform)
- Calculates net transfer: `gross - totalFees`
- Validates net amount matches link target with graduated tolerance (exchange-specific)
- Warns on moderate variance (possible hidden fees), errors on excessive variance
- **Disposal policy (US/UK/EU)**: Matches net amount, creates separate disposal for fee
- **Add-to-basis policy (CA)**: Matches gross amount (deducts full quantity from inventory), creates lot transfers for net amount with fee USD value in metadata
- Fee quantity correctly removed from source lots in both policies
- Crypto fee USD value stored proportionally across lot transfers for add-to-basis policy

### Transfer Target Handling

When an inflow matches a link, create lot with inherited basis + external fees:

```typescript
private async handleTransferTarget(
  tx: UniversalTransaction,
  inflow: AssetMovement,
  link: TransactionLink,
  lotTransfers: LotTransfer[],
  config: LotMatcherConfig
): Promise<Result<AcquisitionLot, Error>> {

  // Find lot transfers for this link
  const transfers = lotTransfers.filter(t => t.linkId === link.id);

  if (transfers.length === 0) {
    // This should not happen with logical ordering, but handle gracefully
    this.logger.error(
      {
        linkId: link.id,
        targetTxId: tx.id,
        sourceTxId: link.sourceTransactionId
      },
      'No lot transfers found for link - source transaction may not have been processed. ' +
      'This suggests a bug in logical ordering.'
    );
    return err(new Error(
      `No lot transfers found for link ${link.id} (target tx ${tx.id}). ` +
      `Source transaction ${link.sourceTransactionId} should have been processed first. ` +
      `This indicates an issue with transaction ordering logic.`
    ));
  }

  // Calculate total inherited cost basis
  let totalCostBasis = new Decimal(0);
  let transferredQuantity = new Decimal(0);
  let cryptoFeeUsdAdded = new Decimal(0);

  for (const transfer of transfers) {
    const basisForTransfer = transfer.costBasisPerUnit.times(transfer.quantityTransferred);
    totalCostBasis = totalCostBasis.plus(basisForTransfer);
    transferredQuantity = transferredQuantity.plus(transfer.quantityTransferred);

    // Add crypto fee to basis (Canada/add-to-basis policy)
    if (transfer.metadata?.cryptoFeeUsdValue) {
      const feeUsd = new Decimal(transfer.metadata.cryptoFeeUsdValue);
      totalCostBasis = totalCostBasis.plus(feeUsd);
      cryptoFeeUsdAdded = cryptoFeeUsdAdded.plus(feeUsd);
    }
  }

  // Validate transferred quantity matches received quantity
  const receivedQuantity = inflow.amount;
  const variance = transferredQuantity.minus(receivedQuantity).abs();
  const variancePct = transferredQuantity.isZero()
    ? new Decimal(0)
    : variance.div(transferredQuantity).times(100);

  // Get tolerance for target validation
  const tolerance = this.getVarianceTolerance(tx.source, config);

  if (variancePct.gt(tolerance.error)) {
    return err(new Error(
      `Transfer reconciliation failed at target tx ${tx.id}: ` +
      `transferred ${transferredQuantity.toFixed()}, ` +
      `received ${receivedQuantity.toFixed()} (${variancePct.toFixed(2)}% variance, ` +
      `threshold ${tolerance.error}%). Fee should have been deducted at source.`
    ));
  }

  if (variancePct.gt(tolerance.warn)) {
    this.logger.warn(
      {
        linkId: link.id,
        targetTxId: tx.id,
        variancePct: variancePct.toFixed(2),
        transferred: transferredQuantity.toFixed(),
        received: receivedQuantity.toFixed()
      },
      `Transfer target variance (${variancePct.toFixed(2)}%) exceeds warning threshold. ` +
      `Possible fee discrepancy between source and target data.`
    );
  }

  // Collect all fiat fees from BOTH source and target transactions
  const sourceTxResult = await this.txRepo.findById(link.sourceTransactionId);
  if (sourceTxResult.isErr()) return err(sourceTxResult.error);

  const sourceTx = sourceTxResult.value;
  const fiatFeesResult = this.collectFiatFees(sourceTx, tx);
  if (fiatFeesResult.isErr()) return err(fiatFeesResult.error);

  const fiatFees = fiatFeesResult.value;

  // Add fiat fees to cost basis
  for (const fee of fiatFees) {
    if (!fee.priceAtTxTime) {
      this.logger.warn(
        {
          txId: fee.txId,
          feeAsset: fee.asset,
          feeAmount: fee.amount.toFixed(),
          date: fee.date
        },
        'Fiat fee missing priceAtTxTime - run "prices enrich" to normalize. ' +
        'This fee will not be added to cost basis.'
      );
    } else {
      const feeUsd = fee.amount.times(fee.priceAtTxTime.price.amount);
      totalCostBasis = totalCostBasis.plus(feeUsd);
    }
  }

  // Create new lot with inherited + adjusted basis
  const costBasisPerUnit = totalCostBasis.div(receivedQuantity);

  const newLot: AcquisitionLot = {
    id: uuidv4(),
    calculationId: config.calculationId,
    acquisitionTransactionId: tx.id,
    asset: inflow.asset,
    quantity: receivedQuantity,
    remainingQuantity: receivedQuantity,
    costBasisPerUnit,
    acquisitionDate: tx.datetime,
    metadata: {
      transferReceived: true,
      linkId: link.id,
      sourceLotIds: transfers.map(t => t.sourceLotId),
      fiatFeesAdded: fiatFees.length,
      cryptoFeeUsdAdded: cryptoFeeUsdAdded.gt(0) ? cryptoFeeUsdAdded.toFixed() : undefined
    },
    createdAt: new Date()
  };

  return ok(newLot);
}

/**
 * Collect all fiat fees from source and target transactions
 *
 * Checks both network and platform fee fields
 */
private collectFiatFees(
  sourceTx: UniversalTransaction,
  targetTx: UniversalTransaction
): Result<Array<{
  asset: string;
  amount: Decimal;
  priceAtTxTime?: PriceAtTxTime;
  txId: number;
  date: string;
}>, Error> {

  const fiatFees = [];

  // Check both transactions
  for (const tx of [sourceTx, targetTx]) {
    // Check network fee
    if (tx.fees.network) {
      const currency = Currency.create(tx.fees.network.asset);
      if (currency.isFiat()) {
        fiatFees.push({
          asset: tx.fees.network.asset,
          amount: tx.fees.network.amount,
          priceAtTxTime: tx.fees.network.priceAtTxTime,
          txId: tx.id,
          date: tx.datetime
        });
      }
    }

    // Check platform fee
    if (tx.fees.platform) {
      const currency = Currency.create(tx.fees.platform.asset);
      if (currency.isFiat()) {
        fiatFees.push({
          asset: tx.fees.platform.asset,
          amount: tx.fees.platform.amount,
          priceAtTxTime: tx.fees.platform.priceAtTxTime,
          txId: tx.id,
          date: tx.datetime
        });
      }
    }
  }

  return ok(fiatFees);
}
```

**Key points**:

- Uses logical ordering to ensure source processed before target
- Validates transferred quantity matches received quantity with graduated tolerance
- Sums inherited cost basis from all lot transfers
- **Add-to-basis policy**: Extracts crypto fee USD value from lot transfer metadata, adds to cost basis
- Collects fiat fees from BOTH source and target transactions
- Checks BOTH `fees.network` and `fees.platform` fields
- Gracefully handles missing prices with warnings
- Final cost basis = inherited basis + crypto fees (if add-to-basis) + fiat fees
- Uses received quantity for lot (may differ from transferred due to on-chain fees)
- Warns on moderate variance, errors only on excessive mismatches

---

## Critical Linking System Requirements

For this architecture to work correctly, the linking system MUST be updated to capture and validate transfer amounts.

### 1. Add Amount Fields to Links (NEW - Schema Change Required)

**The `transaction_links` table must be extended with three new columns:**

- `asset` - The transferred asset symbol (e.g., 'BTC', 'ETH')
- `source_amount` - Gross outflow amount (before fees deducted)
- `target_amount` - Net received amount (after on-chain fees)

These fields enable the LinkIndex to perform O(1) lookups and support graduated tolerance validation during reconciliation.

**Example link creation:**

```typescript
// Transaction: 1 BTC withdrawn (0.0005 fee)
{
  movements: {
    outflows: [{ asset: 'BTC', amount: 1.0 }]  // GROSS
  },
  fees: {
    network: { asset: 'BTC', amount: 0.0005 }  // Fee metadata
  }
}

// Target transaction
{
  movements: {
    inflows: [{ asset: 'BTC', amount: 0.9995 }]  // NET received
  }
}

// LINK CREATION - Extract amounts from transaction movements
TransactionLink {
  sourceTransactionId: 100,
  targetTransactionId: 101,
  asset: 'BTC',               // NEW - from movement
  sourceAmount: 1.0,          // NEW - gross outflow amount
  targetAmount: 0.9995,       // NEW - net received (after on-chain fee)
  confidence: 98.5,
  status: 'suggested'
}
```

**Linking algorithm updates:**

1. Extract `asset` from source/target movements (must match)
2. Populate `sourceAmount` from source outflow (gross amount)
3. Populate `targetAmount` from target inflow (net amount)
4. Validate variance before creating link (see below)

### 2. Validate Variance at Link Creation (NEW - Link Service Logic)

**Don't defer validation to cost basis calculation.** The linking service must validate amounts when creating links:

```typescript
// In linking service - add to link creation logic
private validateLinkAmounts(
  sourceAmount: Decimal,
  targetAmount: Decimal
): Result<void, Error> {

  // Reject target > source (airdrop/bonus)
  if (targetAmount.gt(sourceAmount)) {
    return err(new Error(
      `Target amount (${targetAmount.toFixed()}) exceeds source amount (${sourceAmount.toFixed()}). ` +
      `This may indicate an airdrop, bonus, or data error. ` +
      `Create separate transactions for additional funds.`
    ));
  }

  // Calculate variance
  const variance = sourceAmount.minus(targetAmount);
  const variancePct = variance.div(sourceAmount).times(100);

  // Reject excessive variance (>10%)
  if (variancePct.gt(10)) {
    return err(new Error(
      `Variance (${variancePct.toFixed(2)}%) exceeds 10% threshold. ` +
      `Source: ${sourceAmount.toFixed()}, Target: ${targetAmount.toFixed()}. ` +
      `Verify amounts are correct or adjust link.`
    ));
  }

  return ok(undefined);
}
```

**Why**: Cost basis calculation should trust that confirmed links are valid. Validation is a linking concern, not a lot matching concern.

### 3. Update Link Schemas (NEW - Schema & Repository Changes)

**Zod schema update** (`packages/accounting/src/linking/schemas.ts`):

```typescript
export const TransactionLinkSchema = z.object({
  id: z.string(),
  sourceTransactionId: z.number(),
  targetTransactionId: z.number(),
  asset: z.string(), // NEW - transferred asset
  sourceAmount: DecimalSchema, // NEW - gross outflow
  targetAmount: DecimalSchema, // NEW - net received
  linkType: LinkTypeSchema,
  confidenceScore: DecimalSchema,
  matchCriteria: MatchCriteriaSchema,
  status: LinkStatusSchema,
  reviewedBy: z.string().optional(),
  reviewedAt: DateSchema.optional(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
  metadata: TransactionLinkMetadataSchema.optional(),
});
```

**Optional metadata for debugging:**

```typescript
// Can be stored in metadata_json for reporting/debugging
{
  variance: "0.0005",              // sourceAmount - targetAmount
  variancePct: "0.05",             // (variance / sourceAmount) * 100
  impliedFee: "0.0005"             // Implied fee from variance
}
```

---

## Jurisdiction Configuration

Different tax jurisdictions have varying rules for handling transfer fees. The system supports jurisdiction-specific policies through configuration.

### Supported Jurisdictions

```typescript
interface JurisdictionConfig {
  code: 'US' | 'CA' | 'UK' | 'EU';
  sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis';
  varianceTolerance?: {
    warn: number; // Warning threshold percentage
    error: number; // Error threshold percentage
  };
}

const JURISDICTION_CONFIGS: Record<string, JurisdictionConfig> = {
  US: {
    code: 'US',
    sameAssetTransferFeePolicy: 'disposal', // IRS: fees are disposals
  },
  CA: {
    code: 'CA',
    sameAssetTransferFeePolicy: 'add-to-basis', // CRA: fees can be added to ACB
  },
  UK: {
    code: 'UK',
    sameAssetTransferFeePolicy: 'disposal', // HMRC: fees may constitute disposals
  },
  EU: {
    code: 'EU',
    sameAssetTransferFeePolicy: 'disposal', // Most EU states: fees are disposals
  },
};
```

### Configuration Usage

```typescript
// In cost basis calculator
const config: LotMatcherConfig = {
  calculationId: uuidv4(),
  strategy: new FIFOStrategy(),
  jurisdiction: JURISDICTION_CONFIGS['CA'], // User-selected jurisdiction
  transferVarianceTolerance: {
    warn: 1.5, // Optional override
    error: 5.0,
  },
};
```

### Policy Implications

**Disposal policy (US, UK, EU)**:

- Crypto fees create immediate taxable events
- Capital gains/losses recognized at time of transfer
- More conservative (higher short-term tax liability)

**Add-to-basis policy (CA)**:

- Crypto fees increase cost basis of transferred asset
- No immediate taxable event
- Capital gains/losses deferred until eventual sale
- Lower short-term tax liability, aligns with CRA guidance

### Detailed Example: Both Policies

**Setup**:

- Purchased 1 BTC @ $50,000 on Jan 1 (cost basis: $50,000/BTC)
- Transfer on Feb 1: 1 BTC gross, 0.0005 BTC fee, 0.9995 BTC net
- BTC price at transfer: $60,000/BTC
- Crypto fee: 0.0005 BTC × $60,000 = $30 proceeds
- Fiat fee: $1.50 platform fee

**US Policy (disposal)**:

Source processing:

- Match 0.9995 BTC from lot (net amount)
  - Takes 0.9995 BTC with proportional cost basis: 0.9995 × $50,000 = $49,975
- Create lot transfer: 0.9995 BTC with $49,975 inherited basis
- Match 0.0005 BTC from lot (fee)
  - Takes 0.0005 BTC with proportional cost basis: 0.0005 × $50,000 = $25
- Create disposal: 0.0005 BTC, proceeds $30, cost basis $25, **gain $5**
- **Source inventory after**: 0 BTC remaining (1.0 BTC total deducted)

Target processing:

- Receive 0.9995 BTC
- Inherit $49,975 basis (from lot transfer)
- Add $1.50 fiat fee to basis
- **Total basis**: $49,975 + $1.50 = **$49,976.50**
- **Per-unit basis**: $49,976.50 / 0.9995 = **$50,001.50/BTC**
- **Immediate tax**: $5 capital gain on fee disposal

**CA Policy (add-to-basis)**:

Source processing:

- Match 1.0 BTC from lot (gross amount)
  - Takes 1.0 BTC with cost basis: $50,000
  - Deducts full 1.0 BTC from inventory
- Create lot transfer for 0.9995 BTC with:
  - Inherited basis: 0.9995 × $50,000 = $49,975
  - Crypto fee metadata: $30 (0.0005 BTC fee's USD value)
- No disposal created
- **Source inventory after**: 0 BTC remaining (1.0 BTC total deducted)

Target processing:

- Receive 0.9995 BTC
- Inherit $49,975 basis (from lot transfer)
- Add $30 crypto fee to basis (from metadata)
- Add $1.50 fiat fee to basis
- **Total basis**: $49,975 + $30 + $1.50 = **$50,006.50**
- **Per-unit basis**: $50,006.50 / 0.9995 = **$50,031.52/BTC**
- **Immediate tax**: $0 (fee deferred to future sale)

**Key difference**:

- Both policies deduct 1.0 BTC from source inventory
- **US**: Transfers $49,975 basis, disposes $25 basis (taxable gain $5), adds $1.50 fiat → target gets **$49,976.50** total basis
- **CA**: Transfers $49,975 basis, preserves $30 fee value (non-taxable), adds $1.50 fiat → target gets **$50,006.50** total basis
- **Basis difference**: CA has **$30 higher basis** ($50,006.50 vs $49,976.50)
- CA policy preserves the fee's **market value** ($30) while US policy only preserves its **cost** ($25) and realizes the $5 gain immediately

---

## Multi-Hop Transfers

**No special logic needed.** Each link processes independently as a separate transfer.

### Example: Exchange → Wallet → Exchange

```
Day 1:  Kraken → Personal Wallet (Link 1)
        Outflow: 1.0 BTC (gross), Fee: 0.0005 BTC

Day 30: Personal Wallet → Coinbase (Link 2)
        Outflow: 0.9995 BTC (gross), Fee: 0.0003 BTC
```

### Processing

**Day 1 (Link 1)**:

Source (Kraken withdrawal):

- Gross outflow: 1.0 BTC
- Extract fee: 0.0005 BTC (from `fees.network`)
- Net transfer: 0.9995 BTC → creates lot transfers
- Fee: 0.0005 BTC → creates disposal ($30 taxable)

Target (Wallet deposit):

- Inflow: 0.9995 BTC
- Validate: matches transferred quantity ✓
- Create wallet lot (inherits Kraken basis)

**Day 30 (Link 2)**:

Source (Wallet withdrawal):

- Gross outflow: 0.9995 BTC
- Extract fee: 0.0003 BTC (from `fees.network`)
- Net transfer: 0.9992 BTC → creates lot transfers from wallet lot
- Fee: 0.0003 BTC → creates disposal ($18 taxable)

Target (Coinbase deposit):

- Inflow: 0.9992 BTC
- Validate: matches transferred quantity ✓
- Create Coinbase lot (inherits wallet basis)

### Result

**Inventory**:

- Kraken: Holds 1 BTC from purchase until Day 1
- Personal Wallet: Holds 0.9995 BTC from Day 1 to Day 30 (29 days visible!)
- Coinbase: Holds 0.9992 BTC from Day 30 onward

**Holding period**: Entire chain tracked from original Kraken purchase date.

**Tax impact**:

- Transfers: Non-taxable
- Fees: $30 + $18 = $48 taxable proceeds

---

## Importer Requirements

For the gross outflow model to work, importers must:

### 1. Emit Gross Outflows

**Outflows should represent the total amount deducted from balance:**

```typescript
// CORRECT: Gross outflow
movements: {
  outflows: [
    { asset: 'BTC', amount: 1.0 }, // Total deducted from balance
  ];
}

// INCORRECT: Net outflow (missing fee component)
movements: {
  outflows: [
    { asset: 'BTC', amount: 0.9995 }, // After fee deducted
  ];
}
```

### 2. Populate Fee Metadata

**All fees must be recorded in `fees.network` or `fees.platform`:**

```typescript
fees: {
  network: { asset: 'BTC', amount: 0.0005 },  // On-chain fee
  platform: { asset: 'USD', amount: 1.5 }     // Exchange fee
}
```

### 3. Third-Asset Fees

**For fees paid in different asset, emit separate outflow:**

```typescript
// Binance: BTC withdrawal with BNB fee
{
  movements: {
    outflows: [
      { asset: 'BTC', amount: 1.0 },    // Principal transfer
      { asset: 'BNB', amount: 0.01 }    // Fee outflow
    ]
  },
  fees: {
    platform: { asset: 'BNB', amount: 0.01 }  // Fee metadata
  }
}
```

The BTC outflow will be linked (creates lot transfers), and the BNB outflow will NOT be linked (creates disposal).

### Validation

Post-import validator to check data quality:

```typescript
/**
 * Validate importer output for transfer compatibility
 */
function validateTransferData(tx: UniversalTransaction): ValidationIssue[] {
  const issues = [];

  for (const outflow of tx.movements.outflows) {
    // Check if outflow asset matches a fee asset
    const networkFeeAsset = tx.fees.network?.asset;
    const platformFeeAsset = tx.fees.platform?.asset;

    if (outflow.asset === networkFeeAsset || outflow.asset === platformFeeAsset) {
      // Outflow in fee asset - should be gross amount
      const totalFees = new Decimal(0)
        .plus(tx.fees.network?.asset === outflow.asset ? tx.fees.network.amount : 0)
        .plus(tx.fees.platform?.asset === outflow.asset ? tx.fees.platform.amount : 0);

      // Warn if outflow is suspiciously close to target amount
      // (suggests net outflow instead of gross)
      if (totalFees.gt(0) && totalFees.div(outflow.amount).gt(0.001)) {
        issues.push({
          severity: 'warning',
          message:
            `Outflow ${outflow.amount} ${outflow.asset} may be net amount. ` +
            `Expected gross amount (including ${totalFees} fee).`,
          txId: tx.id,
        });
      }
    }
  }

  return issues;
}
```

---

## Fee Handling

### Crypto Fees (Same Asset)

**Example**: BTC network fee on BTC withdrawal

```typescript
// Transaction structure
{
  movements: {
    outflows: [{ asset: 'BTC', amount: 1.0 }]  // GROSS
  },
  fees: {
    network: { asset: 'BTC', amount: 0.0005 }
  }
}

// Link
TransactionLink {
  sourceAmount: 1.0,  // Gross
  asset: 'BTC'
}
```

**Processing (Disposal policy - US/UK/EU)**:

- Extract fee from `fees.network`: 0.0005 BTC
- Net transfer: 1.0 - 0.0005 = 0.9995 BTC
- Match 0.9995 BTC from lots → create lot transfers (non-taxable)
- Match 0.0005 BTC from lots → create disposal (taxable)
- Total deducted from inventory: 1.0 BTC

**Processing (Add-to-basis policy - CA)**:

- Extract fee from `fees.network`: 0.0005 BTC ($30)
- Net transfer: 1.0 - 0.0005 = 0.9995 BTC
- Match 1.0 BTC from lots → deduct from inventory
- Create lot transfers for 0.9995 BTC with $30 fee in metadata (non-taxable)
- No disposal created
- Total deducted from inventory: 1.0 BTC
- Fee USD value added to target lot cost basis

**Tax result**:

- Disposal policy: Fee disposal creates immediate capital gain/loss
- Add-to-basis policy: No immediate tax, fee increases target cost basis

### External Fees (Fiat)

**Example**: $1.50 platform fee on BTC withdrawal

```typescript
// Source transaction
{
  movements: {
    outflows: [{ asset: 'BTC', amount: 1.0 }]
  },
  fees: {
    platform: {
      asset: 'USD',
      amount: 1.5,
      priceAtTxTime: {
        price: { amount: 1.0, currency: 'USD' },
        source: 'fiat'
      }
    }
  }
}
```

**Processing**:

- Source: 1.0 BTC outflow → lot transfers (no crypto fee)
- Target: Collect fiat fees from source (`$1.50`)
- Add $1.50 to cost basis of received lot

**Tax result**: Fee increases cost basis (reduces future gains).

### Third-Asset Fees

**Example**: BNB fee on BTC withdrawal

```typescript
// Transaction structure
{
  movements: {
    outflows: [
      { asset: 'BTC', amount: 1.0 },      // Principal
      { asset: 'BNB', amount: 0.01 }      // Fee
    ]
  },
  fees: {
    platform: { asset: 'BNB', amount: 0.01 }
  }
}

// Link only BTC
TransactionLink {
  sourceAmount: 1.0,
  asset: 'BTC'
}
```

**Processing**:

- 1.0 BTC outflow: Has link → lot transfers (non-taxable)
- 0.01 BNB outflow: No link → disposal (taxable)

**Enhancement**: Mark BNB disposal as transfer fee for reporting:

```typescript
// In handleDisposal
if (this.isTransferFee(tx, outflow)) {
  disposal.metadata = {
    transferFee: true,
    feeType: 'third_asset',
    relatedAsset: 'BTC'  // For reporting
  };
}

private isTransferFee(
  tx: UniversalTransaction,
  outflow: AssetMovement
): boolean {
  // Check if outflow matches a fee field
  if (tx.fees.platform?.asset === outflow.asset &&
      tx.fees.platform?.amount.eq(outflow.amount)) {
    return true;
  }
  if (tx.fees.network?.asset === outflow.asset &&
      tx.fees.network?.amount.eq(outflow.amount)) {
    return true;
  }
  return false;
}
```

**Tax result**: BNB disposal creates capital gain/loss, metadata helps reporting.

---

## Price Handling

### Prerequisite: Price Enrichment

All prices must be USD-normalized via `prices enrich` before cost basis calculation.

**Pre-flight validation**:

```typescript
// In CostBasisCalculator
async calculate(...): Promise<Result<...>> {
  // Check all movements have USD-normalized prices
  const nonUsdMovements = this.findMovementsWithNonUsdPrices(transactions);
  if (nonUsdMovements.length > 0) {
    return err(
      new Error(
        `Found ${nonUsdMovements.length} movement(s) with non-USD prices. ` +
        `Run 'prices enrich' to normalize all prices to USD first.`
      )
    );
  }

  // Proceed with calculation...
}
```

### Graceful Degradation

**Current behavior**: LotMatcher throws when encountering missing prices.

**Target behavior** (future enhancement):

- Warn user about missing prices
- Skip affected cost basis adjustments
- Mark calculation as `partial` with detailed warnings
- Continue processing what's possible

**Transfer-specific handling** (once partial pathway exists):

- Fiat fees without `priceAtTxTime`: Skip fee, log warning, continue
- Crypto fees without price: Standard disposal handling (same as any missing price)
- Result status marked `partial` with detailed warnings

---

## Reporting

### Cost Basis Summary

```
Cost Basis Calculation Summary
==============================
Period: 2024-01-01 to 2024-12-31
Method: FIFO
Jurisdiction: United States (IRS)

Transactions Processed: 1,234 total
├─ Acquisitions: 567
│  ├─ Purchases: 532
│  └─ Transfers received: 35
├─ Disposals: 445
│  ├─ Sales/trades: 410
│  └─ Transfer fees: 35
└─ Transfers: 70 links (non-taxable)

Lots: 567 created
├─ Open: 145
├─ Partially disposed: 89
└─ Fully disposed: 333

Disposals: 445 total
├─ Sales/trades: 410
│  ├─ Short-term gains: $45,230.50
│  ├─ Long-term gains: $12,450.00
│  └─ Losses: ($3,200.00)
└─ Transfer fees: 35
   ├─ Network fees: 28 ($1,450.00 proceeds)
   └─ Third-asset fees: 7 ($235.00 proceeds)

Tax Summary:
├─ Total capital gains: $54,910.50
├─ Total capital losses: ($3,200.00)
└─ Net capital gains: $51,710.50
```

### Transfer Detail View

```bash
pnpm run dev transfers show <link-id>
```

```
Transfer Link: abc-123-def
═══════════════════════════════════════════════

Asset: BTC
Status: Processed
Confidence: 98.2%

Source: Kraken (tx #12345) - 2024-02-01 12:00:00 UTC
├─ Gross outflow: 1.0000 BTC
├─ Crypto fee: 0.0005 BTC (network)
├─ Net transferred: 0.9995 BTC
├─ Lots used:
│  └─ Lot #789: 1.0000 BTC @ $50,000.00 (acquired 2024-01-01)
└─ External fees:
   └─ Platform fee: $1.50

Target: Personal Wallet (tx #12346) - 2024-02-01 14:30:00 UTC
├─ Received: 0.9995 BTC
└─ Created lot #890: 0.9995 BTC @ $50,015.03/BTC
   ├─ Inherited basis: $50,000.00
   └─ External fees added: $1.50

Tax Impact:
├─ Transfer: Non-taxable (0.9995 BTC)
└─ Network fee disposal: 0.0005 BTC
   ├─ Proceeds: $30.00 (@ $60,000/BTC)
   ├─ Cost basis: $25.00
   └─ Gain: $5.00 (short-term)

Reconciliation:
├─ Gross outflow: 1.0000 BTC
├─ Crypto fee: 0.0005 BTC
├─ Net transferred: 0.9995 BTC
├─ Received: 0.9995 BTC
└─ Variance: 0.0000 BTC (0.00%)
```

---

## Implementation Plan

### Phase 0: Link Schema & Validation (Week 1) - PREREQUISITE

**Goal**: Extend linking infrastructure to capture and validate transfer amounts

**CRITICAL**: This phase must be completed before any transfer-aware lot matching work. The lot matcher depends on `asset`, `source_amount`, and `target_amount` fields for reconciliation logic.

1. **Update database schema** (`packages/platform/data/src/schema/database-schema.ts`):
   - Add `asset: string` column to `TransactionLinksTable`
   - Add `source_amount: DecimalString` column
   - Add `target_amount: DecimalString` column

2. **Create migration** (`001_initial_schema.ts`):
   - `ALTER TABLE transaction_links ADD COLUMN asset TEXT NOT NULL`
   - `ALTER TABLE transaction_links ADD COLUMN source_amount TEXT NOT NULL`
   - `ALTER TABLE transaction_links ADD COLUMN target_amount TEXT NOT NULL`
   - `CREATE INDEX idx_transaction_links_source ON transaction_links(source_transaction_id, asset, source_amount)`
   - `CREATE INDEX idx_transaction_links_target ON transaction_links(target_transaction_id, asset)`

3. **Update Zod schemas** (`packages/accounting/src/linking/schemas.ts`):
   - Add `asset`, `sourceAmount`, `targetAmount` fields to `TransactionLinkSchema`
   - Update TypeScript types via `z.infer<typeof TransactionLinkSchema>`

4. **Update `TransactionLinkRepository`**:
   - Add new fields to `create()` and `update()` methods
   - Update SQL queries to include new columns
   - Update TypeScript mappings (DB ↔ domain model)

5. **Implement link amount validation** (new file: `packages/accounting/src/linking/link-validator.ts`):
   - `validateLinkAmounts()` - checks variance <10%, rejects target > source
   - Call from link creation logic before persisting
   - Return `Result<void, Error>` with descriptive messages

6. **Update link creation logic** (`packages/accounting/src/linking/`):
   - Extract `asset` from source/target movements (must match)
   - Extract `sourceAmount` from source outflow (gross amount)
   - Extract `targetAmount` from target inflow (net amount)
   - Call `validateLinkAmounts()` before creating link
   - Calculate optional metadata: `variance`, `variancePct`, `impliedFee`

7. **Write tests**:
   - Link creation with valid amounts (0.05% variance) ✓
   - Link rejection: target > source (airdrop scenario) ✗
   - Link rejection: excessive variance (>10%) ✗
   - Link creation with missing amounts (backward compatibility)
   - Repository CRUD operations with new fields

**Deliverable**: `transaction_links` table ready with amount fields, linking service validates variance, all tests passing

### Phase 1: Cost Basis Schema, Config & Link Index (Week 2)

**Goal**: Database support for cost basis tracking, jurisdiction config, and link lookup infrastructure

1. Create `lot_transfers` table migration
2. Update `lot_disposals` table (add `metadata_json`)
3. Implement `LinkIndex` class with batched withdrawal support
4. Add Zod schemas for lot transfers and jurisdiction config
5. Create `LotTransferRepository`
6. Implement `JurisdictionConfig` with predefined policies (US, CA, UK, EU)
7. Write unit tests for link index (including collision scenarios)
8. Write unit tests for jurisdiction policies

**Deliverable**: Infrastructure ready for lot matcher integration

### Phase 2: Transfer-Aware Lot Matching (Week 3)

**Goal**: Extend lot matcher to handle transfers with logical ordering

**Prerequisites**: Phase 0 complete (link schema updated), Phase 1 complete (lot_transfers table created)

1. Implement `sortTransactionsWithLogicalOrdering()`:
   - Build dependency graph from links
   - Topological sort with chronological tie-breaking
   - Handle timestamp inconsistencies gracefully
2. Extend `LotMatcher.match()` to use logical ordering
3. Build `LinkIndex` at start of matching
4. Implement `handleTransferSource()`:
   - Extract crypto fee from metadata
   - Calculate net transfer amount
   - Validate reconciliation with graduated tolerance
   - Create lot transfers for net amount
   - Handle fee per jurisdiction policy (disposal or add-to-basis)
5. Implement `handleTransferTarget()`:
   - Validate transferred vs received quantity with graduated tolerance
   - Collect fiat fees from both transactions
   - Create lot with inherited basis + fees
6. Implement `extractCryptoFee()` - sums network and platform fees in same asset
7. Implement `getVarianceTolerance()` - exchange-specific tolerances with config override
8. Implement `collectFiatFees()` - checks both transactions, both fee fields
9. Add graceful price handling (warn on missing FX rates)
10. Write integration tests:
    - Timestamp inconsistencies (reversed deposit/withdrawal)
    - Simple transfer with crypto fee (US jurisdiction - disposal)
    - Simple transfer with crypto fee (CA jurisdiction - add to basis)
    - Simple transfer with external fee (including missing FX rate)
    - Multi-hop transfer (sequential links)
    - Third-asset fee scenario
    - Batched withdrawal (2 × same amount)
    - Multiple inflows of same asset (aggregated receives)
    - Multiple crypto fees in same asset (network + platform)
    - Reconciliation with moderate variance (warning)
    - Reconciliation failure (excessive variance)
    - Hidden fee scenario (Binance/KuCoin with 2% variance)
    - Missing price graceful degradation

**Deliverable**: Cost basis calculation correctly handles transfers with real-world data quirks

### Phase 3: Validation & Reporting (Week 4)

**Goal**: User-facing reports and validation

**Prerequisites**: Phase 2 complete (transfer-aware lot matching working)

1. Update `CostBasisSummary` to include transfer metrics
2. Implement transfer link detail view
3. Add missing price report
4. Add link validation to linking service (variance checks)
5. Create post-import validator for transfer data quality
6. Update CLI help text
7. End-to-end testing with real transaction data
8. Performance testing with large datasets
9. Documentation updates

**Deliverable**: Production-ready feature with clear reporting

### Phase 4: Future Enhancements (Post-MVP)

Explicitly deferred to v2:

- **Link review interface**: Batch operations, pattern grouping, confidence visualization
- **Error resolution wizard**: Interactive mismatch fixing with suggested actions
- **Transaction health scoring**: Flag suspicious patterns (missing fees, unusual variances)
- **Asset equivalence maps**: Handle wrapped tokens (ETH ↔ WETH, BTC ↔ WBTC)
- **Specific lot identification**: Manual lot selection for advanced tax planning
- **Dynamic variance tolerance**: Formula-based thresholds (e.g., `max(1%, $5)`)
- **Partial calculation support**: Continue with warnings when prices missing

---

## Edge Cases and Validation

### 1. Timestamp Inconsistencies

**Scenario**: Deposit timestamp appears before withdrawal due to clock skew or data provider differences

**Example**:

```typescript
// Withdrawal recorded at 2024-02-01 12:00:00 (exchange API time)
TX #100: {
  datetime: '2024-02-01T12:00:00Z',
  movements: { outflows: [{ asset: 'BTC', amount: 1.0 }] }
}

// Deposit backdated to blockchain time (30 minutes earlier due to mempool)
TX #101: {
  datetime: '2024-02-01T11:30:00Z',  // Earlier than withdrawal!
  movements: { inflows: [{ asset: 'BTC', amount: 0.9995 }] }
}

// Link established
Link: { sourceTransactionId: 100, targetTransactionId: 101 }
```

**Problem without logical ordering**:

- Chronological sort processes TX #101 first (11:30 < 12:00)
- TX #101 tries to process transfer target but no lot transfers exist yet
- Hard error: "source not processed yet"

**Solution with logical ordering**:

- Dependency graph detects: TX #101 depends on TX #100 (via link)
- TX #100 processed first regardless of timestamp
- TX #101 finds lot transfers correctly
- No errors despite timestamp reversal

**Common causes**:

- Exchange backdates deposits to blockchain confirmation time
- Withdrawals timestamped at request/initiation time
- Clock skew between exchange servers
- Different timezone handling across data sources

### 2. Batched Withdrawals

**Scenario**: Single transaction sends same amount to multiple wallets

```typescript
// Transaction
{
  id: 100,
  movements: {
    outflows: [
      { asset: 'BTC', amount: 1.0 },  // To wallet A
      { asset: 'BTC', amount: 1.0 }   // To wallet B
    ]
  }
}

// Two links
Link1: { sourceTransactionId: 100, sourceAmount: 1.0, targetTransactionId: 101 }
Link2: { sourceTransactionId: 100, sourceAmount: 1.0, targetTransactionId: 102 }
```

**Handling**:

- `LinkIndex` stores arrays:
  - `sourceMap["100:BTC:1.0"] = [Link1, Link2]`
  - `targetMap["101:BTC"] = [Link1]`
  - `targetMap["102:BTC"] = [Link2]`

**Processing (chronologically sorted)**:

**TX #100 (source):**

- First outflow (1.0 BTC):
  - `findBySource(100, 'BTC', 1.0)` → returns Link1
  - `handleTransferSource(Link1)` → creates lot transfers
  - `consumeSourceLink(Link1)` → removes from sourceMap only
  - **Link1 still in targetMap** (needed for TX #101)
- Second outflow (1.0 BTC):
  - `findBySource(100, 'BTC', 1.0)` → returns Link2
  - `handleTransferSource(Link2)` → creates lot transfers
  - `consumeSourceLink(Link2)` → removes from sourceMap only
  - **Link2 still in targetMap** (needed for TX #102)

**TX #101 (target - wallet A):**

- Inflow (0.9995 BTC):
  - `findByTarget(101, 'BTC')` → returns Link1 ✓
  - `handleTransferTarget(Link1)` → creates lot with inherited basis
  - `consumeTargetLink(Link1)` → removes from targetMap

**TX #102 (target - wallet B):**

- Inflow (0.9995 BTC):
  - `findByTarget(102, 'BTC')` → returns Link2 ✓
  - `handleTransferTarget(Link2)` → creates lot with inherited basis
  - `consumeTargetLink(Link2)` → removes from targetMap

**Result**: Both transfers correctly processed end-to-end ✓

**How it works**:

- Source processing consumes from sourceMap only
- Target processing consumes from targetMap only
- Link lifecycle: created → source consumed → target consumed → fully retired
- Chronological sorting ensures source processed before target

**Limitation**: This approach assumes outflows and links are in corresponding order. For more complex scenarios (arbitrary matching), would need per-movement identifiers in links.

### 3. Reconciliation Failures

**Source validation** (net vs link target):

```typescript
// Graduated tolerance: warn on moderate variance, error on excessive
const tolerance = this.getVarianceTolerance(tx.source, config);

if (variancePct.gt(tolerance.error)) {
  return err('Transfer variance exceeds error threshold - not a valid transfer');
} else if (variancePct.gt(tolerance.warn)) {
  this.logger.warn('Transfer variance exceeds warning threshold - possible hidden fees');
}
```

**Target validation** (transferred vs received):

```typescript
// Same graduated approach at target
if (variancePct.gt(tolerance.error)) {
  return err('Target reconciliation failed - fee should be at source');
} else if (variancePct.gt(tolerance.warn)) {
  this.logger.warn('Target variance detected - possible fee discrepancy');
}
```

### 4. Missing Fee Metadata

**Scenario**: Transaction has link but no fee metadata

```typescript
// Outflow: 1.0 BTC, no fees recorded
// Link: sourceAmount 1.0, targetAmount 0.9995
```

**Processing**:

- Extract fee: 0 BTC (no metadata)
- Net transfer: 1.0 - 0 = 1.0 BTC
- Validate: 1.0 vs 0.9995 = 0.05% variance ✓ (within 1%)
- Create transfers for 1.0 BTC
- Target receives 0.9995 BTC
- Reconciliation at target: 1.0 vs 0.9995 = 0.05% variance ✓

**Result**: Works, but cost basis slightly understated (0.0005 BTC fee not disposed).

**Improvement**: Log warning when variance exists but no fee metadata.

### 5. Multiple Crypto Fees in Same Asset

**Scenario**: Both network and platform fees charged in crypto

```typescript
// Exchange charges both network fee AND platform fee in BTC
{
  movements: {
    outflows: [{ asset: 'BTC', amount: 1.0 }]  // Gross
  },
  fees: {
    network: { asset: 'BTC', amount: 0.0003 },
    platform: { asset: 'BTC', amount: 0.0002 }
  }
}
```

**Processing**:

- Extract fees: 0.0003 + 0.0002 = 0.0005 BTC (both summed)
- Net transfer: 1.0 - 0.0005 = 0.9995 BTC
- Create lot transfers for 0.9995 BTC
- Create disposal for 0.0005 BTC (total fees)

**Result**: All fees properly accounted for ✓

---

## Integration with ADR003 (Multi-Currency Pricing)

Transfer logic consumes **USD-normalized prices** provided by the ADR003 enrichment pipeline.

### FX Rate Handling

All external fees (EUR, CAD, GBP, etc.) have their `priceAtTxTime` populated during enrichment:

```typescript
// After enrichment
platformFee = {
  asset: 'EUR',
  amount: new Decimal('1.50'),
  priceAtTxTime: {
    price: { amount: new Decimal('1.62'), currency: 'USD' },
    source: 'derived-ratio',
    fxRateToUSD: new Decimal('1.08'),
    fxSource: 'ecb',
    fxTimestamp: new Date('2024-02-01T12:00:00Z'),
  },
};
```

### Transfer Logic Responsibilities

1. Collect fiat fees from both source and target transactions
2. Check both `fees.network` and `fees.platform` fields
3. Read `priceAtTxTime` from fee movement (assume already enriched)
4. Calculate fee in USD: `fee.amount × fee.priceAtTxTime.price.amount`
5. Add to target lot cost basis

**Prerequisite**: Run `prices enrich` before cost basis calculation.

**Graceful degradation**: If `priceAtTxTime` missing on a fee:

- Log warning with transaction details
- Skip that fee adjustment (conservative - understates cost basis)
- User corrects via enrichment

See ADR003 for complete FX rate architecture and enrichment pipeline.

---

## Consequences

**Positive**:

- Transfers no longer create phantom gains/losses (tax accuracy)
- Cost basis preservation through transfer chains
- Jurisdiction-aware fee handling (US/CA/UK/EU)
- Timestamp resilient via logical ordering
- Extends existing infrastructure (lot matcher, transaction links)

**Trade-offs**:

- Requires `transaction_links` schema extension (Phase 0 prerequisite)
- Requires accurate fee metadata from importers (validator provided)
- Users must confirm links manually (≥95% confidence threshold)

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
- Transaction Linking: `packages/accounting/src/linking/`
- Lot Matcher: `packages/accounting/src/services/lot-matcher.ts`
- ADR003: Unified Price and FX Rate Enrichment Architecture
