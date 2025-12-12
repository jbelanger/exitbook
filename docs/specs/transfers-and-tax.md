# Transfers and Tax Specification

## Overview

This specification defines how the system identifies, links, and taxes transfers between a user's own accounts (self-transfers).

This doc is implementation-driven: it describes the current behavior of transaction linking + cost basis lot matching.

## Core Principles

1.  **Non-Taxable Events**: Transfers between own accounts are **not** taxable events (US, CA, UK, EU). They preserve cost basis.
2.  **Fee Separation**: Fees paid to facilitate the transfer (network/gas fees) are distinct from the transfer itself and may be taxable disposals or added to basis (jurisdiction-dependent).
3.  **Explicit Linking**: Only **confirmed** `TransactionLink` records with `confidenceScore >= 0.95` are treated as transfers by cost basis matching.
4.  **Logical Ordering**: Linked transactions are processed in logical order (Source -> Target) even if timestamps disagree (dependency-aware sort).
5.  **Net Amount Model**: Linking and transfer matching use **net movement amounts** when present (`movement.netAmount ?? movement.grossAmount`).
6.  **Prices Required**: Cost basis matching requires `priceAtTxTime` on all non-fiat inflows/outflows, and it may require `priceAtTxTime` on fees depending on the calculation path.

## Transfer Architecture

### The Transaction Link

A transfer creates a relationship between a **Source** (Withdrawal/Outflow) and a **Target** (Deposit/Inflow).

```typescript
interface TransactionLink {
  sourceTransactionId: number;
  targetTransactionId: number;
  asset: string;

  // IMPORTANT (implementation): these are the amounts used by the linker
  // and the lot matcher, and are derived from movements as:
  // amount = movement.netAmount ?? movement.grossAmount
  //
  // i.e. these are "net movement amounts" when netAmount exists.
  sourceAmount: Decimal;
  targetAmount: Decimal;

  linkType: 'exchange_to_blockchain' | 'blockchain_to_blockchain' | 'exchange_to_exchange' | 'blockchain_internal';
  confidenceScore: Decimal;
  status: 'suggested' | 'confirmed' | 'rejected';
}
```

### Logical Ordering

Exchange timestamps are often imprecise. To prevent "Negative Balance" errors where a deposit appears to arrive _after_ it was spent, or _before_ it was sent:

- The system enforces that **Source is processed before Target**.
- This is implemented via a dependency-aware comparator sort (direct Source->Target constraints take precedence over timestamps).

## Automatic Linking (TransactionLinkingService)

Automatic linking produces:

- `suggestedLinks`: potential matches that did not meet auto-confirm threshold (not persisted as `TransactionLink` by this service).
- `confirmedLinks`: auto-confirmed `TransactionLink` objects (plus auto-confirmed internal blockchain links).

### Candidate Extraction

Linking is performed on per-movement candidates (one candidate per inflow and one per outflow movement), using:

- `candidate.amount = movement.netAmount ?? movement.grossAmount`
- `candidate.direction = 'out'` for outflows, `'in'` for inflows

### Matching Constraints (Hard Filters)

For a source(out) candidate to match a target(in) candidate:

- Assets must match.
- Target must be after source in time and within the timing window (`maxTimingWindowHours`, default 48h).
- Amount similarity must be >= `minAmountSimilarity` (default 0.95).
- Confidence score must be >= `minConfidenceScore` (default 0.7).
- If both addresses exist, they must match (address mismatch rejects the match).

### Confidence Scoring (Current Weights)

Confidence is computed from match criteria:

- asset match (required): 30%
- amount similarity: 40%
- timing validity: 20% (+5% bonus if within 1 hour)
- address match bonus: +10% (address mismatch rejects)

Auto-confirm happens when `confidenceScore >= autoConfirmThreshold` (default 0.95).

### Amount Validation

Even after a potential match passes matching filters, link creation validates amounts:

- Rejects `targetAmount > sourceAmount`.
- Rejects variance > 10% (`(source-target)/source * 100 > 10`).

### Internal Blockchain Links (`blockchain_internal`)

The linker also auto-detects “internal” blockchain links:

- Groups blockchain transactions by normalized `blockchain.transaction_hash` (provider log-index suffix `-<number>` is stripped).
- Skips blockchain transactions with no movements.
- Produces auto-confirmed, 100%-confidence links across different `accountId`s within the same normalized on-chain tx hash.

These links use “primary movement” amounts (prefers first outflow gross amount, otherwise first inflow gross amount).

## Transfer Processing (Lot Matching)

When cost basis lot matching processes transactions (strategy-agnostic core, e.g. FIFO):

**Required configuration**:

- Transfer handling requires `jurisdiction.sameAssetTransferFeePolicy` to be provided; otherwise the matcher errors when it encounters a linked transfer source.

### Source Side (Outflow)

If a confirmed link is found for `(tx.id, asset, amount)` where `amount = outflow.netAmount ?? outflow.grossAmount`:

- The outflow is treated as a transfer source.
- The transferred amount is **not** treated as a taxable disposal.
- The system creates `LotTransfer` records to move cost basis from matched source lots to the target.
- Depending on jurisdiction policy, same-asset crypto transfer fees are either:
  - **disposed** (taxable), or
  - **added to basis** (no immediate disposal).

### Target Side (Inflow)

If a confirmed link is found for `(tx.id, asset)`:

- All inflows of that asset in the transaction are aggregated into a single amount (sum of `inflow.netAmount ?? inflow.grossAmount`).
- A new acquisition lot is created at the target with:
  - quantity = aggregated inflow amount
  - inherited cost basis from the `LotTransfer` records for that link
  - fiat fees (from both source and target transactions) added when priced

