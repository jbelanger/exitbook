---
last_verified: 2025-12-18
status: draft
---

# EVM Raw Transaction Dedup & Event Identity (Routescan-Friendly)

Exitbook ingests blockchain activity in two layers:

- `raw_transactions`: provider-facing storage (normalized + raw payloads), used for reprocessing
- `transactions`: processed “universal” transactions used for accounting/reporting

This spec describes an improvement to make EVM ingestion robust for the common case where **multiple events share the same on-chain transaction hash**, and clarifies when `logIndex`-style fields are beneficial.

> ⚠️ **Code is law**: If this document disagrees with implementation, the implementation is correct and this spec must be updated.

## Quick Reference

| Concept                             | Meaning                                                  | Notes                                                   |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| **Base tx hash**                    | On-chain transaction identifier (e.g. `0xabc…`)          | Many events can share it.                               |
| **Event**                           | A single log-level movement (e.g. one ERC‑20 `Transfer`) | “Event-level” is the right granularity for raw storage. |
| `blockchain_transaction_hash` (raw) | Base tx hash                                             | Should stay “clean” (no suffixes).                      |
| `external_id` (raw)                 | Event identity                                           | Must be deterministic for resume/replay.                |
| `logIndex`                          | Canonical per-log discriminator                          | Useful for perfect event identity when available.       |

## Goals

- Allow `raw_transactions` to store **multiple rows per base tx hash** (EVM reality).
- Keep deduplication correct and deterministic (re-import/replay should not multiply rows).
- Keep `blockchain_transaction_hash` clean and semantically stable.
- Support providers that do **not** expose `logIndex` in their higher-level endpoints (e.g. Routescan `tokentx`).

## Non-Goals

- Standardizing event identity across all non-EVM chains in one change (Bitcoin/Solana have analogous patterns).
- Implementing a new ingestion operation in the importer layer.
- Perfect uniqueness in the pathological case where a single tx emits two _identical_ `Transfer` logs (see “Limitations”).

## Background: Why “Base Tx Hash Unique” Is Too Strict for Raw Storage

On EVM, a single transaction can produce multiple relevant “events”:

- a contract call (the “normal” tx)
- one or more `Transfer` logs (token movements)
- internal value transfers (call traces)

All of these share the same base tx hash.

If `raw_transactions` enforces uniqueness on `(account_id, blockchain_transaction_hash)`, then the second row for that same base hash will be rejected. Depending on repository behavior, this often appears as “skipped duplicates” and manifests as missing token movements.

This is not an exceptional edge case; it is normal for token activity.

## Current Data Model (Relevant Pieces)

In `packages/data/src/migrations/001_initial_schema.ts`:

- `raw_transactions.external_id` is `NOT NULL`
- `raw_transactions.blockchain_transaction_hash` is nullable
- historically, we had:
  - UNIQUE `(account_id, blockchain_transaction_hash)` (partial WHERE hash IS NOT NULL)
  - UNIQUE `(account_id, external_id)` (partial WHERE external_id IS NOT NULL — redundant because column is NOT NULL)

## Proposed Improvement

### 1) Raw Layer: Make Base Hash Non-Unique

`raw_transactions` should allow many rows sharing the same base tx hash. The recommended shape:

- **Remove** UNIQUE on `(account_id, blockchain_transaction_hash)`
- **Add/keep** a _non-unique_ index on `(account_id, blockchain_transaction_hash)` for performance
- **Keep** UNIQUE on `(account_id, external_id)` as the dedup guardrail

Rationale:

- `external_id` is the correct dedup key at the raw/event layer.
- `blockchain_transaction_hash` is for correlation and lookup, not uniqueness.

### 2) Clarify Identity Semantics (Terminology)

To avoid future confusion, treat these fields consistently:

- `blockchain_transaction_hash`:
  - stores the **base tx hash** only
  - never stores event ids, suffixes, or provider-specific composite ids
- `external_id`:
  - stores a deterministic **event identity**
  - may be derived from provider fields (hash + logIndex) or from normalized event content

Rename suggestion (doc-only; code may keep current names):

- “Base tx hash” instead of “blockchain tx id”
- “Event id” instead of “external id” (when discussing raw uniqueness)

### 3) Provider Variation: What Happens Without `logIndex`

Some provider endpoints return token transfers without exposing `logIndex` (e.g. Routescan `account&action=tokentx`).

That is still workable once base-hash uniqueness is removed, because:

- the raw layer can store multiple events per base hash
- dedup is handled by `(account_id, external_id)`

However, **perfect** uniqueness is not always possible without `logIndex`:

- If a single tx emits two `Transfer` logs that are identical across all fields you hash for `external_id`, those two events will collide.
- This is uncommon for typical wallets, but it is possible.

### 4) When `logIndex` Helps (Optional Enhancement)

`logIndex` becomes valuable when you want a canonical event identity that is:

- stable across replays
- guaranteed unique per log within a transaction

A common scheme:

```
event_id = `${transactionHash}:${logIndex}`
```

This is an enhancement, not a prerequisite for correctness once the raw base-hash uniqueness is removed.

#### Routescan Improvement Path (Big Picture)

Routescan’s `tokentx` endpoint may omit per-log discriminators like `logIndex`. If we want canonical `event_id`s for Routescan (matching Moralis-grade identity), a future improvement is to derive token transfers from Routescan’s `logs/getLogs` topic queries (or transaction receipts where available) so `logIndex` can be included in event identity. This is optional once raw base-hash uniqueness is removed, but it improves dedup precision and makes resume/replay behavior more robust.

## Behavioral Rules / Invariants

- **Raw storage invariant:** multiple `raw_transactions` rows MAY share the same `(account_id, blockchain_transaction_hash)`.
- **Raw dedup invariant:** within an account, `external_id` MUST uniquely identify an event.
- **Correlation invariant:** processing may correlate multiple raw rows that share a base tx hash into a single `transactions` row (EVM correlation).
- **No silent hiding:** if `external_id` collisions are detected (same event id but different underlying payload), prefer warning+fail over silent merge.

## Edge Cases & Gotchas

- **Self-transfers:** a wallet can be both sender and receiver; provider-level queries may return the same event twice. Dedup must be by event identity.
- **ERC‑20 vs ERC‑721:** both use the `Transfer` signature; without contract introspection, “amount vs tokenId” interpretation is ambiguous.
- **Replay windows:** cursor replay can re-fetch previously stored events; uniqueness must be on event id, not base hash.

## Known Limitations

- Without a provider-exposed per-log discriminator (`logIndex`), the system cannot _guarantee_ uniqueness for two identical logs in one tx. This is rare but real.

## Related Specs

- `docs/specs/pagination-and-streaming.md` — cursor/resume model and replay windows
- `docs/specs/accounts-and-imports.md` — importer boundaries and storage layers

---

_Last updated: 2025-12-18_
