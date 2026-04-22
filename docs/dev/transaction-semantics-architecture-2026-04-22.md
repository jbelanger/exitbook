---
last_verified: 2026-04-22
status: active
supersedes:
  - docs/dev/archive/transaction-interpretation-superseded-2026-04-22/archived-transaction-interpretation-architecture-2026-04-20.md
  - docs/dev/archive/transaction-interpretation-superseded-2026-04-22/archived-interpretation-coverage-roadmap-2026-04-20.md
  - docs/dev/archive/transaction-interpretation-superseded-2026-04-22/archived-interpretation-consumer-migration-2026-04-20.md
  - docs/dev/archive/transaction-interpretation-superseded-2026-04-22/archived-semantic-activities-package-analysis-2026-04-20.md
---

# Transaction Semantics Architecture

Owner: Joel + Codex

## Goal

Define **one** semantic surface for transactions, with clear ownership of who
authors what, and clear lanes that do not overlap. Replace the current mix of
five partially-overlapping signal channels (`transaction.operation`,
`movement.movementRole`, diagnostics, annotations, asset-review) with four
channels that have non-overlapping jobs.

The previous `transaction-interpretation` design landed a real, queryable
annotation table and the right replay/fingerprint discipline. It also turned
out to be a parallel semantic contract growing alongside diagnostics, with
most detectors doing pure re-projection of facts the processor already knew.
This document defines the target shape that fixes both problems.

The target is four channels with non-overlapping jobs:

| Channel               | Question it answers            | Primary storage                                          |
| --------------------- | ------------------------------ | -------------------------------------------------------- |
| Ledger                | What moved?                    | `transactions`, `movements`, `fees`, `transaction_links` |
| Transaction semantics | What happened?                 | `semantic_facts`                                         |
| Review                | Should we trust or include it? | `review_decisions`                                       |
| Diagnostics           | Why was this uncertain or odd? | `diagnostics`                                            |

## The Four Channels

Every signal about a transaction lives in exactly one of these. The lane is
defined by the question the channel answers.

### 1. Ledger — "what moved?"

Canonical accounting truth. Transactions, movements, fees, transaction links.

Movements carry an `accounting_role` field, narrowly scoped to transfer
eligibility and accounting behavior. Allowed values:
`principal`, `staking_reward`, `protocol_overhead`, `refund_rebate`.

Notably **not** carried on movements: `fee` and `gas`. Those live in the
separate fees table. The accounting layer reads `accounting_role` to decide
what counts as transferable principal — it does not need to consult any other
channel for that decision.

`transaction.operation` is **gone**. There is no canonical stored "what
happened" field on transactions. Plain transfer labels (send / receive /
self-transfer / trade) are derived from ledger shape on read by a small
helper in the ledger package — not stored, not authored.

### 2. Semantic Facts — "what happened?"

The shared machine-semantic surface. The only place consumers read for
transaction meaning above the ledger.

Each semantic fact is a typed row keyed by a deterministic
`fact_fingerprint`. Facts are scoped to a transaction or a single movement.
Each fact has:

- a typed `kind` (one of a small enum — see Kinds below)
- `evidence` of `asserted` or `inferred` (rename of the earlier `tier` field;
  reads more honestly with the word "fact")
- optional `role`, `protocol_ref`, `counterparty_ref`, `group_key`
- an `emitter_id` identifying the processor or post-processor that authored it
- `derived_from_tx_fingerprints` for provenance
- `metadata` validated by a per-kind Zod schema (no free-form blob)

Facts identify each other by **fingerprint**, never by database id. This
keeps the contract durable across reprocesses and across the draft-vs-
persisted boundary at ingestion time (see Processor Authoring below).

Each fact also carries an explicit `emitter_lane` of `processor` or
`post_processor`. This is a typed column, not a string-prefix convention on
`emitter_id`. Invalidation rules (see Cross-Transaction Post-Processing)
branch on lane, so the lane must be first-class in the schema.

#### Reserved columns

Some fact columns exist today only as reserved structure, with the resolver
or producer work explicitly deferred.