If no `LotTransfer` records exist for the link, the matcher errors (this usually indicates the source was not processed before the target).

## Fee Handling

Fees are handled based on the jurisdiction's tax laws.

### Taxonomy

- **Network Fee**: Paid to miners/validators (e.g., Gas).
- **Platform Fee**: Paid to the exchange (e.g., Withdrawal fee).

### Tax Treatments

| Policy           | Description                                                                                                     | Typical Jurisdiction                 |
| :--------------- | :-------------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| **Disposal**     | Fee is treated as a spending event. You "sold" the crypto to pay the fee. Triggers Gain/Loss on the fee amount. | **USA (IRS)**, **UK (HMRC)**, **EU** |
| **Add-to-Basis** | Fee is added to the cost basis of the transferred asset. No immediate tax event.                                | **Canada (CRA)**                     |

The matcher is configured via `jurisdiction.sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis'`.

## Reconciliation & Variance

The system uses multiple, distinct validation paths with different tolerances:

### Link Amount Validation (Link Creation)

At link creation time:

- Reject `targetAmount > sourceAmount`
- Reject variance > 10%

### Outflow Fee Validation (Hidden/Missing Fee Detection)

When processing a transfer source outflow, if `outflow.netAmount` exists:

- The matcher validates:
  - `expectedNet = outflow.grossAmount - sum(on-chain fees in same asset)`
  - `hiddenFee = abs(expectedNet - outflow.netAmount)`
  - `variancePct = hiddenFee / expectedNet * 100`
- If `variancePct` exceeds the **error threshold**, matching fails with an error describing the implied hidden fee.

Tolerance is source-specific by `tx.source` (with optional config override):

- `kraken`: warn 0.5%, error 2.0%
- `coinbase`: warn 1.0%, error 3.0%
- `binance`: warn 1.5%, error 5.0%
- `kucoin`: warn 1.5%, error 5.0%
- `default`: warn 1.0%, error 3.0%

### Transfer Amount Variance (Link vs Movements)

The matcher validates transfer consistency twice:

- Source-side: compares `outflow.netAmount` (or `grossAmount`) to `link.targetAmount`
- Target-side: compares total `LotTransfer.quantityTransferred` to the target inflow quantity

Exceeding error tolerance fails the calculation; exceeding warning tolerance may emit warnings in logs.

## Data Model

### `transaction_links` (transfer-critical fields)

- `asset` (TEXT) — transferred asset symbol
- `source_amount` (TEXT) — amount used for link matching (`movement.netAmount ?? movement.grossAmount`)
- `target_amount` (TEXT) — amount used for link matching (`movement.netAmount ?? movement.grossAmount`)
- Indexes on `(source_transaction_id, asset, source_amount)` and `(target_transaction_id, asset)` for O(1) lookup.

### `transaction_links.metadata_json`

`metadata_json` is an untyped key/value record. Current uses include:

- link variance metadata: `variance`, `variancePct`, `impliedFee` (all stored as strings)
- internal blockchain link metadata: `blockchainTxHash`, `blockchain`

### `lot_transfers` Table

Tracks the movement of specific tax lots between transactions (cost basis flow via links).

```sql
CREATE TABLE lot_transfers (
  id TEXT PRIMARY KEY,
  calculation_id TEXT NOT NULL REFERENCES cost_basis_calculations(id),
  source_lot_id TEXT NOT NULL REFERENCES acquisition_lots(id),
  link_id TEXT NOT NULL REFERENCES transaction_links(id),
  quantity_transferred TEXT NOT NULL,
  cost_basis_per_unit TEXT NOT NULL,
  source_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  target_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  metadata_json TEXT
);
```

Metadata may include proportional `cryptoFeeUsdValue` when the jurisdiction uses add-to-basis.

## Fee Handling (Operational Rules)

- **Same-Asset Crypto Fees**:
  - _Disposal policy_: creates a taxable disposal for the fee amount; transfers cost basis for the remaining quantity.
  - _Add-to-basis policy_: no immediate disposal; the crypto fee’s USD value (when priced) is stored on `LotTransfer.metadata.cryptoFeeUsdValue` and added into inherited basis at the target.
- **Fiat Fees**:
  - Collected from both source and target transactions.
  - Added to target basis only when `fee.priceAtTxTime` exists (missing price is warned and skipped).
- **Third-Asset Fees**:
  - If represented as an explicit outflow movement in the fee asset, it is processed as a normal disposal for that asset.

## Importer Requirements (Compatibility)

- For transfer outflows that are linkable, populate `grossAmount` and `netAmount`.
- Per fee semantics, only fees with `settlement='on-chain'` are expected to reduce `netAmount`.
- Ensure non-fiat fees that matter to cost basis have `priceAtTxTime` when required by the calculation path.
- For third-asset fees, emit an explicit outflow movement in the fee asset when you want it treated as a disposal.

## Logical Ordering

During cost basis calculation, transactions are sorted with a dependency-aware comparator so that every linked source is ordered before its linked target, overriding raw timestamps when necessary (fixes backdated deposits / clock skew).

## Known Limitations (Current Implementation)

- Automatic deduplication keys by `sourceTransaction.id` and `targetTransaction.id`, which effectively limits automatic cross-source linking to **one link per transaction id** in each direction, even if a single transaction contains multiple outflow movements.
- `LinkIndex` supports multiple links per `(source tx, asset, amount)` (to handle batched withdrawals), but those links must already exist (e.g., created externally or manually).
