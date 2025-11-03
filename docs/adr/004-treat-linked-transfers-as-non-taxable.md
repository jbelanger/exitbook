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
        ✅ Cost basis: $50,000

Feb 1:  Withdraw 1 BTC from Kraken (BTC @ $60,000)
        Network fee: 0.0005 BTC
        Platform fee: $1.50

        ❌ CURRENT BEHAVIOR:
        - Disposal: 1 BTC @ $60,000 = $60,000 proceeds
        - Capital gain: $10,000 (WRONG!)
        - New acquisition: 0.9995 BTC @ $60,000 (WRONG!)

        ✅ CORRECT BEHAVIOR:
        - Transfer: 0.9995 BTC (non-taxable)
        - Disposal: 0.0005 BTC fee @ $60,000 = $30 proceeds (taxable)
        - New lot: 0.9995 BTC @ $50,015.03/BTC ($50,000 + $1.50 fees)
```

### Tax Compliance Requirements

**United States (IRS)**: Transfers between own wallets are not taxable. Network fees paid in crypto are taxable disposals.

**Canada (CRA)**: Self-transfers are not dispositions. Fees may be added to cost basis or treated as disposals.

**United Kingdom (HMRC)**: Self-transfers are not disposals for CGT. Fees paid in crypto may constitute disposals.

**European Union**: Most member states treat self-to-self transfers as non-taxable.

### Existing Infrastructure

The system already has the necessary components:

- **Transaction Linking** (`packages/accounting/src/linking/`) - Detects related transactions with confidence scoring
- **Link Graph Builder** - Groups transitively linked transactions using Union-Find
- **Lot Matcher** (`packages/accounting/src/services/lot-matcher.ts`) - Chronologically processes transactions, creates lots and disposals

**What's missing**: The lot matcher doesn't consult transaction links to identify transfers.

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

Users don't need to understand transfer chains, lot transfers, or variance calculations. They simply link transactions that represent the same money moving between their accounts and get correct tax treatment.

---

## Decision

We will extend the existing lot matcher to be **transfer-aware** by consulting confirmed transaction links during chronological processing. Transfers are treated as non-taxable movements that preserve cost basis, while fees are properly handled as taxable disposals or cost basis adjustments.

### Core Principles

1. **Minimal Persistence**: Store only transfer chain facts for audit/reproducibility, no state machines
2. **Single-Pass Processing**: Extend existing chronological lot matching, no separate preprocessing stage
3. **Simple Schema**: Reuse existing `LotDisposal` table for all disposals (including transfer fees)
4. **Cost Basis Preservation**: Original cost basis flows through transfers via lot references
5. **Fee Taxonomy**:
   - **Crypto fees** (same asset): Taxable disposals from source lots
   - **External fees** (fiat): Added to target cost basis
   - **Third-asset fees** (e.g., BNB for BTC): Taxable disposals from separate lots
6. **Link Quality**: Only confirmed links ≥95% confidence used
7. **Graceful Degradation**: Calculate what's possible, report missing prices clearly
8. **Chronological Ordering**: Existing sort guarantees source processed before target

---

## Architecture

### Transfer Chain Storage (Calculation-Scoped)

Transfer chains are **calculation-scoped** - they are rebuilt fresh for each cost basis calculation run from the current state of confirmed transaction links. This ensures:

- Chains always reflect the current link state (no sync issues)
- Perfect reproducibility (each calculation stores its chains for audit)
- Simple lifecycle (no versioning, invalidation, or stale data)

```typescript
/**
 * Fee entry referencing normalized price data from AssetMovement
 *
 * External fees are stored as AssetMovement with priceAtTxTime containing
 * USD-normalized price + FX metadata (populated by ADR003 enrichment pipeline)
 */
interface FeeEntry {
  amount: Decimal; // Fee amount in original currency
  asset: string; // Fee asset (USD, EUR, BTC, etc.)
  priceAtTxTime: PriceAtTxTime; // USD price + FX metadata (from enrichment)
}

/**
 * Transfer chain - facts about a linked transfer
 *
 * Lifecycle:
 * 1. Built fresh at start of each cost basis calculation
 * 2. Stored with calculation_id for audit trail
 * 3. Never updated (immutable within calculation)
 * 4. Next calculation rebuilds from current link state
 */
interface TransferChain {
  id: string;
  calculationId: string; // Which cost basis calculation this chain belongs to
  asset: string;

  // Transaction IDs
  sourceTransactionId: number;
  targetTransactionId: number;
  intermediateTransactionIds: number[]; // For multi-hop chains

  // Amounts (for validation)
  sourceAmount: Decimal;
  targetAmount: Decimal;

  // Fees (for processing)
  cryptoFee: Decimal; // Paid in transferred asset (taxable disposal)
  externalFees: FeeEntry[]; // Fiat/multi-currency fees (added to cost basis)

  // Variance tracking (for edge cases)
  variance: Decimal; // Difference not explained by fees
  varianceType?: 'rounding' | 'target_exceeds_source' | 'fee_mismatch';

