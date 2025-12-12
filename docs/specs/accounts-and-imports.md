---
last_verified: 2025-12-12
status: canonical
---

# Accounts & Imports Specification

> ⚠️ **Code is law**: If this disagrees with implementation, update the spec to match code.

How Exitbook represents accounts (identity/state) and executes imports (sessions, cursors, dedupe) across blockchains, exchange APIs, and exchange CSVs.

## Quick Reference

| Concept             | Key Rule                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Account identity    | Unique on `(accountType, sourceName, identifier, COALESCE(userId,0))`                                    |
| Import resumability | Latest `started` or `failed` session is resumed; status reset to `started`                               |
| Cursor storage      | Stored per `operationType` in `accounts.lastCursor`; merged, not replaced                                |
| CSV directory lock  | One exchange-csv account per user+exchange; directory must match                                         |
| Dedupe              | `raw_transactions` unique on `(account_id, external_id)` and `(account_id, blockchain_transaction_hash)` |
| xpub children       | Reused if present; no re-derivation on subsequent imports                                                |

## Goals

- **Stable identity & state**: Persist a canonical account per source so imports and verifications attach consistently.
- **Resumable, memory-bounded imports**: Stream batches with persisted cursors and session history.

## Non-Goals

- Post-import processing into universal transactions or accounting logic.
- Pricing/linking/balance calculation logic (only storage location noted).

## Definitions

### Account (domain schema)

```ts
{
  id: number,
  userId?: number,          // NULL = tracking-only
  parentAccountId?: number, // xpub child linkage
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv',
  sourceName: string,       // e.g., 'bitcoin', 'kraken'
  identifier: string,       // address/xpub, apiKey, or CSV directory
  providerName?: string,
  credentials?: { apiKey: string; apiSecret: string; apiPassphrase?: string },
  lastCursor?: Record<string, CursorState>,
  lastBalanceCheckAt?: Date,
  verificationMetadata?: VerificationMetadata,
  createdAt: Date,
  updatedAt?: Date
}
```

### Import Session

```ts
{
  id: number,
  accountId: number,
  status: 'started' | 'completed' | 'failed' | 'cancelled',
  startedAt: Date,
  completedAt?: Date,
  durationMs?: number,
  transactionsImported: number,
  transactionsSkipped: number,
  errorMessage?: string,
  errorDetails?: unknown
}
```

### CursorState (per operation type)

