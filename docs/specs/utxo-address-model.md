---
last_verified: 2026-04-13
status: canonical
---

# UTXO Per-Address Model Specification

> ⚠️ **Code is law**: If this spec drifts from implementation, update the spec.

How Exitbook ingests, stores, and processes UTXO blockchains (Bitcoin family, Cardano) using a per-address perspective instead of wallet-wide deduplication.

## Quick Reference

| Concept             | Key Rule                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage granularity | Legacy raw + processed rows stay per `(account_id, tx_hash)`; ledger-v2 source activities are owned by the root wallet account                             |
| Adapter model       | `chainModel: 'utxo'` enables per-address handling (Bitcoin\*, Cardano)                                                                                     |
| Fund-flow scope     | Processed rows remain per-address; Bitcoin stays `primaryAddress`-only, while Cardano may use sibling ownership summary without aggregating processed rows |
| Operation type      | All UTXO movements are recorded as `category: 'transfer', type: 'transfer'`                                                                                |
| Fees                | Network fees use `settlement='on-chain'`; outflow `grossAmount` already includes the fee, so balance calc skips subtracting it again                       |
| Internal linking    | Transactions with the same `blockchain_transaction_hash` across accounts are auto-linked as `blockchain_internal`                                          |

## Goals

- **Correct per-address perspective:** Preserve each address’s view of a UTXO transaction so change detection and balances are accurate.
- **Eliminate wallet-wide duplication:** Avoid N× copies that sum all sibling addresses; keep one row per address/tx.
- **Consistent downstream math:** Ensure balance, fee treatment, and transfer linking behave predictably for UTXO chains.

## Non-Goals

- Tax semantics or fee jurisdiction policy (covered in `transfers-and-tax.md`).
- Provider-level UTXO retrieval details (see provider docs/tests).
- Wallet discovery/derivation rules (see `accounts-and-imports.md`).

## Definitions

### UTXO Chain Adapter Model

```ts
interface BlockchainAdapter {
  chainModel: 'account-based' | 'utxo';
}
```

Set `chainModel` to `'utxo'` for Bitcoin-like chains (`packages/ingestion/.../bitcoin/adapter.ts`) and Cardano (`.../cardano/adapter.ts`).

### Processing Context (subset)

```ts
interface ProcessingContext {
  primaryAddress: string; // the address being processed
  userAddresses: string[]; // available for deterministic sibling-ownership summary where explicitly allowed
}
```

## Behavioral Rules

### Import & Storage

- **Per-address raw rows:** For UTXO chains, imports keep one `raw_transactions` row per account/address even when the same `blockchain_transaction_hash` touches multiple derived addresses. No cross-account deduplication (see xpub import integration test expectation). Unique constraint remains `(account_id, blockchain_transaction_hash)`.
- **Xpub children:** Each derived address becomes its own account; shared tx hashes are stored separately under each child.
- **Ledger-v2 ownership:** The persisted accounting ledger writes one
  `source_activities` row per wallet-owned blockchain transaction hash. Its
  `owner_account_id` is the root wallet/xpub account; raw assignments may point
  at any descendant child-address raw rows for that same hash.

### Fund-Flow Analysis & Classification

- **Scope root:** Processed UTXO rows remain per-address. No UTXO processor may collapse multiple owned addresses into one wallet-scope processed transaction.
- **Ledger scope:** Ledger-v2 processors use the root wallet account as the
  accounting owner and receive the derived child addresses as `walletAddresses`.
  This wallet scope applies only to the ledger shadow/cutover path, not to
  legacy processed rows.
- **Bitcoin scope:** Bitcoin-family fund-flow functions examine only `context.primaryAddress`.
- **Cardano scope:** Cardano still persists one processed row per derived payment address, but may consult deterministic sibling ownership summary across `context.userAddresses` for two purposes only:
  - proportionally allocating the shared on-chain ADA fee across sibling owned inputs
  - deciding whether a wallet-scoped staking withdrawal can be attributed to exactly one owned input address
- **Transaction type:** Always returns `'transfer'`; processors do not attempt deposit/withdrawal heuristics without sibling addresses.
- **Fee payer detection:** User pays the fee only when their inputs are spent (`walletInput > 0` for Bitcoin; `userOwnsInput` for Cardano). Fees are recorded as network, `settlement='on-chain'`.

### Cardano Wallet-Scoped Withdrawal Handling

Cardano stake withdrawals are wallet-scope, not child-payment-address-scope.

Under the current canonical per-address model:

- if exactly one owned input address participates, the withdrawal may be emitted on that processed row as:
  - ADA inflow
  - `movementRole='staking_reward'`
