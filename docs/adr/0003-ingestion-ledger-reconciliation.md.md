# ADR-0003 — Ingestion → Canonicalization → Ledger → Reconciliation

**Status:** Proposed **Date:** 2025-09-13 **Owner:** Architecture (Joel as lead)
**Supersedes / Amends:** Amends **ADR-0001** (contexts & boundaries) and
**reuses ADR-0002** (Event Store, Durable Outbox, Unified Event Bus,
Checkpoints) as platform primitives. &#x20;

---

## 1) Context

- Imports are **initiated by a user**.
  - **Exchanges**: user supplies their API credentials (key/secret/passphrase
    when needed).
  - **Blockchains**: we use **our** supported API providers and **our**
    keys/secrets; users never paste node keys.

- The legacy code captured “raw” data then mapped to canonical transactions, but
  it wasn’t event-sourced and didn’t leverage the durable outbox and checkpoint
  invariants we standardized. We want **Effect-TS + ES** for correctness and
  replay.&#x20;
- **Raw transactions are the source of truth.** We must be able to **rebuild
  from raw** at any time.
- **Corrections happen after canonicalization**—users edit at the
  **ledger/canonical** layer; editing blockchain payloads is too complex.
- We will add **Reconciliation** to continuously compute balances from ledger
  entries and flag mismatches; best-effort guidance (and later AI) will help
  users fix.
- We must keep strict boundaries and reuse platform infra (**single-tx append +
  outbox, persisted checkpoints, idempotent consumers**). &#x20;

---

## 2) Problem

- Importers entangle source fetching, mapping, and persistence; no clean
  replay/audit.
- Handling provider **rate limits, secrets, retries, failover, and chain
  reorgs** isn’t first-class.
- Correction at the raw level is impractical; we need **ledger-level correction
  & reconciliation**.
- Current code uses some of the intended domain commands/events, but
  **idempotency and ES wiring** are incomplete/stubbed in places.&#x20;

---

## 3) Goals & Non-Goals

**Goals**

1. **Two-phase ingestion**: Capture **raw** (auditable, replayable) →
   Canonicalize to **ledger-ready** transactions.
2. **Corrections post-canonical**: Users fix balances by adjusting
   canonical/ledger entries; never edit explorer payloads.
3. **Reconciliation engine**: Detect mismatches, identify likely
   missing/problematic txs, and offer **guided fixes** (with a future “AI hint”
   step).
4. **Hard guarantees** via ADR-0002 platform: **single-tx append** with durable
   outbox rows, idempotent consumers, **persisted checkpoints**. &#x20;

**Non-Goals**

- Building our own broker or ledger database from scratch; we rely on the
  platform packages in ADR-0002.&#x20;
- UI/Design decisions; we describe APIs and events—UI follows.

---

## 4) High-Level Decision

Introduce/rename contexts so the domain language matches reality:

- **`ingestion`** — Owns sources, credentials, rate limiting, retries, failover,
  reorg safety; emits **RawObserved** events.
- **`ledger`** — Owns canonical transactions, classification, double-entry
  entries, and **post-canonical correction**.
- **`reconciliation`** — Owns derived balances, mismatch detection, “suspect tx”
  heuristics, and user guidance (future AI hints).

All contexts **reuse** the **Unified Event Bus** APIs and invariants from
ADR-0002 (append/read/subscribe; outbox in same tx; checkpoints). &#x20;

---

## 5) Repository Layout & Boundaries

```
apps/
  api/                          # Nest shell
  workers/
    outbox/                     # existing outbox daemon
    ingestion/                  # Canonicalizer + range schedulers
    reconciliation/             # Recalc/mismatch detection schedulers
  cli/                          # admin/maintenance

packages/
  contexts/
    ingestion/
      src/{app,ports,adapters,compose,projections}
    ledger/
      src/{core,app,ports,adapters,compose,projections}
    reconciliation/
      src/{app,ports,adapters,compose,projections}
  platform/
    events/{event-store,event-bus,projections,outbox-worker,...}
  core/                         # shared kernel (Money, IDs, DomainEvent)
  contracts/                    # schemas for APIs/messages
  ui/                           # (web only)
docs/
  adr/
  runbooks/
```