- **`counterparty_ref`** — shape:
  `{ id: string; kind: 'protocol' | 'validator' | 'exchange' | 'exchange_endpoint' | 'address' }`.
  - `id` must be globally namespaced. For `kind: 'address'`, the id carries
    its chain namespace (e.g. `evm:0xabc…`, `near:foo.near`, `btc:bc1…`)
    to prevent cross-chain collisions.
  - `kind: 'exchange_endpoint'` is the right kind for a specific
    deposit/withdrawal endpoint. `kind: 'exchange'` is reserved for cases
    where the venue is the counterparty but the endpoint is unknown.
  - Column reserved; resolver deferred (see Deferred / Non-Goals).

#### Kinds

Discriminated by `kind`. Each kind has its own metadata shape.

Actions ("what happened"):

- `bridge`
- `swap`
- `wrap`, `unwrap`
- `staking_deposit`, `staking_withdrawal`, `staking_reward`
- `protocol_deposit`, `protocol_withdrawal`
- `airdrop_claim`
- `asset_migration`

Negative signals (processor-time observations consumers may act on):

- `spam_inbound`
- `phishing_approval`
- `dust_fanout`

The action vs. negative-signal distinction is a documentation grouping, not a
schema column. The `kind` enum carries the discrimination.

### 3. Review Decisions — "should we trust / include this?"

Decisions, not observations. A separate authority with its own lifecycle.

Each decision targets a subject (transaction, movement, asset, or semantic
fact, identified by a stable subject ref), records a decision verb
(`include`, `exclude`, `reclassify`, `confirm`, `dismiss`), the reason, and
the reviewer (a user or a named rule).

The boundary versus semantic facts is sharp: a `spam_inbound` fact is what
the processor _observed_. An `exclude` review decision is what the system or
user _decided_. They live in different tables because they have different
authorities, different lifecycles, and different audit needs.

Asset-level review state lives here. Per-transaction overrides live here.
User confirmations of heuristic facts live here.

### 4. Diagnostics — "why was this uncertain or odd?"

Demoted hard. Diagnostics carry processor warnings about uncertainty,
ambiguity, or odd processing — and nothing else. Allowed codes are a small
fixed enum (roughly: `classification_uncertain`, `allocation_uncertain`,
`batch_operation`, `proxy_operation`, `multisig_operation`,
`off_platform_cash_movement`).

If a diagnostic code starts to encode "what happened," it has drifted into
the wrong channel and should be promoted to a semantic fact kind.

The diagnostic enum is closed. Adding a new code requires explicit review.
This is the forcing function that prevents diagnostics from regrowing into a
semantic contract.

## Processor Authoring

The single biggest change versus the prior architecture: **processors author
semantic facts directly**. There is no "emit a diagnostic, then run a
detector that re-projects the diagnostic into an annotation" indirection for
single-transaction facts.

A processor's output for a single raw provider record is:

- transaction draft(s)
- movement draft(s)
- fee draft(s)
- semantic fact draft(s) — typed, asserted (or `inferred` when the processor
  has weaker but still actionable evidence)
- diagnostic draft(s) — uncertainty only

All five are returned together as one structured `ProcessorOutput`.
Ingestion writes each to its respective store inside one database
transaction. The processor never imports a store; it returns data.

Drafts identify each other by **fingerprint**, not id. Ingestion resolves
fingerprints to persisted ids at write time. This eliminates the bootstrap
problem of "how does a fact reference a transaction that does not have an id
yet."

The architectural rule: **if the processor knew the fact, the processor
authors the fact.** No detector for re-projection.

## Cross-Transaction Post-Processing

Some semantic facts require a profile-wide view. Heuristic bridge pairing
across two chains is the canonical example: no single processor can see both
sides.

A small post-processing runtime exists for exactly this work. It loads a
profile scope (accounts + transactions), runs registered post-processors
that emit semantic facts (typically `evidence: 'inferred'`), and persists
them with the same replay discipline used today:

- replace by `(emitter_id, derived_from_tx_fingerprints)` for facts whose
  inputs reproduce