- if multiple owned input addresses participate, the withdrawal must not be heuristically split across children
- instead, the processor:
  - keeps the per-address processed rows
  - emits `unattributed_staking_reward_component`
  - does not emit `classification_uncertain` when the only remaining ambiguity is the wallet-scoped staking residual already modeled through explained transfer residual handling

This preserves per-address processed provenance without forcing wallet-scope processed transaction aggregation.

### Movements & Fees

- **Outflow grossAmount (UTXO):** Represents inputs minus change; already includes on-chain fee when the user spends. `netAmount = grossAmount - fee` when the user paid the fee (never negative).
- **Inflows:** Include outputs to the processed address only.
- **Fees array:** Present only when the user paid; asset = chain native (`feeCurrency` fallback). `settlement='on-chain'` ensures the shared balance-impact math skips double subtraction.

### Balance Calculation

- Balance math uses movement `grossAmount` for both inflows and outflows. For UTXO chains, on-chain fees are already embedded in outflow gross and therefore skipped by the shared transaction balance-impact helper and `calculateBalances()`.

### Internal Transfer Linking

- Linker groups blockchain transactions by normalized `blockchain_transaction_hash`, then by `assetId`, across accounts.
- Confirmed `blockchain_internal` links are emitted only for unambiguous same-hash groups with exactly one pure outflow participant and one or more pure inflow participants for that asset.
- Ambiguous same-hash groups are skipped with warnings rather than collapsed heuristically.
- Internal links are created only for cross-account pairs; same-account pairs are ignored for link creation.

### Derived Address Metadata

- UTXO processors must preserve per-address processed rows.
- Bitcoin-family processors do not use sibling metadata.
- Cardano may use sibling ownership summary as a deterministic aid for fee allocation and wallet-scoped withdrawal diagnostics, but not to create wallet-scope processed transactions.

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

1. **Import:** UTXO adapters stream transactions per address; importer writes a row per `(account, tx_hash)` without deduping siblings.
2. **Process:** Processor produces per-address processed rows; Cardano may use sibling ownership summary for deterministic fee allocation and wallet-scoped withdrawal diagnostics without changing the per-address storage granularity.
3. **Ledger shadow:** For v2-enabled UTXO chains, processing uses the current
   child-account batch for legacy output, then loads same-hash raw rows across
   the root wallet scope to replace one parent-owned source activity.
4. **Balance:** `buildTransactionBalanceImpact()` / `calculateBalances()` subtract and add movement gross; on-chain fees are already embedded and are not subtracted a second time.
5. **Linking:** `transaction-linking-service` auto-links same `blockchain_transaction_hash` across accounts as internal transfers.

## Invariants

- Each UTXO transaction appears at most once per account (DB unique constraint) and may appear in multiple accounts when multiple derived addresses are involved.
- UTXO processors must not collapse sibling addresses into one wallet-scope processed transaction.
- Ledger-v2 UTXO source activities must use the root wallet account as
  `owner_account_id`; child address rows remain raw/import provenance.
- Bitcoin-family processors must remain `primaryAddress`-only.
- Cardano may use sibling ownership summary only for deterministic per-address refinements that preserve one processed row per address/tx.
- UTXO movements must set `operation.type = 'transfer'`.
- Network fees for UTXO chains use `settlement='on-chain'`; shared balance-impact math must not subtract them again.

## Edge Cases & Gotchas

- **Change outputs:** Recorded as inflows to the same address; outflow gross already accounts for change, so balances remain correct.
- **Multi-asset Cardano tx:** Consolidation is per-asset; largest movement chosen as primary for display, but all assets are stored in movements.
- **Zero-amount artifacts:** Fund-flow helpers drop zero amounts; classification uncertainty is recorded for complex multi-asset batches.
- **Cardano wallet-scoped rewards:** A wallet-scoped withdrawal in a multi-input xpub transaction may remain diagnostic-only when it cannot be attributed to one derived address safely.
- **Legacy duplicates:** Pre-change wallet-wide duplicates may still exist; they are not auto-migrated but do not violate per-account uniqueness.

## Known Limitations

- Transaction type granularity is limited (always `transfer`); non-principal semantics live on movement roles and diagnostics rather than operation type.
- Internal linking requires matching hashes; provider hash mismatches or missing hashes prevent auto-links.
- Fee payer detection relies on presence of user inputs; malformed provider data can mark fees as unpaid.

## Related Specs

- [Accounts & Imports](./accounts-and-imports.md) — xpub child account creation and cursor handling.
- [Transaction Linking](./transaction-linking.md) — same-hash grouping and internal-link reduction on top of per-address UTXO transactions.
- [Transfers & Tax](./transfers-and-tax.md) — how internal links affect basis and fees.
- [Pagination & Streaming](./pagination-and-streaming.md) — cursor structures used by UTXO importers.

---

_Last updated: 2026-04-13_