Dependency direction and guardrails remain ADR-0001: **apps → contexts/platform
→ core**; contexts’ **app** never import platform directly; adapters do. Enforce
via ESLint rules from ADR-0002/0001. &#x20;

---

## 6) Streams, Categories, and Event Model

### 6.1 Ingestion (Phase A — Raw capture)

**Category:** `ingest.raw` **Streams:** `ingest-batch-${batchId}` (meta);
`ingest-raw-${rawId}` (one per raw anchor)

**Events**

- `SourceBatchStarted { batchId, source, scope, userId }`
- `RawObserved { rawId, batchId, source, externalId, checksum, payloadRef }`
  - `payloadRef` =
    `{ inline?: unknown; blobUrl?: string; contentType?: string }`
  - **externalId** must be **stable** per source (e.g., `txHash:logIndex`,
    `txid:vout`)

- `SourceBatchCompleted { batchId, counts }`

**Notes**

- **Exchanges** use **user-supplied** credentials (stored via SecretsPort under
  the user’s namespace) and **exchange pullers**.
- **Blockchains** use **our** provider keys (Alchemy/Infura/Blockstream/Subscan,
  etc.).
- Raw payloads are **source of truth**; we can replay canonicalization from them
  at any time.

### 6.2 Canonicalization (Phase B — Process manager)

**Subscriber:** `Canonicalizer` subscribes category `ingest.raw` with a
**persisted checkpoint**. On `RawObserved`:

1. Map payload → **UTX** (universal transaction).
2. Call `Ledger.Commands.importTransaction(source, externalId, utx, userId)`.
3. If mapping fails → emit
   `CanonicalizationFailed { rawId, errorCode, details }` onto
   `ingest-raw-${rawId}`.

Ledger import uses **idempotency key = `source:externalId`**; duplicate
canonicalization is safe.&#x20;

### 6.3 Ledger (Canonical)

Existing events (kept, extended as necessary):

- `TransactionImported` (carries `rawData`, `source`, `externalId`,
  `userId`)&#x20;
- `TransactionClassified`
- `LedgerEntriesRecorded`
- `TransactionReversed`&#x20;

**Commands** (existing): `importTransaction`, `classifyTransaction`,
`recordEntries`, `reverseTransaction`. Keep these and ensure repository
idempotency is fully implemented (no stubs).&#x20;

### 6.4 Reconciliation (Derived) — new events

- `ReconciliationRunStarted { runId, userId, scope }`
- `AccountBalanceComputed { accountId, assetId, at, computed }`
- `MismatchDetected { accountId, assetId, at, expected, computed, suspects[] }`
- `MismatchResolved { accountId, assetId, at, resolution }`
- `GuidanceProposed { mismatchId, suggestions[] }` (future “AI hints”)

These are **read-model support events**, primarily for auditability and UX. The
**source of truth remains raw + ledger events**.

---

## 7) Ports & Adapters (Effect-TS)

### 7.1 Ingestion Ports

```ts
// ProviderClient.ts
export interface ProviderClient {
  id: string; // 'ccxt:kraken', 'evm:alchemy:eth', 'substrate:subscan:dot'
  kind: 'exchange' | 'evm' | 'utxo' | 'substrate' | 'csv';
  pull(params: {
    userId: string; // exchange: required; chain: used for scope/ownership
    address?: string; // chain sources
    fromCursor?: string | number; // block/time/page
    toHint?: string | number; // optional
  }): AsyncIterable<{ externalId: string; payload: unknown; checksum: string }>;
}

// SecretsPort.ts
export interface SecretsPort {
  getUserSecret(userId: string, key: string): Promise<string | null>; // exchange keys
  getServiceSecret(key: string): Promise<string | null>; // chain provider keys
}

// RateLimiterPort.ts
export interface RateLimiterPort {
  withLimit<T>(bucket: string, f: () => Promise<T>): Promise<T>;
}

// CheckpointPort.ts
export interface CheckpointPort {
  load(key: string): Promise<string | number | null>;
  save(key: string, cursor: string | number): Promise<void>;
}
```