- replace by `(emitter_id, group_key)` for group-scoped facts whose
  membership can change

Stale facts whose inputs no longer reproduce are removed in the same pass.
Re-running over unchanged inputs produces the same fact fingerprints.

Post-processors are the **only** thing the runtime exists for. Anything
single-transaction that does not need profile context belongs in the
processor.

### Invalidation on reprocess

Fact invalidation branches on `emitter_lane`. When a transaction is
reprocessed:

- all `processor`-lane facts for that `tx_fingerprint` are deleted
  atomically as part of the reprocess and replaced by whatever the re-run
  processor emits
- all `post_processor`-lane facts whose `derived_from_tx_fingerprints`
  include that `tx_fingerprint` are deleted in the same database
  transaction — they are **not** left visible as stale state

Post-processor facts are regenerated when the affected post-processors
re-run. Until then, consumers see fewer post-processor facts, never
silently stale ones. The workflow layer is expected to re-run affected
post-processors after a reprocess completes; the store contract guarantees
freshness, not the workflow.

### Group key lifecycle

`group_key` is assigned only by post-processors. Processors emit facts
with `group_key: null`. Single exception: when a provider supplies an
authoritative external group identifier (e.g. a provider-assigned batch
id), a processor may pass it through unchanged. Processors never
synthesize group keys of their own.

`group_key` is never a global identifier. It is always interpreted in the
scope of `emitter_id`; the meaningful identity is `(emitter_id, group_key)`.
That makes provider-pass-through ids safe without requiring global
namespacing and matches the replacement semantics above. If we ever need
cross-emitter grouping, that must be modeled explicitly rather than inferred
from a raw `group_key` collision.

## Read Paths

Consumers read from one channel for each question:

- **Cost basis / accounting**: `movements.accounting_role` (transfer
  eligibility) + `semantic_facts WHERE evidence = 'asserted'` (forced by
  the query API — no defaulting)
- **Tax & readiness**: asserted semantic facts + diagnostics (for
  uncertainty issues only)
- **Linking**: bridge / asset-migration facts (both evidence values, the
  consumer decides what to suggest) + `transaction_links`
- **Portfolio / balance**: movements + asserted facts + active review
  decisions (excludes filter out)
- **History & filters**: facts of any evidence value, labeled clearly +
  diagnostics for the "why uncertain" surface
- **Spam filtering**: `review_decisions WHERE decision = 'exclude'`,
  typically seeded from `spam_inbound` facts via a rule

No consumer reads diagnostics for semantic meaning. The closed diagnostic
enum makes that rule mechanically enforceable.

## What Stays From the Current Implementation

The current `transaction-interpretation` package is not all wrong. These
parts carry forward:

- The replace-by-fingerprint and replace-by-derived-from-inputs invalidation
  story. Keep it verbatim.
- The deterministic-replay discipline for the post-processor runtime.
- Forced tier/evidence selection at the query API. Keep it; rename `tier`
  to `evidence`.
- The cross-transaction heuristic bridge pairing. It is exactly what the
  post-processor lane is for.
- The `protocol_ref` shape (id + optional version, chain not part of the
  ref). Sound.

What does not carry forward:

- Diagnostic-to-annotation re-projection detectors. Delete after migration.
- The free-form `metadata: Record<string, unknown>` blob. Replace with
  per-kind schemas.
- Consumer-side helpers (`gap/`, `readiness/`, `transfer/`, `residual/`)
  living inside the semantics package. They move to their consumers
  (typically accounting).
- `protocol-catalog` as a standalone package. Fold back into semantics.
- Stored `transaction.operation` as semantic truth. Drop.

## Package Shape

One semantics package, not two. Consumer policies live with consumers.
Diagnostics get a small dedicated module to keep the demotion structurally
visible.

- `packages/ledger/` — canonical: transactions, movements (with
  `accounting_role`), fees, links. Contains the `deriveLedgerShapeLabel()`
  helper that replaces stored `operation` for plain transfers.