  // Link provenance
  linkIds: string[]; // TransactionLink IDs forming this chain

  createdAt: Date;
}
```

**Calculation Workflow**:

```typescript
async calculate(...) {
  const calculationId = uuidv4();

  // 1. Load current confirmed links
  const confirmedLinks = await linkRepo.findConfirmed();

  // 2. Build fresh chains for THIS calculation
  const chainResult = transferChainDetector.detect(
    transactions,
    confirmedLinks,
    calculationId
  );
  if (chainResult.isErr()) return err(chainResult.error);

  // 3. Use chains during lot matching
  const matchResult = lotMatcher.match(transactions, config, chainResult.value);

  // 4. Store chains with calculation for audit trail
  await chainRepo.createForCalculation(calculationId, chainResult.value);
}
```

### Transfer-Aware Lot Matcher (Single Pass)

Extend existing `LotMatcher.matchAsset()` to consult transfer chains:

```typescript
class LotMatcher {
  match(
    transactions: UniversalTransaction[],
    config: LotMatcherConfig,
    transferChains: TransferChain[] = []
  ): Result<LotMatchResult, Error> {
    // Build lookup projection (in-memory, deterministic)
    const projection = new TransferProjection(transferChains);

    for (const tx of sortedTransactions) {
      // Skip intermediate transactions in multi-hop chains
      if (projection.isIntermediate(tx.id)) {
        continue;
      }

      // Process outflows
      for (const outflow of tx.movements.outflows) {
        const chain = projection.findChainBySource(tx.id, outflow.asset);

        if (chain) {
          // TRANSFER SOURCE: Create lot transfer + fee disposal
          this.handleTransferSource(tx, outflow, chain, lots, config);
        } else {
          // NORMAL DISPOSAL: Existing logic
          this.matchOutflowToLots(tx, outflow, lots, config);
        }
      }

      // Process inflows
      for (const inflow of tx.movements.inflows) {
        const chain = projection.findChainByTarget(tx.id, inflow.asset);

        if (chain) {
          // TRANSFER TARGET: Create lot with inherited basis
          this.createLotFromTransfer(tx, inflow, chain, lots, config);
        } else {
          // NORMAL ACQUISITION: Existing logic
          this.createLotFromInflow(tx, inflow, config);
        }
      }
    }
  }
}
```

### Transfer Source Handling

```typescript
private handleTransferSource(
  tx: UniversalTransaction,
  outflow: AssetMovement,
  chain: TransferChain,
  lots: AcquisitionLot[],
  config: LotMatcherConfig
): Result<void, Error> {

  // Match lots for the transfer (non-taxable)
  const transferAmount = outflow.amount.minus(chain.cryptoFee);
  const matchedLots = config.strategy.matchDisposal(
    { quantity: transferAmount, asset: outflow.asset, ... },
    openLots
  );

  // Create LotTransfer records (non-taxable)
  for (const match of matchedLots) {
    lotTransfers.push({
      sourceLotId: match.lotId,
      transferChainId: chain.id,
      quantityTransferred: match.quantityDisposed,
      costBasisPerUnit: match.costBasisPerUnit,
      // Used to create target lot later
    });

    // Update lot status
    lot.remainingQuantity -= match.quantityDisposed;
  }

  // Create disposal for crypto fee (taxable)
  if (chain.cryptoFee.gt(0)) {
    const feeDisposal = config.strategy.matchDisposal(
      { quantity: chain.cryptoFee, ... },
      openLots
    );

    disposals.push({
      ...feeDisposal,
      metadata: {
        transferFee: true,
        transferChainId: chain.id
      }
    });
  }

  // Third-asset fees handled separately (they're different assets)
  // Will be matched when processing that asset's outflows
}
```

### Transfer Target Handling

```typescript
private createLotFromTransfer(
  tx: UniversalTransaction,
  inflow: AssetMovement,
  chain: TransferChain,
  lots: AcquisitionLot[],
  config: LotMatcherConfig
): Result<AcquisitionLot, Error> {

  // Find lot transfers for this chain
  const transfers = lotTransfers.filter(t => t.transferChainId === chain.id);

  // Calculate weighted average cost basis from source lots
  let totalCostBasis = new Decimal(0);
  let totalQuantity = new Decimal(0);

  for (const transfer of transfers) {
    totalCostBasis = totalCostBasis.plus(
      transfer.costBasisPerUnit.times(transfer.quantityTransferred)
    );
    totalQuantity = totalQuantity.plus(transfer.quantityTransferred);
  }

  // Add external fees to cost basis (use USD-normalized prices from enrichment)
  for (const fee of chain.externalFees) {
    const feeInUsd = fee.amount.times(fee.priceAtTxTime.price.amount);
    totalCostBasis = totalCostBasis.plus(feeInUsd);
  }

  // Create new lot with inherited + adjusted cost basis
  const costBasisPerUnit = totalCostBasis.dividedBy(inflow.amount);

  return ok(createAcquisitionLot({
    acquisitionTransactionId: tx.id,
    asset: inflow.asset,
    quantity: inflow.amount,
    costBasisPerUnit,
    metadata: {
      transferReceived: true,
      transferChainId: chain.id,
      sourceLotIds: transfers.map(t => t.sourceLotId)
    }
  }));
}
```

### Multi-Hop Transfer Chains

Multi-hop chains (exchange → blockchain → exchange) are collapsed to source + target:

```
Kraken (tx #100) → Blockchain (tx #101) → Coinbase (tx #102)

TransferChain:
  sourceTransactionId: 100
  targetTransactionId: 102
  intermediateTransactionIds: [101]

Processing:
  tx #100: Create lot transfer + fee disposal
  tx #101: SKIP (intermediate)
  tx #102: Create lot from transfer
```

The Union-Find algorithm in `LinkGraphBuilder` already handles transitive linking.

---

## Implementation Details

### Database Schema

**New table: `transfer_chains`** (calculation-scoped)

```sql
CREATE TABLE transfer_chains (
  id TEXT PRIMARY KEY,
  calculation_id TEXT NOT NULL REFERENCES cost_basis_calculations(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,

  -- Transaction references
  source_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  target_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  intermediate_transaction_ids TEXT,  -- JSON array of integers

  -- Amounts (stored as TEXT for Decimal precision)
  source_amount TEXT NOT NULL,
  target_amount TEXT NOT NULL,
  crypto_fee TEXT NOT NULL,

  -- External fees (JSON array of FeeEntry objects with embedded PriceAtTxTime)
  -- Example: [{"amount":"1.50","asset":"EUR","priceAtTxTime":{"price":{"amount":"1.62","currency":"USD"},"source":"derived-ratio","fxRateToUSD":"1.08","fxSource":"ecb"}}]
  external_fees_json TEXT NOT NULL DEFAULT '[]',

  -- Variance tracking (for edge cases)
  variance TEXT NOT NULL DEFAULT '0',
  variance_type TEXT,  -- 'rounding', 'target_exceeds_source', 'fee_mismatch'

  -- Link provenance
  link_ids TEXT NOT NULL,  -- JSON array of link IDs

  created_at TEXT NOT NULL,

  CONSTRAINT transfer_chains_amounts_positive CHECK (
    CAST(source_amount AS REAL) > 0 AND
    CAST(target_amount AS REAL) > 0
  ),
  CONSTRAINT transfer_chains_variance_type_valid CHECK (
    variance_type IS NULL OR
    variance_type IN ('rounding', 'target_exceeds_source', 'fee_mismatch')
  )
);

CREATE INDEX idx_transfer_chains_calculation ON transfer_chains(calculation_id);
CREATE INDEX idx_transfer_chains_source ON transfer_chains(source_transaction_id);
CREATE INDEX idx_transfer_chains_target ON transfer_chains(target_transaction_id);
CREATE INDEX idx_transfer_chains_asset ON transfer_chains(asset);
```

**New table: `lot_transfers`** (calculation-scoped)

```sql
CREATE TABLE lot_transfers (
  id TEXT PRIMARY KEY,
  calculation_id TEXT NOT NULL REFERENCES cost_basis_calculations(id) ON DELETE CASCADE,
  source_lot_id TEXT NOT NULL REFERENCES acquisition_lots(id),
  transfer_chain_id TEXT NOT NULL REFERENCES transfer_chains(id),
  source_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  target_transaction_id INTEGER NOT NULL REFERENCES transactions(id),

  quantity_transferred TEXT NOT NULL,
  cost_basis_per_unit TEXT NOT NULL,
  total_cost_basis TEXT NOT NULL,

  transfer_date TEXT NOT NULL,
  created_at TEXT NOT NULL,

  CONSTRAINT lot_transfers_quantity_positive CHECK (
    CAST(quantity_transferred AS REAL) > 0
  )
);

CREATE INDEX idx_lot_transfers_calculation ON lot_transfers(calculation_id);
CREATE INDEX idx_lot_transfers_source_lot ON lot_transfers(source_lot_id);
CREATE INDEX idx_lot_transfers_chain ON lot_transfers(transfer_chain_id);
CREATE INDEX idx_lot_transfers_date ON lot_transfers(transfer_date);
```

**Updated table: `lot_disposals`** (add metadata for transfer fees)

```sql
ALTER TABLE lot_disposals ADD COLUMN metadata_json TEXT;

-- Example metadata for transfer fee disposal:
{
  "transferFee": true,
  "transferChainId": "uuid-here",
  "feeType": "crypto_fee" | "third_asset_fee"
}
```

### Transfer Chain Detection

Create a service that analyzes confirmed links to build transfer chains:

```typescript
/**
 * Transfer Chain Detector
 *
 * Analyzes confirmed transaction links to identify transfer chains.
 * Uses existing LinkGraphBuilder for transitive grouping.
 */
class TransferChainDetector {
  detect(
    transactions: UniversalTransaction[],
    confirmedLinks: TransactionLink[],
    calculationId: string
  ): Result<TransferChain[], Error> {
    // Use existing LinkGraphBuilder
    const graphBuilder = new LinkGraphBuilder();
    const groups = graphBuilder.buildGroups(transactions, confirmedLinks);

    const chains: TransferChain[] = [];

    for (const group of groups) {
      // Sort transactions chronologically
      const sorted = group.transactions.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

      const source = sorted[0];
      const target = sorted[sorted.length - 1];
      const intermediates = sorted.slice(1, -1);

      // Analyze fees from transaction metadata (returns Result)
      const feeAnalysis = this.analyzeFees(source, target, group.asset, calculationId);

      // Propagate errors from fee analysis
      if (feeAnalysis.isErr()) {
        return err(feeAnalysis.error);
      }

      const { cryptoFee, externalFees, variance, varianceType } = feeAnalysis.value;

      chains.push({
        id: uuidv4(),
        calculationId,
        asset: group.asset,
        sourceTransactionId: source.id,
        targetTransactionId: target.id,
        intermediateTransactionIds: intermediates.map((t) => t.id),
        sourceAmount: this.getOutflowAmount(source, group.asset),
        targetAmount: this.getInflowAmount(target, group.asset),
        cryptoFee,
        externalFees,
        variance,
        varianceType,
        linkIds: group.links.map((l) => l.id),
        createdAt: new Date(),
      });
    }

    return ok(chains);
  }

  private analyzeFees(
    source: UniversalTransaction,
    target: UniversalTransaction,
    asset: string,
    calculationId: string
  ): Result<
    {
      cryptoFee: Decimal;
      externalFees: FeeEntry[];
      variance: Decimal;
      varianceType?: 'rounding' | 'target_exceeds_source' | 'fee_mismatch';
    },
    Error
  > {
    const sourceAmount = this.getOutflowAmount(source, asset);
    const targetAmount = this.getInflowAmount(target, asset);
    const difference = sourceAmount.minus(targetAmount);

    // STRICT VALIDATION: Target exceeds source (airdrop, bonus, error)
    if (difference.isNegative()) {
      return err(
        new Error(
          `Transfer chain rejected: target amount (${targetAmount}) exceeds source amount (${sourceAmount}) ` +
            `for asset ${asset}. This may indicate an airdrop, bonus, or data error. ` +
            `Source tx: ${source.id}, Target tx: ${target.id}. ` +
            `To handle this case, manually split into separate transactions or verify data integrity.`
        )
      );
    }

    // Calculate variance percentage
    const variancePercent = sourceAmount.isZero() ? new Decimal(0) : difference.div(sourceAmount).times(100);

    // Rounding tolerance: 0.01% of source amount
    if (variancePercent.lt(0.01)) {
      // Negligible difference - treat as rounding error
      return ok({
        cryptoFee: new Decimal(0),
        externalFees: this.extractExternalFees(source, calculationId),
        variance: difference,
        varianceType: 'rounding',
      });
    }

    // STRICT VALIDATION: Variance exceeds 10% threshold
    if (variancePercent.gt(10)) {
      return err(
        new Error(
          `Transfer chain rejected: variance (${variancePercent.toFixed(2)}%) exceeds 10% threshold. ` +
            `Source: ${sourceAmount} ${asset}, Target: ${targetAmount} ${asset}, ` +
            `Difference: ${difference} ${asset}. This may indicate incorrect linking or data error. ` +
            `Source tx: ${source.id}, Target tx: ${target.id}.`
        )
      );
    }

    // Normal case: difference is crypto fee
    return ok({
      cryptoFee: difference,
      externalFees: this.extractExternalFees(source, calculationId),
      variance: new Decimal(0),
    });
  }

  /**
   * Extract external fees from transaction
   *
   * Assumes fees already have priceAtTxTime populated by ADR003 enrichment pipeline.
   * All prices normalized to USD with FX metadata during Stage 2 (normalization).
   */
  private extractExternalFees(tx: UniversalTransaction): FeeEntry[] {
    const fees: FeeEntry[] = [];

    // Check transaction fee fields for fiat fees
    const platformFee = tx.fees.platform;
    if (platformFee) {
      const currency = Currency.create(platformFee.asset);

      if (currency.isFiat()) {
        // Fee should already have USD-normalized price from enrichment
        if (!platformFee.priceAtTxTime) {
          this.logger.warn(
            {
              asset: platformFee.asset,
              amount: platformFee.amount.toFixed(),
              txId: tx.id,
              date: tx.datetime,
            },
            'Platform fee missing priceAtTxTime - run "prices enrich" to normalize all prices to USD'
          );
          return fees; // Skip this fee
        }

        fees.push({
          amount: platformFee.amount,
          asset: platformFee.asset,
          priceAtTxTime: platformFee.priceAtTxTime,
        });
      }
    }

    return fees;
  }
}
```

### Third-Asset Fees

Third-asset fees (e.g., using BNB to pay for BTC withdrawal) are handled as separate disposals when processing the fee asset:

```typescript
// When processing BNB transactions:
for (const outflow of tx.movements.outflows.filter(o => o.asset === 'BNB')) {

  // Check if this outflow matches an explicit fee field for a transfer
  const feeForTransfer = this.findTransferUsingFee(tx, outflow);

  if (feeForTransfer) {
    // Create disposal with transfer fee metadata
    const disposal = config.strategy.matchDisposal(...);
    disposal.metadata = {
      transferFee: true,
      transferChainId: feeForTransfer.chainId,
      feeType: 'third_asset_fee',
      primaryAsset: feeForTransfer.asset  // e.g., "BTC"
    };
  } else {
    // Normal disposal (not a fee)
  }
}
```

Third-asset fee movements are identified from transaction fee fields:

```typescript
interface UniversalTransaction {
  fees: {
    network?: AssetMovement; // Often same asset
    platform?: AssetMovement; // Could be fiat or third asset
  };
}
```

**Fee Identification Rule**

An outflow is a transfer fee only if it matches an explicit fee field in the transaction:

```typescript
private findTransferUsingFee(
  tx: UniversalTransaction,
  outflow: AssetMovement
): { chainId: string; asset: string } | null {

  const chain = this.transferProjection.findChainBySource(tx.id);
  if (!chain) return null;

  // Match against explicit fee fields only
  const platformFee = tx.fees.platform;
  if (platformFee && platformFee.asset === outflow.asset && platformFee.amount.equals(outflow.amount)) {
    return { chainId: chain.id, asset: chain.asset };
  }

  const networkFee = tx.fees.network;
  if (networkFee && networkFee.asset === outflow.asset && networkFee.amount.equals(outflow.amount)) {
    return { chainId: chain.id, asset: chain.asset };
  }

  return null;
}
```

The transaction's fee fields (`tx.fees.platform`, `tx.fees.network`) are the single source of truth. Outflows that don't match these fields are treated as normal disposals, not transfer fees.

**Importer/Processor Responsibilities**:

When implementing exchange or blockchain importers:

1. Parse fee information from source data (CSV columns, API response fields)
2. Populate `tx.fees.network` for blockchain network fees
3. Populate `tx.fees.platform` for exchange/platform fees
4. Ensure fee `AssetMovement` objects include correct asset and amount
5. Include corresponding outflow in `tx.movements.outflows` (the actual asset movement)

Example (Binance BTC withdrawal with BNB fee):

```typescript
{
  movements: {
    outflows: [
      { asset: 'BTC', amount: new Decimal('1.0') },    // Primary transfer
      { asset: 'BNB', amount: new Decimal('0.01') }    // Fee deduction
    ]
  },
  fees: {
    platform: { asset: 'BNB', amount: new Decimal('0.01') }  // Links to outflow
  }
}
```

The lot matcher will match the BNB outflow to `fees.platform`, create a taxable disposal, and mark it as a transfer fee.

**Data Quality Risk**: If importers fail to populate fee fields correctly, legitimate fees will be misclassified as normal disposals (incorrect tax calculation). Mitigation: Clear importer documentation + optional post-import validation service to flag suspicious patterns (e.g., BNB outflow during BTC withdrawal without matching fee field).

### Price Handling

**Prerequisite**: All prices must be USD-normalized via `prices enrich` before cost basis calculation.

Cost basis calculator validates this via pre-flight check (see ADR003 for validation logic):

```typescript
// Pre-flight validation in CostBasisCalculator
const nonUsdMovements = this.findMovementsWithNonUsdPrices(transactions);
if (nonUsdMovements.length > 0) {
  return err(
    new Error(
      `Found ${nonUsdMovements.length} movement(s) with non-USD prices. ` +
        `Run 'prices enrich' to normalize all prices to USD first.`
    )
  );
}
```

**Graceful degradation (target state)**: If any movement or fee lacks `priceAtTxTime` after enrichment, the system should warn, continue, and record a partial result.

> **Current implementation**: `LotMatcher` still throws when it encounters an inflow or outflow with a missing `priceAtTxTime`, and calculation statuses are limited to `pending` | `completed` | `failed`. Achieving the planned behavior requires (a) introducing a `partial` status on `CostBasisCalculation`, and (b) relaxing the matcher to record warnings instead of aborting. These follow-up changes are out of scope for ADR004’s initial code drop.

Planned transfer-specific handling (once the partial pathway exists):

- External fees without `priceAtTxTime`: Skip fee, log warning, continue
- Crypto fees without price: Standard disposal handling (same as any missing price)
- Result status marked `partial` with detailed warnings

---

## Link Quality and Validation

### Confidence Threshold

Transaction links must meet quality bar:

- **Status**: `confirmed` (user-approved or auto-confirmed)
- **Confidence**: ≥95% (enforced by linking service)
- **Asset match**: Source outflow = target inflow asset
- **Amount reasonable**: Target within 10% of source (allows for fees)
- **Timing reasonable**: Target within 24 hours of source

### Link Review Workflow

Before running cost basis calculation:

```bash
# Review suggested links
pnpm run dev links review --status suggested

# Confirm or reject
pnpm run dev links confirm <link-id>
pnpm run dev links reject <link-id>

# Run calculation (uses only confirmed links)
pnpm run dev cost-basis calculate
```

Only confirmed links are used to detect transfer chains. Suggested links are ignored for cost basis.

### Validation During Chain Detection

```typescript
private validateChain(chain: TransferChain): Result<void, Error> {

  // Amount reconciliation: source ≈ target + crypto_fee
  const expectedTarget = chain.sourceAmount.minus(chain.cryptoFee);
  const variance = expectedTarget.minus(chain.targetAmount).abs();
  const variancePercent = variance.div(chain.sourceAmount).times(100);

  if (variancePercent.gt(10)) {
    return err(new Error(
      `Transfer chain amounts don't reconcile: ` +
      `source ${chain.sourceAmount}, target ${chain.targetAmount}, ` +
      `fee ${chain.cryptoFee}, variance ${variancePercent.toFixed(2)}%`
    ));
  }

  // Verify all transactions exist
  const allTxIds = [
    chain.sourceTransactionId,
    chain.targetTransactionId,
    ...chain.intermediateTransactionIds
  ];

  for (const txId of allTxIds) {
    if (!transactions.find(t => t.id === txId)) {
      return err(new Error(`Transaction ${txId} not found in chain`));
    }
  }

  return ok(undefined);
}
```

---

## Integration with ADR003 (Multi-Currency Pricing)

Transfer chain logic consumes **USD-normalized prices** provided by the ADR003 enrichment pipeline. All external fees (EUR, CAD, GBP, etc.) have their `priceAtTxTime` populated during Stage 2 normalization with:

- `price.amount` - USD-normalized value
- `price.currency` - Always USD after enrichment
- `fxRateToUSD` - Exchange rate used (e.g., 1.08 for EUR→USD)
- `fxSource` - FX provider (e.g., 'ecb', 'bank-of-canada', 'frankfurter')
- `fxTimestamp` - When FX rate was fetched

**Transfer logic responsibilities**:

1. Extract external fees from `tx.fees.platform` with `currency.isFiat()`
2. Read `priceAtTxTime` from fee movement (assume already enriched)
3. Calculate fee in USD: `fee.amount × fee.priceAtTxTime.price.amount`
4. Add to target lot cost basis

**Prerequisite**: Run `prices enrich` before cost basis calculation to ensure all fees have USD-normalized prices.

**Graceful degradation**: If `priceAtTxTime` missing on a fee, log warning and skip that fee (conservative approach - understates cost basis, user corrects via enrichment).

See ADR003 for complete FX rate architecture, provider failover (ECB → Bank of Canada → Frankfurter), and enrichment pipeline details.

---

## Reporting

### Transfer-Aware Reports

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
└─ Transfers: 35 chains (non-taxable)
   ├─ Simple (1:1): 28
   ├─ Multi-hop: 7
   └─ Intermediates skipped: 12

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
   ├─ Crypto fees: 28 ($1,450.00 proceeds)
   └─ Third-asset fees: 7 ($235.00 proceeds)

Tax Summary:
├─ Total capital gains: $54,910.50
├─ Total capital losses: ($3,200.00)
└─ Net capital gains: $51,710.50
```

### Transfer Chain Detail View

```bash
pnpm run dev transfers show <chain-id>
```

```
Transfer Chain: abc-123-def
═══════════════════════════════════════════════

Asset: BTC
Type: Multi-hop (3 transactions)
Status: Processed

Source: Kraken (tx #12345) - 2024-02-01 12:00:00 UTC
├─ Sent: 1.0000 BTC
├─ Crypto fee: 0.0005 BTC (network fee)
├─ External fee: $1.50 (platform fee)
└─ Lots used:
   └─ Lot #789: 1.0000 BTC @ $50,000.00 (acquired 2024-01-01)

Intermediate: Blockchain (tx #12346) - 2024-02-01 12:05:00 UTC
├─ Received: 0.9995 BTC
└─ Status: Skipped (intermediate transaction)

Target: Personal Wallet (tx #12347) - 2024-02-01 14:30:00 UTC
├─ Received: 0.9995 BTC
├─ Cost basis: $50,001.50 total
│  ├─ Inherited from lot #789: $50,000.00
│  └─ External fees added: $1.50
└─ Created lot #890: 0.9995 BTC @ $50,015.03/BTC

Tax Impact:
├─ Transfer: Non-taxable (0.9995 BTC)
└─ Fee disposal: 0.0005 BTC
   ├─ Proceeds: $30.00 (@ $60,000/BTC)
   ├─ Cost basis: $25.00
   └─ Gain: $5.00 (short-term)

Links: 2 confirmed links (≥95% confidence)
├─ Link #1: tx #12345 → tx #12346 (96.5% confidence)
└─ Link #2: tx #12346 → tx #12347 (98.2% confidence)
```

---

## Consequences

### Positive

✅ **Tax Accuracy**: Transfers no longer create phantom gains/losses
✅ **Simple Architecture**: Extends existing lot matcher, no complex state machines
✅ **Calculation-Scoped**: Chains rebuilt per calculation, always reflect current link state
✅ **Audit Trail**: Persisted chains enable debugging and reproducibility per calculation
✅ **Cost Basis Preservation**: Original acquisition dates and basis flow through transfers
✅ **Fee Compliance**: All fee types properly classified (crypto fees → disposals, fiat fees → cost basis)
✅ **Multi-Currency Support**: Consumes USD-normalized prices from ADR003 enrichment with full FX audit trail
✅ **Multi-Hop Support**: Transitively linked chains handled automatically
✅ **Reuses Infrastructure**: LinkGraphBuilder, chronological ordering, lot matching strategy, ADR003 enrichment
✅ **Graceful Degradation**: Partial calculations possible with clear reporting
✅ **Strict Validation**: Returns errors for edge cases (target > source, variance > 10%) enabling future improvements
✅ **Regulatory Compliance**: Aligns with IRS, CRA, HMRC, EU tax treatment

### Neutral

⚠️ **Link Quality Dependency**: Requires confirmed links ≥95% confidence (mitigated by manual review)
⚠️ **Database Changes**: Two new tables (transfer_chains, lot_transfers), both calculation-scoped
⚠️ **Enrichment Prerequisite**: Requires `prices enrich` before calculation (validates via pre-flight check)
⚠️ **Rounding Tolerance**: 0.01% threshold may need tuning for high-precision assets
⚠️ **Calculation Rebuild Cost**: Chains rebuilt each run (acceptable for MVP, can optimize later)

### Negative

❌ **Processing Complexity**: Lot matcher must handle transfer logic alongside normal acquisitions/disposals
❌ **Third-Asset Fee Detection**: Requires explicit matching of outflows to transaction fee fields (strong dependency on importer data quality)
❌ **Importer Data Quality**: Incorrect fee field population causes misclassified disposals; requires clear documentation and optional validation tooling
❌ **Testing Scope**: Need comprehensive tests for transfer scenarios and edge cases
❌ **Conservative Rejection**: Strict validation may reject valid edge cases (airdrops, bonuses) requiring manual handling

---

## Implementation Plan

### Phase 1: Schema & Chain Detection (Week 1)

**Goal**: Detect and persist transfer chains

1. ✅ Create `transfer_chains` table migration
2. ✅ Create `lot_transfers` table migration
3. ✅ Update `lot_disposals` table (add `metadata_json`)
4. ✅ Implement `TransferChainDetector` service
5. ✅ Implement `TransferProjection` (in-memory lookup)
6. ✅ Add Zod schemas for transfer chain validation
7. ✅ Write unit tests for chain detection and validation

**Deliverable**: Transfer chains detected and stored, ready for consumption

### Phase 2: Transfer-Aware Lot Matching (Week 2)

**Goal**: Extend lot matcher to handle transfers

1. ✅ Extend `LotMatcher.match()` to accept transfer chains
2. ✅ Implement `handleTransferSource()` - creates lot transfers + fee disposals
3. ✅ Implement `createLotFromTransfer()` - creates lots with inherited basis
4. ✅ Update `matchAsset()` to skip intermediate transactions
5. ✅ Implement `findTransferUsingFee()` - explicit matching of outflows to transaction fee fields (NOT assumption-based)
6. ⏳ Add graceful price/FX handling (partial results with zero for missing rates)
7. ✅ Write integration tests:
   - Simple transfer with crypto fee
   - Simple transfer with external fee (including missing FX rate)
   - Multi-hop transfer
   - Third-asset fee scenario (explicit fee field matching)
   - Third-asset fee rejection (outflow without matching fee field)
   - Missing price graceful degradation

**Deliverable**: Cost basis calculation correctly handles transfers

### Phase 3: Reporting & Validation (Week 3)

**Goal**: User-facing reports and validation

1. ✅ Update `CostBasisSummary` to include transfer metrics
2. ✅ Implement transfer chain detail view
3. ✅ Add missing price report
4. ✅ Add transfer validation checks
5. ✅ Update CLI help text
6. ✅ End-to-end testing with real transaction data
7. ✅ Performance testing with large datasets
8. ✅ Documentation updates

**Deliverable**: Production-ready feature with clear reporting

### Optional Follow-Ups (Separate Track)

These are workflow enhancements, not prerequisites:

- **Link review CLI**: Enhanced UI for reviewing suggested links
- **Manual price entry CLI**: `prices add` command for missing prices
- **Transfer analysis report**: Detailed breakdown of all transfers
- **Multi-currency external fees**: Support non-USD fiat fees
- **Import validation service**: Post-import checks for suspicious patterns (e.g., fee asset outflows without matching fee fields)

---

## Example Scenarios

### Scenario 1: Simple Transfer with Crypto Fee

**Setup**:

```
Kraken withdrawal: 1 BTC
Network fee: 0.0005 BTC (deducted)
Platform fee: None
```

**Processing**:

```typescript
// Source (Kraken withdrawal)
handleTransferSource(tx #100, outflow: 1 BTC, chain) {
  // Transfer 0.9995 BTC (non-taxable)
  createLotTransfer(lot #50, 0.9995 BTC, costBasis: $50,000)

  // Dispose 0.0005 BTC fee (taxable)
  createDisposal(lot #50, 0.0005 BTC, proceeds: $30)
}

// Target (wallet receive)
createLotFromTransfer(tx #101, inflow: 0.9995 BTC, chain) {
  // Create lot with inherited basis
  createLot(0.9995 BTC, costBasisPerUnit: $50,005.00)
}
```

**Result**:

- Transfer: 0.9995 BTC (non-taxable)
- Disposal: 0.0005 BTC @ $60,000 = $30 proceeds, $25 cost basis, $5 gain
- New lot: 0.9995 BTC @ $50,005/BTC

### Scenario 2: Multi-Hop Transfer

**Setup**:

```
Kraken → Blockchain → Coinbase
  tx #100      tx #101      tx #102
  1 BTC       0.9995 BTC   0.9995 BTC
```

**Chain Detection**:

```typescript
TransferChain {
  sourceTransactionId: 100,
  targetTransactionId: 102,
  intermediateTransactionIds: [101],
  cryptoFee: 0.0005 BTC
}
```

**Processing**:

```typescript
// tx #100: Source processing (create transfers + fee disposal)
// tx #101: SKIP (intermediate)
// tx #102: Target processing (create lot with inherited basis)
```

### Scenario 3: Third-Asset Fee

**Setup**:

```
Binance withdrawal: 1 BTC
Network fee: None (Binance covers)
Platform fee: 0.01 BNB (deducted from BNB balance)

Transaction structure:
{
  movements: {
    outflows: [
      { asset: 'BTC', amount: 1.0 },
      { asset: 'BNB', amount: 0.01 }
    ]
  },
  fees: {
    platform: { asset: 'BNB', amount: 0.01 }  // Explicit fee field
  }
}
```

**Processing**:

```typescript
// Process BTC transfer
handleTransferSource(tx #200, outflow: 1 BTC, chain) {
  createLotTransfer(lot #60, 1 BTC)  // No crypto fee
}

// Process BNB outflow separately
matchOutflowToLots(tx #200, outflow: 0.01 BNB) {
  // Check if this outflow matches a fee field
  const feeForTransfer = findTransferUsingFee(tx, outflow);
  // Returns { chainId: chain.id, asset: 'BTC' } because:
  //   tx.fees.platform.asset === 'BNB' && tx.fees.platform.amount === 0.01

  createDisposal(lot #70, 0.01 BNB, metadata: {
    transferFee: true,
    transferChainId: feeForTransfer.chainId,
    feeType: 'third_asset_fee',
    primaryAsset: 'BTC'
  })
}
```

**Result**:

- BTC transfer: 1 BTC (non-taxable)
- BNB disposal: 0.01 BNB (taxable, marked as transfer fee)

---

## Validation & Edge Case Handling

### Strict Validation Thresholds

The system uses **conservative validation** to ensure tax accuracy, returning explicit errors for edge cases that require manual review:

| Validation             | Threshold        | Action              | Rationale                                     |
| ---------------------- | ---------------- | ------------------- | --------------------------------------------- |
| **Target > Source**    | Any negative fee | ❌ Reject chain     | Indicates airdrop, bonus, or data error       |
| **Rounding tolerance** | < 0.01% variance | ✅ Accept (fee = 0) | Negligible difference, likely precision issue |
| **Fee variance**       | 0.01% - 10%      | ✅ Accept as fee    | Normal network/platform fees                  |
| **Excessive variance** | > 10% variance   | ❌ Reject chain     | Likely incorrect linking or data error        |

### Error Messages (Clear Improvement Paths)

All validation errors include:

- ✅ **Clear description** of what failed
- ✅ **Transaction IDs** for investigation
- ✅ **Suggested actions** for resolution
- ✅ **Future improvement path** (manual split, data correction, etc.)

Example error:

```
Transfer chain rejected: target amount (1.05 BTC) exceeds source amount (1.0 BTC)
for asset BTC. This may indicate an airdrop, bonus, or data error.
Source tx: 12345, Target tx: 12346.

To handle this case, manually split into separate transactions or verify data integrity.
```

### Edge Cases Deferred to Future Work

The following scenarios are intentionally **rejected in MVP** with clear error messages, enabling future enhancement:

1. **Target exceeds source** - Airdrops/bonuses during transfer
   - Future: Auto-split into transfer + separate acquisition

2. **Multi-currency external fees** - Multiple fiat currencies on one tx
   - Future: Enhanced to handle after broader FX tracking

3. **Crypto fee rebates** - Receiving crypto as fee discount
   - Future: Handle as separate income/acquisition

4. **High variance transfers** - >10% fee (some blockchains/exchanges)
   - Future: Configurable per-asset tolerance thresholds

This approach prioritizes **accuracy over flexibility** for MVP, with explicit extension points for future iterations.

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
- Link Graph Builder: `packages/accounting/src/price-enrichment/link-graph-builder.ts`
- Lot Matcher: `packages/accounting/src/services/lot-matcher.ts`