**Adapters:**

- `providers/exchanges/{ccxt, coinbase, kraken}.ts` (uses **user
  secrets**)&#x20;
- `providers/{evm,utxo,substrate}.ts` (uses **service secrets**; confirmations &
  tail re-scan)
- `csv/ledgerlive.ts`, `csv/kucoin.ts` (sink change only; validation logic
  preserved)&#x20;
- `limits/tokenBucket.ts`, `http/fetchWithRetryCircuit.ts`,
  `checkpoints/platform.ts` (wrap **platform checkpoint store**)&#x20;

### 7.2 Ledger Ports (complete the idempotency)

```ts
// TransactionRepository.ts
export interface TransactionRepository {
  checkIdempotency(key: string): Effect.Effect<boolean, IdempotencyCheckError>;
  saveNew(evt: TransactionImported): Effect.Effect<void, SaveTransactionError>;
  // ... recordEntries, classify, reverse, etc.
}
```

**Implement `checkIdempotency` for real** (ES stream per key or a table),
replacing current stub.&#x20;

### 7.3 Reconciliation Ports

```ts
export interface LedgerReadPort {
  // Efficient scan of entries by account/asset/time-window
  streamEntries(params: {
    userId: string;
    accountId?: string;
    assetId?: string;
    since?: Date;
    until?: Date;
  }): AsyncIterable<LedgerEntry>;
  // Fetch latest computed balances projection
  getComputedBalance(
    userId: string,
    accountId: string,
    assetId: string,
  ): Promise<BigInt>;
}
export interface ExternalBalancePort {
  // Optional: exchange/chain snapshots for cross-check
  getExternalSnapshot(
    userId: string,
    accountId: string,
    assetId: string,
    at: Date,
  ): Promise<BigInt | null>;
}
```

---

## 8) Algorithms & Invariants

### 8.1 Raw capture (Phase A)

- **Deduplicate** (optional) by `{source, externalId, checksum}` before
  appending `RawObserved`.
- **Reorg safety (chains)**:
  - Maintain **N-block confirmation window** (e.g., 18 for EVM); re-scan tail
    each run.
  - **Advance checkpoint** only after confirmation threshold.

- **Provider failover**: ordered list per chain (e.g.,
  `alchemy→infura→etherscan`), with **rate-limit buckets** per key; **retry
  taxonomy** (timeout/429/5xx → backoff+jitter; 4xx schema → fail with
  diagnostic).

**All `append` calls run through the Unified Event Bus**, which writes events
**and** outbox rows in a **single transaction**; consumers resume by **persisted
checkpoints**. &#x20;

### 8.2 Canonicalization (Phase B)

- Map rules per provider (CSV/CCXT/explorer) to **UTX** (universal transaction)
  shapes; preserve quirky flags (e.g., dust sweeps).&#x20;
- On success → call **`importTransaction`** (idempotent
  **`source:externalId`**); on failure → `CanonicalizationFailed`.&#x20;

### 8.3 Ledger (Canonical domain)

- The aggregate maintains `TransactionImported` → `TransactionClassified` →
  `LedgerEntriesRecorded` lifecycle; double-entry balance rules live in
  services/policies.&#x20;
- Commands are already designed; **finish repository and idempotency**.

### 8.4 Reconciliation (Derived)

- **Compute balances** by folding `LedgerEntriesRecorded` per
  `(userId, accountId, assetId)` → projection `balances.current`.

- **Detect mismatch**: When a user runs _Reconcile_, compare ledger-derived
  balances to:
  1. **Self-derived expected** (rebuilding from raw) and/or
  2. **External snapshots** (optionally fetched for exchanges/chains).