- `packages/transaction-semantics/` — fact types and per-kind schemas, the
  store port and query API, protocol and counterparty resolvers (internal,
  not extracted), the post-processing runtime, the post-processors that
  truly need cross-tx scope, and the `deriveOperationLabel()` projection.
- `packages/review/` — review decisions, asset-level review, decision
  authority (user vs rule). Spam _decisions_ live here; spam _observations_
  are facts.
- Diagnostics — kept as a folder under `packages/ingestion/`, not a
  standalone package. The forcing function is the closed diagnostic-code
  enum, not the package boundary.
- Existing provider packages (`blockchain-providers`, `exchange-providers`)
  return `ProcessorOutput` with all five draft kinds. Ingestion writes each
  to its store inside one transaction.

Naming: `transaction-semantics` (not `transaction-interpretation`).
Interpretation implies post-hoc derivation; semantics is the thing itself.
The package name signals the lane.

## Target Folder Hierarchy

This is the initial target hierarchy, not a frozen package plan. It is the
shape we should aim toward while migrating out of the current
`transaction-interpretation` layout.

```text
packages/
  ledger/
    src/
      transactions/
      movements/
      fees/
      links/
      labels/
        derive-ledger-shape-label.ts
      index.ts

  transaction-semantics/
    src/
      facts/
        semantic-fact-types.ts
        semantic-fact-schemas.ts
        semantic-fact-fingerprint.ts
        semantic-fact-query.ts
        semantic-fact-store.ts
      kinds/
        bridge.ts
        swap.ts
        wrap.ts
        staking.ts
        protocol-flow.ts
        airdrop.ts
        asset-migration.ts
        negative-signals.ts
      protocol/
        protocol-ref.ts
        protocol-resolver.ts
        seed/
      counterparty/
        counterparty-ref.ts
        counterparty-resolver.ts
      runtime/
        post-processing-runtime.ts
        post-processor-registry.ts
        source-reader.ts
      post-processors/
        heuristic-bridge-pair.ts
        asset-migration-grouper.ts
      labels/
        derive-operation-label.ts
      index.ts

  review/
    src/
      decisions/
        review-decision-types.ts
        review-decision-store.ts
      authority/
      asset-review/
      index.ts

  ingestion/
    src/
      diagnostics/
        diagnostic-types.ts
        diagnostic-codes.ts
        diagnostic-schemas.ts
      ...

  accounting/
    src/
      gaps/
      readiness/
      transfer-policy/
      residual-attribution/
      cost-basis/
      portfolio/
      ...
```

Boundary notes:

- `ledger/` owns canonical accounting contracts plus ledger-shape projections.
- `transaction-semantics/` owns fact contracts, protocol/counterparty context,
  and post-processing for the truly cross-transaction cases.
- `review/` owns decisions and asset-review state, not passive observations.
- diagnostics stay narrow under ingestion-owned code.
- accounting-owned helpers that were temporarily parked under
  `transaction-interpretation` move back to accounting.

## Guardrails

- Do not add new diagnostic-mirror detectors.
- Do not reintroduce stored `transaction.operation` as canonical meaning.
- Do not let `transaction-semantics` absorb accounting or CLI policy helpers.
- If a processor can already say what happened, it should emit a semantic fact
  directly.
- If a signal changes behavior only after confirmation or exclusion, it belongs
  in review.
- When a signal is ambiguous between observation and decision, default to
  fact-only. Processors never emit decisions; review authorities never emit
  observations.
- Keep the diagnostics code enum closed and small.

## Naming Changes

- `TransactionAnnotation` → `SemanticFact`
- `tier` → `evidence` (`asserted` | `inferred`). "Heuristic fact" is mildly
  oxymoronic; "inferred fact" reads cleanly.
- `movementRole` → `accounting_role`. Narrower name for a narrower job —
  transfer eligibility, not general meaning.
- `detectorId` → `emitter_id`, paired with an explicit `emitter_lane` column
  (`processor` | `post_processor`). Lane is a typed column, not a
  string-prefix convention on the id.
