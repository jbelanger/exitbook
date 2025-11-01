# ADR 002: Treat Linked Transfers as Non-Taxable Events

**Date**: 2025-11-01
**Status**: Proposed
**Deciders**: Joel Belanger (maintainer)
**Tags**: cost-basis, taxation, transfers, transaction-linking

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
 * Fee entry with currency tracking for external fees
 */
interface FeeEntry {
  amount: Decimal;
  currency: string; // Original currency (USD, EUR, etc.)
  normalizedAmount: Decimal; // Converted to USD for cost basis
  fxRate?: Decimal; // Exchange rate used (if conversion occurred)
  fxSource?: string; // Where FX rate came from (e.g., "coingecko", "manual")
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

  // Add external fees to cost basis (sum normalized amounts from all fee entries)
  for (const fee of chain.externalFees) {
    totalCostBasis = totalCostBasis.plus(fee.normalizedAmount);
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

  -- External fees (JSON array of FeeEntry objects)
  -- Example: [{"amount":"1.50","currency":"USD","normalizedAmount":"1.50","fxRate":"1.0","fxSource":"manual"}]
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
   * Extract external fees with currency tracking
   *
   * For MVP: Normalize all fees to USD using existing price enrichment service
   * Future: Dedicated FX rate provider for fiat-to-fiat conversions
   */
  private extractExternalFees(tx: UniversalTransaction, calculationId: string): FeeEntry[] {
    const fees: FeeEntry[] = [];

    // Check transaction fee fields for fiat fees
    const platformFee = tx.fees.platform;
    if (platformFee) {
      const currency = Currency.create(platformFee.asset);

      if (currency.isFiat()) {
        // Get FX rate from price enrichment service
        // (Reuses existing providers like CoinGecko which have fiat rates)
        const fxRate = this.getFxRateToUSD(platformFee.asset, tx.datetime);

        // Missing FX rate: Use zero for normalized amount (graceful degradation)
        // This maintains accuracy and allows partial calculations
        const normalizedAmount = fxRate.isOk() ? platformFee.amount.times(fxRate.value) : new Decimal(0);

        if (fxRate.isErr()) {
          this.logger.warn(
            {
              currency: platformFee.asset,
              amount: platformFee.amount.toString(),
              tx: tx.id,
              date: tx.datetime,
            },
            'Missing FX rate for external fee - using zero for cost basis adjustment. ' +
              'This understates cost basis and may overstate capital gains. ' +
              'Add FX rate via price enrichment to correct calculation.'
          );
        }

        fees.push({
          amount: platformFee.amount,
          currency: platformFee.asset,
          normalizedAmount,
          fxRate: fxRate.isOk() ? fxRate.value : undefined,
          fxSource: fxRate.isOk() ? 'price_enrichment' : undefined,
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

**Critical Implementation Detail: Fee Identification**

The linkage between third-asset fee outflows and their parent transactions MUST be explicit, not assumed:

```typescript
/**
 * Identify if an outflow is a fee for a transfer
 *
 * CORRECT: Match against explicit fee fields in transaction
 */
private findTransferUsingFee(
  tx: UniversalTransaction,
  outflow: AssetMovement
): { chainId: string; asset: string } | null {

  // Find transfer chain for this transaction
  const chain = this.transferProjection.findChainBySource(tx.id);
  if (!chain) return null;

  // Check if outflow matches transaction's explicit platform fee
  const platformFee = tx.fees.platform;
  if (
    platformFee &&
    platformFee.asset === outflow.asset &&
    platformFee.amount.equals(outflow.amount)
  ) {
    return {
      chainId: chain.id,
      asset: chain.asset
    };
  }

  // Check network fee (rare for third-asset, but possible)
  const networkFee = tx.fees.network;
  if (
    networkFee &&
    networkFee.asset === outflow.asset &&
    networkFee.amount.equals(outflow.amount)
  ) {
    return {
      chainId: chain.id,
      asset: chain.asset
    };
  }

  return null;
}
```

**WRONG Approach (Do Not Implement)**:

```typescript
// ❌ INCORRECT: Assumes any BNB outflow during BTC transfer is a fee
if (chain.asset === 'BTC' && outflow.asset === 'BNB') {
  return { chainId: chain.id, asset: 'BTC' }; // WRONG!
}
```

**Rationale**: Fee identification must be explicit to handle complex scenarios correctly:

- User withdraws BTC and simultaneously swaps BNB → different transactions
- User pays BNB fee for BTC withdrawal → fee is in `tx.fees.platform`
- User sends BNB to another wallet during BTC withdrawal → separate outflow, not a fee

The transaction's fee fields are the single source of truth. Importers and processors MUST populate these fields correctly from the source data.

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

**Graceful degradation** instead of blocking:

```typescript
async calculate(...): Promise<Result<CostBasisSummary, Error>> {

  // ... lot matching ...

  // Identify disposals missing prices
  const allDisposals = lotMatchResult.assetResults.flatMap(r => r.disposals);
  const missingPrices = allDisposals.filter(
    d => d.priceStatus === 'missing'
  );

  // Identify transfer fees with missing FX rates
  const missingFxRates = transferChains
    .flatMap(chain => chain.externalFees)
    .filter(fee => !fee.fxRate);

  if (missingPrices.length > 0 || missingFxRates.length > 0) {
    this.logger.warn(
      {
        missingPrices: missingPrices.length,
        missingFxRates: missingFxRates.length
      },
      'Some disposals or fees missing price/FX data - results incomplete'
    );

    // Mark calculation as partial
    calculation.status = 'partial';
    calculation.warnings = [
      ...(missingPrices.length > 0 ? [{
        type: 'missing_prices',
        count: missingPrices.length,
        disposals: missingPrices.map(d => ({
          txId: d.disposalTransactionId,
          asset: d.asset,
          amount: d.quantityDisposed
        }))
      }] : []),
      ...(missingFxRates.length > 0 ? [{
        type: 'missing_fx_rates',
        count: missingFxRates.length,
        fees: missingFxRates.map(f => ({
          amount: f.amount,
          currency: f.currency
        }))
      }] : [])
    ];
  }

  // Continue calculation with available data
  // Zero proceeds for missing prices (conservative)
  // Zero normalized amount for missing FX rates (conservative)
}
```

Report clearly shows what's missing:

```
Cost Basis Calculation Summary
==============================
Status: Partial (2 crypto prices missing, 1 FX rate missing)

Disposals: 45 total
├─ Complete: 43 (prices available)
└─ Missing prices: 2 ⚠️

Missing Crypto Prices:
- BTC @ 2024-02-01 12:00:00 UTC (tx #12345, network fee: 0.0005 BTC)
- ETH @ 2024-03-15 08:30:00 UTC (tx #67890, platform fee: 0.01 ETH)

Missing FX Rates:
- EUR 1.50 @ 2024-02-01 12:00:00 UTC (tx #12345, platform fee)

Impact:
- Capital gains may be understated by ~$35 (missing crypto prices)
- Cost basis understated by ~$1.60 (missing FX rates) - may result in overpaid tax

To add prices:
  pnpm run dev prices add --asset BTC --date "2024-02-01T12:00:00Z" --price 60000
  pnpm run dev prices add --asset EUR --date "2024-02-01T12:00:00Z" --price 1.08
```

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

## Foreign Exchange Rate Tracking

### Broader Context

While this ADR focuses on transfer chains, the **FX rate tracking problem affects the entire cost basis system**, not just transfer fees. This is a foundational data modeling concern.

### Current Limitation

The existing `AssetMovement` schema lacks FX rate metadata:

```typescript
// Current (missing FX tracking)
interface AssetMovement {
  asset: string;
  amount: Decimal;
  priceAtTxTime?: {
    price: {
      amount: Decimal; // e.g., $60,000 (but what if movement is in EUR?)
      currency: Currency; // e.g., USD
    };
  };
}
```

**Problem**: When a movement is denominated in a non-USD fiat currency (EUR, CAD, etc.), we normalize to USD for cost basis but **lose the original currency and conversion rate used**. This affects:

1. **Transfer external fees** (this ADR) - EUR platform fee converted to USD
2. **Multi-currency trades** - Buying BTC with EUR on European exchange
3. **Fiat deposits/withdrawals** - Moving CAD to/from exchange
4. **Cross-border transactions** - Any movement involving non-USD fiat

### Proposed Enhancement (Out of Scope)

Add FX rate tracking to `AssetMovement`:

```typescript
interface AssetMovement {
  asset: string;
  amount: Decimal;
  priceAtTxTime?: {
    price: {
      amount: Decimal;
      currency: Currency;
    };
    // NEW: FX rate metadata
    fxRateToUSD?: Decimal; // If normalized from foreign fiat
    fxSource?: string; // Where rate came from (e.g., "ecb", "manual")
    fxTimestamp?: Date; // When rate was fetched
  };
}
```

**Benefits**:

- Complete audit trail for multi-currency scenarios
- Reproducible calculations across years (same FX rates)
- Transparency for tax authorities (show which rates were used)
- Support for users with non-USD home currencies

### MVP Approach (This ADR)

For transfer chains, we track FX rates in `FeeEntry[]` within transfer chains. This is **transfer-scoped** and sufficient for MVP.

**FX Rate Handling Strategy**:

- **When FX rate is available**: Convert foreign currency fee to USD using the rate, add to cost basis
- **When FX rate is missing**: Use zero for normalized amount
  - Logs warning with full context (currency, amount, transaction, date)
  - Reports missing FX rates clearly in calculation summary
  - User can add rate via price enrichment and recalculate
- **Rationale**:
  - **Tax Compliance Priority**: Zero normalized amount means lower cost basis → higher capital gains → higher tax liability. This is "conservative" from a **tax authority perspective** - we cannot accidentally understate tax obligations.
  - **User Impact**: Users may pay more tax than necessary until they provide the FX rate. However, this is transparent and correctable, whereas a 1:1 default would silently introduce errors that could violate tax regulations.
  - **Consistency**: Aligns with graceful degradation pattern used for missing crypto prices (zero proceeds when price missing).
  - **Auditability**: Clear reporting shows exactly what's missing, enabling users to make informed decisions about data completeness vs. calculation accuracy.

**Future work**: Extend FX tracking to entire `AssetMovement` schema (separate ADR, broader impact).

**MVP FX Rate Source**: Reuse existing price enrichment service (CoinGecko has fiat rates).

**Future enhancement**: Dedicated FX rate provider (ECB, Fixer.io) for more accurate fiat-to-fiat conversions with official rates.

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
✅ **FX Rate Tracking**: External fees tracked with currency metadata for multi-currency support
✅ **Multi-Hop Support**: Transitively linked chains handled automatically
✅ **Reuses Infrastructure**: LinkGraphBuilder, chronological ordering, lot matching strategy, price enrichment
✅ **Graceful Degradation**: Partial calculations possible with clear reporting
✅ **Strict Validation**: Returns errors for edge cases (target > source, variance > 10%) enabling future improvements
✅ **Regulatory Compliance**: Aligns with IRS, CRA, HMRC, EU tax treatment

### Neutral

⚠️ **Link Quality Dependency**: Requires confirmed links ≥95% confidence (mitigated by manual review)
⚠️ **Database Changes**: Two new tables (transfer_chains, lot_transfers), both calculation-scoped
⚠️ **Price Data Dependency**: Missing FX rates excluded from cost basis using zero (tax-compliant graceful degradation with clear reporting)
⚠️ **Rounding Tolerance**: 0.01% threshold may need tuning for high-precision assets
⚠️ **Calculation Rebuild Cost**: Chains rebuilt each run (acceptable for MVP, can optimize later)

### Negative

❌ **Processing Complexity**: Lot matcher must handle transfer logic alongside normal acquisitions/disposals
❌ **Third-Asset Fee Detection**: Requires explicit matching of outflows to transaction fee fields (strong dependency on importer data quality)
❌ **Importer Data Quality**: Incorrect fee field population causes misclassified disposals; requires clear documentation and optional validation tooling
❌ **Testing Scope**: Need comprehensive tests for transfer scenarios and edge cases
❌ **Conservative Rejection**: Strict validation may reject valid edge cases (airdrops, bonuses) requiring manual handling
❌ **FX Rate Scope**: Only tracks FX rates for transfer fees, not entire AssetMovement schema (future work needed)
❌ **Tax-Compliant FX Handling**: Missing FX rates use zero (understates cost basis → may overstate tax liability). Prioritizes compliance over user benefit; correctable by adding rates.

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
6. ✅ Add graceful price/FX handling (partial results with zero for missing rates)
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