- **Suspect selection heuristic**:
  - If difference matches a single ledger entry amount ± known fee patterns →
    flag that tx.
  - If within **dust** threshold → suggest dust category (see note types).&#x20;
  - If gap ≈ sum of N recent imports tagged “pending confirmations” → suggest
    waiting / re-scan.
  - Otherwise, binary-search **by time** over entries to isolate first
    divergence.

- **Guidance**: create `GuidanceProposed` with suggestions such as: “Mark tx ABC
  as **internal transfer**”, “Split fee across two legs”, “Add missing deposit
  from raw item XYZ”.

_(Future)_ **AI assistance** consumes: user history, mismatch context, raw
payload diff, provider metadata → proposes ranked fixes. Guidance always yields
to explicit user actions; AI writes **guidance events**, not ledger events.

---

## 9) Security, Secrets & Permissions

- **Exchanges**: `SecretsPort.getUserSecret(userId, key)` pulls per-user API
  keys (encrypted at rest; never logged).
- **Blockchains**: `getServiceSecret` for provider keys (rotation via alias).
- **RBAC**: every append/publish carries `x-user-id` and service headers;
  messaging adapters enforce headers per ADR-0002 conventions.&#x20;
- **PII boundary**: raw payloads stored as blobs if large; redact secrets;
  events store only references+checksums.

---

## 10) Telemetry & Runbooks

- Metrics (emit via platform monitoring):
  - **ingestion**: `raw_captured`, `provider_429`, `retry_count`,
    `reorg_tail_rescans`, `checkpoint_lag`
  - **canonicalizer**: `canonical_ok/err`, `mapper_latency_ms`
  - **ledger**: `imports_idempotent_skips`, `entries_recorded`
  - **reconciliation**: `mismatches_found`, `mismatch_resolved`

- Keep the **outbox worker** and projections runbooks (already specified in
  ADR-0002).&#x20;

---

## 11) API & CLI Surfaces (sketch)

**API (Nest shell under `apps/api`)**

- `POST /ingestion/exchange/{id}/run` (body: { userId, credentialsRef?, scope })
- `POST /ingestion/chain/{id}/run` (body: { userId, addresses\[], since?, until?
  })
- `POST /reconciliation/run` (body: { userId, scope })
- `POST /ledger/corrections` (body: { userId, txId | accountId+assetId+at, patch
  })

**CLI (Effect)**

- `ingestion run --source evm:eth --address 0x… --user u1`
- `reconcile run --user u1`
- `ledger correct --tx <id> --patch '{...}'`

Shells import **contexts’ compose/nest**, staying outside core.&#x20;

---

## 12) Code Scaffolds (compilable sketches)

**Ingest range** — _Phase A sink uses Unified Event Bus_

```ts
// packages/contexts/ingestion/src/app/ingest-range.ts
import { UnifiedEventBus } from '@exitbook/platform-event-bus';
import { Effect } from 'effect';
import { ProviderClient, CheckpointPort } from '../ports';

export const ingestRange = (
  src: ProviderClient,
  scope: { userId: string; address?: string },
) =>
  Effect.gen(function* () {
    const bus = yield* UnifiedEventBus;
    const ckpt = yield* CheckpointPort;
    const key = `ingest:${src.id}:${scope.userId}:${scope.address ?? 'all'}`;
    const fromCursor = (yield* Effect.promise(() => ckpt.load(key))) ?? 0;

    let stored = 0;
    for await (const item of src.pull({
      userId: scope.userId,
      address: scope.address,
      fromCursor,
    })) {
      yield* bus.append(
        `ingest-raw-${item.externalId}`,
        [
          {
            type: 'RawObserved',
            data: {
              rawId: crypto.randomUUID(),
              batchId: key,
              source: src.id,
              ...item,
            },
          },
        ],
        /* expectedVersion */ undefined,
        { metadata: { userId: scope.userId } },
      );
      stored++;
    }

    yield* Effect.promise(() => ckpt.save(key, /* newCursor */ Date.now()));
    return stored;
  });
```

**Canonicalizer worker** — _Phase B_