See [Pagination and Streaming](./pagination-and-streaming.md#cursorstate) for full schema. Key fields for this spec:

- `primary`: cursor used for same-provider resume
- `metadata.isComplete`: authoritative “done” signal
- `totalFetched`: cumulative count across batches (including resumed progress)

## Behavioral Rules

### Account Identity & Tenancy

- Accounts are unique per `(accountType, sourceName, identifier, COALESCE(userId,0))`; attempts to duplicate fail DB constraint. (`001_initial_schema`, AccountRepository.findOrCreate)
- Tracking-only accounts (`userId` NULL) are global; owned accounts are per user.
- CLI `accounts view` lists only owned accounts for default user (id=1); tracking-only are hidden.

### Blockchain Imports

- Addresses/xpubs normalized before account creation/import. (`blockchainAdapter.normalizeAddress`)
- If input is xpub and adapter supports derivation:
  - Parent account: identifier = xpub.
  - Child accounts per derived address with `parentAccountId = parent.id`.
  - If parent already has children, reuse them (no new derivation/gap scan).
  - Child imports run independently; overall xpub import errors only if all children fail.
- `--xpub-gap` ignored (warn) when input is not an xpub.

### Exchange API Imports

- Account identifier = API key; credentials validated via Zod and stored on account.

### Exchange CSV Imports

- Identifier = single CSV directory path.
- If an exchange-csv account exists for the user with a different directory, import errors instructing reuse or deletion.

### Import Sessions & Resumability (Current Behavior)

| Condition                                   | Behavior                                                      |
| ------------------------------------------- | ------------------------------------------------------------- |
| Latest session status `started` or `failed` | Resume same session; status set to `started`; totals continue |
| No incomplete session                       | Create new session with status `started`                      |

### Streaming & Cursor Persistence

- Importers yield batches: `{ rawTransactions[], operationType, cursor, isComplete }`.
- After each batch:
  - Persist raw transactions; unique collisions counted as `skipped`, import continues.
  - Update `accounts.lastCursor[operationType]` (merge). Cursor update failures log `warn` but do not fail import.
- Finalize session with totals and status `completed` (or `failed` on error).

### Verification Metadata Storage

- Balance verification results live on the Account (`lastBalanceCheckAt`, `verificationMetadata`), not per session.
- CLI status: `never-checked` (no metadata), `match`, `mismatch` (warnings also stored as `mismatch`).

## Data Model

### accounts (SQLite via Kysely)

```sql
id INTEGER PK,
user_id INTEGER NULL REFERENCES users(id),
parent_account_id INTEGER NULL REFERENCES accounts(id),
account_type TEXT NOT NULL,
source_name TEXT NOT NULL,
identifier TEXT NOT NULL,
provider_name TEXT NULL,
credentials TEXT NULL,            -- JSON ExchangeCredentials
last_cursor TEXT NULL,            -- JSON Record<operationType, CursorState>
last_balance_check_at TEXT NULL,
verification_metadata TEXT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
updated_at TEXT NULL
-- Unique: (account_type, source_name, identifier, COALESCE(user_id,0))
-- Index: uq_accounts_identity (account_type, source_name, identifier, COALESCE(user_id,0))
```

#### Field Semantics

- `identifier`: address/xpub (blockchain), API key (exchange-api), CSV directory (exchange-csv).
- `parent_account_id`: xpub child linkage; NULL for roots.
- `last_cursor`: per-operation progress map.
- `verification_metadata`: latest balance verification snapshot.

### import_sessions

```sql
id INTEGER PK,
account_id INTEGER NOT NULL REFERENCES accounts(id),
status TEXT NOT NULL DEFAULT 'started',
started_at TEXT NOT NULL,
completed_at TEXT NULL,
duration_ms INTEGER NULL,
transactions_imported INTEGER NOT NULL DEFAULT 0,
transactions_skipped INTEGER NOT NULL DEFAULT 0,
error_message TEXT NULL,
error_details TEXT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
updated_at TEXT NULL
```

### raw_transactions

```sql
id INTEGER PK,
account_id INTEGER NOT NULL REFERENCES accounts(id),
provider_name TEXT NOT NULL,
external_id TEXT NOT NULL,
source_address TEXT NULL,
blockchain_transaction_hash TEXT NULL,
transaction_type_hint TEXT NULL,
provider_data TEXT NOT NULL,
normalized_data TEXT NOT NULL,
processing_status TEXT NOT NULL DEFAULT 'pending',
processed_at TEXT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
-- Unique: (account_id, blockchain_transaction_hash) WHERE hash IS NOT NULL
-- Unique: (account_id, external_id) WHERE external_id IS NOT NULL
-- Indexes: uq_raw_tx_hash_per_account, uq_raw_tx_external_id_per_account
```

## Pipeline / Flow

```mermaid
graph TD
    A[CLI command] --> B[Normalize inputs]
    B --> C[Ensure default user]
    C --> D[Find or create Account (xpub children if needed)]
    D --> E[Resume or create Import Session]
    E --> F[Importer streams batches]
    F --> G[Persist raw_transactions + update cursor/totals]
    G --> F
    F -->|done| H[Finalize session: completed]
    F -->|error| I[Finalize session: failed]
    G -->|cursor update fails| J[Log warn, continue]
```

## Invariants

- **Required**: Account uniqueness constraint must hold; enforced by DB index.
- **Required**: Resume uses latest `started/failed` session; enforced in ImportSessionRepository.findLatestIncomplete + orchestrator.
- **Required**: Cursor updates merge per operation; enforced in AccountRepository.updateCursor.
- **Required**: Raw transaction uniqueness per account enforced by DB unique indexes; collisions counted as skipped, not fatal.
- **Required**: Xpub children reuse if already present; no re-derivation.

## Edge Cases & Gotchas

- Providing `--xpub-gap` with a non-xpub address logs a warning and is ignored.
- Xpub import with zero derived addresses returns success with empty session list.
- Cursor persistence failures do not stop import—can lead to re-fetch on next run.
- Existing exchange-csv account with different directory aborts import with guidance.

## Known Limitations (Current Implementation)

- CLI cannot list tracking-only accounts; visibility limited to default user’s owned accounts.
- Xpub gap cannot be expanded automatically if children already cached.
- No metrics/telemetry; observability relies on logs and session totals.

## Related Specs

- [Pagination and Streaming](./pagination-and-streaming.md) — cursor model, streaming contract, provider failover
- [Fee Semantics](./fees.md) — how raw transactions become movements with fee metadata

---

_Last updated: 2025-12-12_