- `transaction-interpretation` (package) → `transaction-semantics`.
- `protocol-catalog` (package) → folded into `transaction-semantics/protocol/`.

## Immediate Direction

Near-term work should move toward this target incrementally:

- stop adding new diagnostic-to-fact reprojection paths
- move consumer-side helpers out of `packages/transaction-interpretation`
- convert asserted single-transaction semantics to processor-authored facts
- preserve the current replay and invalidation bar for all persisted semantic
  state
- keep the cross-transaction heuristic bridge path, but only in the
  post-processing lane

## Deferred / Non-Goals

The greenfield target is broad. The following are explicitly **not** part of
the v1 cut, and should not be assumed to land just because the architecture
makes room for them:

- Counterparty resolver implementation. The column and shape are reserved;
  the resolver is a later slice.
- A populated protocol catalog beyond a small initial seed.
- Background scheduling of post-processor runs (current pattern: run on
  reprocess, run on demand).
- A first-class review UI. The review_decisions table and authority model
  exist; the UI is later.
- Migration of every existing consumer. The migration plan is a separate
  document.
- A deeper staking taxonomy beyond
  `staking_deposit / staking_withdrawal / staking_reward`. Validator
  identity, reward attribution detail, and product-specific behavior are
  later slices that fit into the existing kind set.

## Acceptance Criteria

A v1 that delivers this architecture is one where:

- A new processor adding a single-transaction semantic concern does so by
  emitting a typed fact in `ProcessorOutput`, never by adding a diagnostic
  code.
- The diagnostic code enum has been pruned to uncertainty/oddness only,
  with everything semantic moved to facts.
- `transaction.operation` is removed from the canonical row. Plain transfer
  labels are derived from ledger shape.
- `movements.movement_role` is renamed to `accounting_role` with the
  narrower allowed-values set.
- Consumer-side helpers (`gap`, `readiness`, `transfer`, `residual`) live
  with their consumers, not in the semantics package.
- The semantics package contains: facts + schemas + protocol/counterparty
  resolvers + the cross-tx post-processor runtime + the operation-label
  projection. Nothing else.
- Per-kind metadata is validated by Zod. No `Record<string, unknown>` in
  the typed fact contract.
- The fact query API forces `kinds` and `evidence` selection. Heuristic /
  inferred facts cannot silently drive tax or readiness consumers.
- Reprocessing a transaction replaces all processor-authored facts for that
  transaction atomically. Re-running a post-processor over unchanged inputs
  produces identical fact fingerprints.

## Decisions & Smells

- One semantic surface, four channels with clear jobs. Eliminates the
  diagnostic / annotation parallel-contract risk that the prior design
  flagged but did not solve.
- Processors as fact authors. No detector layer for single-tx work.
- Per-kind metadata schemas. No more string-roundtripping through a
  free-form blob.
- `accounting_role` on movements keeps accounting fast — it does not need
  to join semantic_facts to decide transfer eligibility.
- Review state is decisions, not observations. `spam_inbound` is what was
  seen; `exclude` is what was decided.
- Smell to watch: negative observations drifting between semantic facts
  and diagnostics. The closed diagnostic enum is the forcing function;
  protect it.
- Smell to watch: post-processors regressing into diagnostic re-projection.
  Discipline rule: if it is a fact, the processor emits it as a fact, even
  with `evidence: 'inferred'` when uncertainty is real.
- Smell to watch: `derive-operation-label` becoming a coupling hotspot as
  new kinds are added. Mitigated by TS exhaustiveness checks; revisit if
  the kind set grows past ~15.

## Naming Issues

- `transaction-semantics` is a better greenfield name than
  `transaction-interpretation`.
- `SemanticFact` + `evidence: 'asserted' | 'inferred'` reads better than
  `Annotation` + `tier: 'asserted' | 'heuristic'`.
- `accounting_role` is a real improvement over `movementRole`.
- `emitter_id` is right.
- `derived_from_tx_fingerprints` (not `_ids`) — fingerprints survive the
  draft-to-persisted boundary; ids do not.
