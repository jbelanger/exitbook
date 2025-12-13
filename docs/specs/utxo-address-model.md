---
last_verified: 2025-12-13
status: canonical
---

# UTXO Per-Address Model Specification

> ⚠️ **Code is law**: If this spec drifts from implementation, update the spec.

How Exitbook ingests, stores, and processes UTXO blockchains (Bitcoin family, Cardano) using a per-address perspective instead of wallet-wide deduplication.

## Quick Reference

| Concept             | Key Rule                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Storage granularity | One raw + processed record per `(account_id, tx_hash)`; no cross-account dedup for UTXO chains                                       |
| Adapter flag        | `blockchainAdapter.isUTXOChain = true` enables per-address handling (Bitcoin\*, Cardano)                                             |
| Fund-flow scope     | Processors analyze only `primaryAddress`; `derivedAddresses`/`userAddresses` are ignored for UTXO chains                             |
| Operation type      | All UTXO movements are recorded as `category: 'transfer', type: 'transfer'`                                                          |
| Fees                | Network fees use `settlement='on-chain'`; outflow `grossAmount` already includes the fee, so balance calc skips subtracting it again |
| Internal linking    | Transactions with the same `blockchain_transaction_hash` across accounts are auto-linked as `blockchain_internal`                    |

## Goals

- **Correct per-address perspective:** Preserve each address’s view of a UTXO transaction so change detection and balances are accurate.
- **Eliminate wallet-wide duplication:** Avoid N× copies that sum all sibling addresses; keep one row per address/tx.
- **Consistent downstream math:** Ensure balance, fee treatment, and transfer linking behave predictably for UTXO chains.

## Non-Goals

- Tax semantics or fee jurisdiction policy (covered in `transfers-and-tax.md`).
- Provider-level UTXO retrieval details (see provider docs/tests).
- Wallet discovery/derivation rules (see `accounts-and-imports.md`).

## Definitions

### UTXO Chain Adapter Flag

```ts
interface BlockchainAdapter {
  isUTXOChain?: boolean; // true => per-address model
}
```

Set to `true` for Bitcoin-like chains (`packages/ingestion/.../bitcoin/adapter.ts`) and Cardano (`.../cardano/adapter.ts`).

### Processing Context (subset)

```ts
interface ProcessingContext {
  primaryAddress: string; // the address being processed
  userAddresses: string[]; // ignored for UTXO chains
}
```

## Behavioral Rules

### Import & Storage

- **Per-address raw rows:** For UTXO chains, imports keep one `raw_transactions` row per account/address even when the same `blockchain_transaction_hash` touches multiple derived addresses. No cross-account deduplication (see xpub import integration test expectation). Unique constraint remains `(account_id, blockchain_transaction_hash)`.
- **Xpub children:** Each derived address becomes its own account; shared tx hashes are stored separately under each child.

### Fund-Flow Analysis & Classification

- **Scope:** Bitcoin/Cardano fund-flow functions (`analyzeBitcoinFundFlow`, `analyzeCardanoFundFlow`) examine only `context.primaryAddress`. Sibling/derived addresses are intentionally excluded.
- **Transaction type:** Always returns `'transfer'`; processors do not attempt deposit/withdrawal heuristics without sibling addresses.
- **Fee payer detection:** User pays the fee only when their inputs are spent (`walletInput > 0` for Bitcoin; `userOwnsInput` for Cardano). Fees are recorded as network, `settlement='on-chain'`.

### Movements & Fees

- **Outflow grossAmount (UTXO):** Represents inputs minus change; already includes on-chain fee when the user spends. `netAmount = grossAmount - fee` when the user paid the fee (never negative).
- **Inflows:** Include outputs to the processed address only.
- **Fees array:** Present only when the user paid; asset = chain native (`feeCurrency` fallback). `settlement='on-chain'` ensures balance calculator skips double subtraction.

### Balance Calculation

- Balance math uses movement `grossAmount` for both inflows and outflows. For UTXO chains, on-chain fees are already embedded in outflow gross and therefore skipped in the fee loop (`settlement='on-chain'` guard in `balance-calculator.ts`).

### Internal Transfer Linking

- Linker groups transactions by normalized `blockchain_transaction_hash` across accounts. When the same hash appears on multiple accounts, it emits confirmed `blockchain_internal` links (confidence 1.0) using the first outflow/inflow gross amounts as link quantities.
- Links are only created when hashes match and assets can be extracted on both sides; same-account pairs are ignored.

### Derived Address Metadata

- When `adapter.isUTXOChain === true`, processors are invoked without `derivedAddresses`/sibling metadata; per-address analysis is mandatory.

## Data Model

### raw_transactions (relevant fields)

```sql
account_id INTEGER NOT NULL,
blockchain_transaction_hash TEXT NULL,
-- Unique: (account_id, blockchain_transaction_hash) WHERE hash IS NOT NULL
```

Stores one row per address/tx. No uniqueness across accounts, allowing multiple views of the same hash.

### Processed Transaction (UTXO semantics)

- `movements.outflows[0].grossAmount`: inputs minus change (includes fee when user spent).
- `movements.outflows[0].netAmount`: gross minus fee (floor at zero).
- `movements.inflows`: only outputs to the processed address.
- `fees[]`: network, `settlement='on-chain'`, only when the user paid.
- `operation.type`: `'transfer'`.

## Pipeline / Flow

1. **Import:** Adapter marked `isUTXOChain` streams transactions per address; importer writes a row per `(account, tx_hash)` without deduping siblings.
2. **Process:** Processor receives `primaryAddress` only; produces movements/fees per-address; classifies as transfer.
3. **Balance:** `calculateBalances` subtracts/ adds movement gross; skips on-chain fees for UTXO chains.
4. **Linking:** `transaction-linking-service` auto-links same `blockchain_transaction_hash` across accounts as internal transfers.

## Invariants

- Each UTXO transaction appears at most once per account (DB unique constraint) and may appear in multiple accounts when multiple derived addresses are involved.
- UTXO processors must not use `derivedAddresses` or multi-address aggregation.
- UTXO movements must set `operation.type = 'transfer'`.
- Network fees for UTXO chains use `settlement='on-chain'`; balance calculator must not subtract them again.

## Edge Cases & Gotchas

- **Change outputs:** Recorded as inflows to the same address; outflow gross already accounts for change, so balances remain correct.
- **Multi-asset Cardano tx:** Consolidation is per-asset; largest movement chosen as primary for display, but all assets are stored in movements.
- **Zero-amount artifacts:** Fund-flow helpers drop zero amounts; classification uncertainty is recorded for complex multi-asset batches.
- **Legacy duplicates:** Pre-change wallet-wide duplicates may still exist; they are not auto-migrated but do not violate per-account uniqueness.

## Known Limitations

- Transaction type granularity is limited (always `transfer`); semantic labeling relies on future linking/UX layers.
- Internal linking requires matching hashes; provider hash mismatches or missing hashes prevent auto-links.
- Fee payer detection relies on presence of user inputs; malformed provider data can mark fees as unpaid.

## Related Specs

- [Accounts & Imports](./accounts-and-imports.md) — xpub child account creation and cursor handling.
- [Transfers & Tax](./transfers-and-tax.md) — how internal links affect basis and fees.
- [Pagination & Streaming](./pagination-and-streaming.md) — cursor structures used by UTXO importers.

---

_Last updated: 2025-12-13_
