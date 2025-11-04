# ADR-005: Fee Semantics Normalization

## Status

Accepted – implementation in progress.

## Context

Exitbook now ingests transactions from a wide range of exchanges and blockchains. Every venue expresses fees differently:

- Kraken debits withdrawal principal and an additional platform fee.
- Account-based chains charge gas directly from the transferred asset.
- Some exchanges deduct fees from a different asset balance.

Our current model stores a single `amount` per movement and only an untyped `network` vs. `platform` fee split. During cost-basis, the lot matcher subtracts every same-asset fee from the transfer outflow before matching. That works only when the fee actually reduces the on-chain transfer. For Kraken, the fee comes from an extra ledger debit, so the transfer quantity remains intact. We subtract the fee anyway, see a mismatch, and throw `Transfer amount mismatch…`.

This ambiguity also complicates tax treatment: jurisdictions care whether fees are network, platform, or spread, and whether they came out of the transfer or a separate balance.

## Problem

We lack the metadata to distinguish:

1. **On-chain fees** (gas, miner tips) – reduce the transfer amount.
2. **Platform/off-chain fees** – charged separately, do not affect the transfer quantity.
3. **Cross-asset fees** – paid in a different currency.

Without that clarity, transfer reconciliation fails, and cost-basis either double-counts or rejects valid transactions.

## Decision

Introduce explicit gross/net movement amounts and richer fee semantics across ingestion, storage, and accounting. The lot matcher will subtract only on-chain fees while platform/off-chain fees remain available for cost-basis policy decisions without distorting transfer quantities.

### Data Model Enhancements

**Movements**

- `grossAmount: Decimal` – amount the venue debited/credited.
- `netAmount: Decimal` – amount transmitted/received on chain; defaults to `grossAmount`.
- Optional `movementId` to reference specific movements from fee entries.

**Fees**

- `scope: 'network' | 'platform' | 'spread' | 'tax' | 'other'`.
  - network – “Did this fee pay miners/validators?”
    Why it matters:
  - Only these should reduce transfer net amounts.
  - Some jurisdictions treat network fees differently for deduction or basis adjustments.
  - Alerting: a network fee in fiat or a non-native asset is usually a data bug (unless wrapped networks are involved).
  - platform – “Was this revenue for the venue (withdrawal fee, maker/taker, service charge)?”
    Why it matters:
  - Tax reporting often separates exchange fees from blockchain fees.
  - Discounts (e.g., paying in BNB) fall here, and you typically decide whether to add them to basis or treat them as expenses.
  - spread – “Is this the implicit fee baked into a swap/quote?”
    Why it matters:
  - For brokers or RFQ desks, you might not see an explicit fee field; you derive it when actual fill price deviates from quoted mid.
  - Having a flag lets you surface hidden costs or adjust gain/loss calculations without double-counting.
  - tax – “Did the venue collect a regulatory levy (FATCA, GST/VAT)?”
    Why it matters:
  - Users need these isolated for compliance and potential deductions or credits.
  - other – Catch-all for edge cases (penalties, interest, staking commissions) until a more specific bucket emerges.
- `settlement: 'on-chain' | 'external' | 'balance'`.
  - settlement='on-chain': the fee is literally carved out of the on-chain transfer (typical gas/miner fee). The transfer’s netAmount is smaller than
    the grossAmount, and the blockchain receipt shows the reduced amount.
  - settlement='balance': the venue deducts the fee from your custodied balance via a separate ledger entry (Kraken example). The on-chain transfer
    stays at the full grossAmount.
  - settlement='external': the fee is paid from an outside funding source that never hits your exchange balance or the on-chain transfer—for example a card
    settlement, subscription invoice, or ACH debit. We rarely see this today, but keeping the enum slot future-proofs the model and prevents developers from overloading balance when no on-ledger movement exists. Would be reserved for the rarer cases where the fee never touches any of your tracked balances or the on-chain transfer—think ACH debits, credit-card charges, or invoiced service fees paid outside the exchange ecosystem. If you’re not ingesting those yet, you can safely ignore external for now and treat all current exchange/chain scenarios as either on-chain or balance.
- Optional `fundedFromMovementId` for cross-references.
- Existing money fields remain unchanged.

Update Zod schemas in `packages/core/src/schemas/universal-transaction.ts`, persistence logic in `packages/platform/data/src/repositories/transaction-repository.ts`, and any JSON serialization that touches `movements` or `fees`.

### Ingestion Responsibilities

Each processor populates the new fields based on venue metadata. Examples:

1. **Platform fee, billed off-chain (Kraken BTC withdrawal)**
   - Movement: `gross=0.00648264 BTC`, `net=0.00648264 BTC`.
   - Fee: `amount=0.0004 BTC`, `scope='platform'`, `settlement='balance'`.
   - Rationale: Kraken debits a separate ledger line; on-chain amount is unaffected.

2. **Native network fee deducted in-flight (Ethereum withdrawal)**
   - Movement: `gross=1.5000 ETH`, `net=1.4990 ETH` (gas 0.0010).
   - Fee: `amount=0.0010 ETH`, `scope='network'`, `settlement='on-chain'`, `fundedFromMovementId` referencing the ETH outflow.

3. **Fee paid from another asset (Binance withdraws BTC, charges fee in BNB)**
   - BTC movement: `gross=0.25 BTC`, `net=0.25 BTC`.
   - Fee: `amount=0.0005 BNB`, `scope='platform'`, `settlement='balance'`.
   - If Binance records a separate BNB ledger entry, processor emits a corresponding BNB movement.

Processors across exchanges and blockchains must follow the same conventions so downstream logic can rely on consistent semantics.

### Lot Matcher Updates

- `extractCryptoFee` filters fees to same-asset entries with `settlement === 'on-chain'`.
- `calculateTransferDisposalAmount` uses `movement.netAmount` when sizing the transfer; `grossAmount` is retained for audit/reporting.
- `handleTransferTarget` compares source and target `netAmount` values. Variance tolerances now capture only genuine mismatches.
- Jurisdiction rules (disposal vs. add-to-basis) continue to apply to the fee entries, independent of transfer sizing.

### Migration Plan

1. **Schema rollout** – add new fields with defaults (`netAmount = grossAmount`, `settlement = 'balance'`) so existing data remains valid.
2. **Incremental processor updates** – venue by venue, start emitting the new metadata. Guard with a feature flag while rolling out.
3. **Reprocess historical sessions** – once a venue is updated, rerun its ingestion to backfill accurate fee metadata.
4. **Remove fallbacks** – when all venues comply, drop the compatibility shims.

### Consequences

- Transfer reconciliation becomes deterministic even with mixed fee models.
- Cost-basis rules operate on accurate semantics without corrupting transfer amounts.
- Reports gain richer fee breakdowns (for deductibility, spreads, taxes).
- Stored JSON payloads grow slightly, an acceptable trade-off for correctness.
- Implementation touches multiple layers and requires coordinated rollout.

## Implementation Checklist

- [ ] Update movement/fee schemas and shared types.
- [ ] Adjust SQLite persistence and repositories.
- [ ] Enhance ingestion processors (Kraken first, followed by other venues).
- [ ] Modify lot matcher utilities and strategies to use `netAmount` and fee metadata.
- [ ] Add tests covering the three fee archetypes.
- [ ] Provide data migration scripts or re-ingestion docs for historical sessions.