```ts
// apps/workers/ingestion/src/main.ts
import { Effect } from 'effect';
import {
  UnifiedEventBus,
  UnifiedEventBusDefault,
} from '@exitbook/platform-event-bus/compose/live';
import { Commands as Ledger } from '@exitbook/contexts/ledger/src/app/commands';

const handle = (evt: any) => {
  if (evt.type !== 'RawObserved') return Effect.void;
  const { source, externalId, payload /* userId, checksum */ } = evt.data;

  // mapRawToUtx is implemented per provider in ingestion/adapters
  const utx = mapRawToUtx(source, payload);
  return Ledger.importTransaction(source, externalId, utx, evt.metadata.userId);
};

const program = Effect.gen(function* () {
  const bus = yield* UnifiedEventBus;
  yield* bus.subscribeCategory(
    'worker:canonicalizer',
    'ingest.raw',
    'ckpt:ingestion',
    handle,
  );
});

Effect.runFork(Effect.provide(program, UnifiedEventBusDefault));
```

**Ledger import handler** — _complete idempotency_

```ts
// packages/contexts/ledger/src/app/commands/import-transaction.handler.ts
// (uses repository.checkIdempotency + append TransactionImported and outbox in same tx)
```

This path already exists; ensure the repository **really** checks/stores the
idempotency key (`source:externalId`).&#x20;

**Reconciliation job** — _mismatch detection_

```ts
// packages/contexts/reconciliation/src/app/run-reconciliation.ts
export const runReconciliation = ({ userId }: { userId: string }) =>
  Effect.gen(function* () {
    const entries = LedgerReadPort.streamEntries({ userId });
    const computed = foldToBalances(entries); // sum DEBIT/CREDIT per (account, asset)
    // Compare to self-derived or external snapshot; emit MismatchDetected if any
  });
```

---

## 13) Data Modeling Details

- **RawObserved.payloadRef.inline** holds CSV rows or **small** explorer
  payloads; larger data moved to object storage with `blobUrl` and `checksum`.
- **externalId** formation by source type:
  - UTXO: `txid:vout` (per output)
  - EVM native: `txHash:0`; logs: `txHash:logIndex`
  - Substrate: `block:extrinsic:eventIndex`
  - Exchanges: provider’s unique **trade/ledger** ID

- **Ledger entries** use your existing `LedgerEntriesRecorded` structure; keep
  **double-entry** semantics.&#x20;

---

## 14) Concurrency, Backpressure & Failure Modes

- **Backpressure**: bound batch size per provider; push/pull windows tuned by
  rate limiter; avoid memory spikes by appending per item.
- **Retries**:
  - Transient provider errors → exponential backoff + jitter, circuit-break
    after N minutes.
  - Persistent schema errors → `CanonicalizationFailed` and **review queue
    projection**.

- **At-least-once**: consumers must be idempotent (position/eventId) per
  ADR-0002; we already enforce DLQ paths in outbox worker.&#x20;

---

## 15) Testing Strategy

- **Unit**: provider mappers (CSV/explorer → UTX), ledger policies,
  reconciliation heuristics.
- **Integration**: append + outbox single-tx; subscriber resume from checkpoint;
  idempotent `importTransaction`.&#x20;
- **E2E**: feed Ledger Live CSV + chain address; assert: `RawObserved` →
  `TransactionImported` → `LedgerEntriesRecorded`, then run reconciliation and
  resolve a synthetic mismatch. Follow ADR-0001’s test stack
  (unit/integration/E2E with Testcontainers for infra).&#x20;

---

## 16) Migration Plan

**Phase 0**

- Create `contexts/ingestion` and `contexts/reconciliation` scaffolds; add
  ESLint rules (no direct platform in app).&#x20;

**Phase 1 — Capture**

- Move CSV importers under `ingestion/adapters/csv/*` **unchanged** except the
  sink: emit `RawObserved` via Unified Event Bus. (Keep header/Zod
  validation.)&#x20;
- Add 1 chain provider client (EVM) with confirmations/re-scan; persist
  checkpoints in platform store.&#x20;

**Phase 2 — Canonicalization**

