# EVM Processing Hash-Grouping Specification

> ⚠️ **Code is law**: If this document disagrees with implementation, the implementation is correct and this spec must be updated.

This spec documents a critical processing hazard in EVM ingestion when raw events are processed in fixed-size chunks. It describes the failure mode, its impact on balances, and the recommended solution.

## Background

- EVM imports store **raw events** in `raw_transactions` (normal, internal, token, beacon).
- Processing correlates raw events **by on-chain transaction hash** to produce a single `transactions` row.
- Current processing runs in **fixed-size chunks** of raw rows for blockchain accounts.

## Problem Statement

When raw rows are processed in fixed-size chunks, **events that share the same `blockchain_transaction_hash` can land in different chunks**. Correlation happens only within a chunk, so each chunk produces **partial fund-flow** for the same on-chain transaction. Because `transactions` enforces a unique `(account_id, blockchain_transaction_hash)` constraint, whichever partial version is saved first **wins**, and the other is silently skipped as a duplicate.

### Impact

- **Inflated or deflated balances** due to missing inflow or outflow legs.
- **Unreliable fee attribution** if the fee-bearing event is in the skipped chunk.
- **Non-deterministic results** across runs (depends on chunk boundaries).

### Typical Example

A contract call emits:

- A **normal** tx from user → contract with non-zero ETH value.
- An **internal** tx from contract → user with ETH refund/transfer.

If those rows are processed in different chunks, only one side of the flow is stored.

## Root Cause

Processing uses **row-count chunking** instead of **hash grouping**, and correlation (`groupEvmTransactionsByHash`) is limited to the chunk contents.

## Required Behavior

For blockchain accounts, **all raw rows sharing the same `blockchain_transaction_hash` must be processed together**.

## Recommended Solution (Non-Streaming, Bounded Memory)

Replace fixed-size row chunking with **hash-grouped batching**:

1. Fetch a small batch of distinct `blockchain_transaction_hash` values from pending raw rows.
2. Load **all** pending raw rows for those hashes.
3. Process and save the correlated transactions.
4. Mark those raw rows as processed.
5. Repeat.

This keeps memory bounded while guaranteeing correlation integrity.

### Query Shape (SQLite)

```sql
WITH hashes AS (
  SELECT DISTINCT blockchain_transaction_hash
  FROM raw_transactions
  WHERE account_id = ? AND processing_status = 'pending'
  ORDER BY blockchain_transaction_hash
  LIMIT ?
)
SELECT rt.*
FROM raw_transactions rt
JOIN hashes h
  ON rt.blockchain_transaction_hash = h.blockchain_transaction_hash
WHERE rt.account_id = ? AND rt.processing_status = 'pending'
ORDER BY rt.blockchain_transaction_hash, rt.id;
```

## Non-Goals

- No change to import behavior or provider pagination.
- No change to transaction correlation logic itself.
- No streaming of correlated hash groups across providers.

## Invariants

- A single on-chain transaction hash **must produce exactly one** processed `transactions` row.
- All correlated raw rows for that hash are processed in the **same batch**.
- Duplicate skipping at the processed layer must **not** mask missing fund-flow legs.

## Related Specs

- `docs/specs/accounts-and-imports.md` — importer boundaries and storage layers
- `docs/specs/pagination-and-streaming.md` — cursor/resume model
- `docs/specs/evm-raw-transaction-dedup-and-event-identity.md` — event identity and dedup