- Ship canonicalizer worker; wire **mapper →
  `Ledger.Commands.importTransaction`**; implement repository
  **idempotency**.&#x20;

**Phase 3 — Reconciliation & Corrections**

- Build balances projection; add mismatch detection job; add
  `ledger/corrections` API + events.
- Optional: external snapshot adapters to cross-check.

**Phase 4 — Guidance (opt-in)**

- Emit `GuidanceProposed` from heuristics; later add AI generator to propose
  ranked fixes (never auto-apply).

**Decommission** any ad-hoc raw stores after parity.

---

## 17) PR Checklist (enforce ADR)

- [ ] All writes go through **Unified Event Bus**; **events + outbox** written
      in the **same transaction**.&#x20;
- [ ] **Consumers idempotent** (keyed by `eventId`/`position`); DLQ paths
      tested.&#x20;
- [ ] Subscriptions use **persisted checkpoints**; no “live only”
      ingestion.&#x20;
- [ ] `TransactionRepository.checkIdempotency` **implemented**; duplicate
      `source:externalId` are skips.&#x20;
- [ ] No direct imports of platform store/messaging from app code; adapters only
      (lint rule).&#x20;
- [ ] Provider adapters handle **rate limits**, **retry/backoff**, **circuit
      breaker**, **min confirmations**.
- [ ] Raw payloads large → blob + checksum; events carry references only.
- [ ] Reconciliation job & balances projection deployed; correction API routes
      wired.

---

## 18) Alternatives Considered

1. **Raw corrections** _Rejected_: users shouldn’t edit explorer payloads;
   complexity > benefit. Post-canonical corrections are simpler and auditable.

2. **Direct map→ledger (no RawObserved)** _Rejected_: we’d lose replay/audit and
   the ability to rebuild from source of truth.

3. **Keep single “trading” context** _Rejected_: naming misleads; **ingestion**
   and **reconciliation** deserve first-class surfaces with their own
   ports/adapters.

---

## 19) Consequences

**Positive**

- Strong separation: **provider-centric ingestion**, **clean ledger**,
  **automated reconciliation**.
- Full **replayability** from raw; robust ops with **outbox + checkpoints**;
  clear audit.&#x20;
- User-friendly correction at ledger level; future AI hints.

**Negative / Risks**

- More moving parts: new context + worker(s).
- Initial refactor effort to move importers and build reconciliation.

**Mitigations**

- Provide generators and runbooks; keep strict boundaries and test harness from
  ADR-0001.&#x20;

---

## 20) References

- **ADR-0002 — Event Sourcing & Messaging** (single-tx append, outbox, Unified
  Bus, checkpoints, projections).&#x20;
- **ADR-0001 — Monorepo Structure & Boundaries** (apps/contexts/platform
  layering, testing strategy). &#x20;
- **Existing Ledger Events & Commands** (`TransactionImported`,
  `LedgerEntriesRecorded`, `importTransaction`, etc.). &#x20;

---

### Appendix A — Canonical IDs per Source (ready-to-use)

- **BTC/LTC (UTXO)**: `txid:vout` per output (incoming/outgoing clarity).
- **EVM native**: `txHash:0` (single transfer); **ERC-20/721 logs**:
  `txHash:logIndex`.
- **Substrate (DOT/KSM/TAO)**: `block:extrinsic:eventIndex`.
- **Exchanges**: ledger and trade endpoints each provide unique IDs; prefer
  **ledger** for movements, **trade** for fills (tie with order IDs when
  present).

### Appendix B — Guidance Heuristics (first pass)

- **Near-zero residuals** → label as **DUST_TRANSACTION** or
  **NETWORK_FEE_ONLY**; propose classification.&#x20;
- **Internal wash** (same user accounts) → propose **INTERNAL_TRANSFER**.
- **Rewards** recognized by on-chain method/event → propose **STAKING_REWARD** /
  **MINING_REWARD**.&#x20;
- **Large single discrepancy** ≈ known fee → propose fee re-allocation across
  legs.
- **Missing deposit pattern** → point to nearest `RawObserved` with matching
  hash in tail window.
