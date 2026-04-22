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

This document intentionally locks down only the contracts that affect durable
identity, invalidation, authority boundaries, and observable read behavior. It
intentionally leaves implementation leeway for internal APIs, helper
decomposition, runtime scheduling, and storage mechanics that do not change
those contracts. Future ambiguity reviews should treat that leeway as
deliberate, not as a defect, unless it changes replay identity, invalidation,
or consumer-visible semantics.

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

`protocol_overhead` means a non-fee protocol-side balance movement such as
rent, storage, account funding, or protocol rebate legs. It is **not** a
fallback for amounts already represented in `fees[]`.

`accounting_role` is **NOT NULL**. Every movement is authored with an
explicit value at creation time — plain inflow/outflow is `principal`,
staking payouts are `staking_reward`, and so on. Read paths never coerce a
missing value; if the column is ever seen NULL it is an authoring bug and
accounting should fail loud, not silently default.

If durable user correction remains supported, it stays **ledger-owned**.
The current override-store / replay pattern materializes an effective
`accounting_role` back onto movement state before accounting or linking
reads. Review may record why a correction happened, but cost basis and
transfer validation still read one channel: ledger.

This architecture keeps the existing override event-store + replay contract
from `docs/specs/override-event-store-and-replay.md`. V1 does not redesign
that mechanism here; it only preserves ledger ownership.

Manual correction to or from `staking_reward` is a coordinated correction
workflow, not a bare movement-role override write. The override event-store
remains ledger-owned and keyed by `movement_fingerprint`, but the workflow
must also keep the mandatory ledger/semantics overlap invariant satisfied for
the affected movement.

V1 resolution:

- persist or clear the ledger override first
- then run a narrow persisted-state sync step for the affected transaction
- that sync step may author a movement-scoped `staking_reward` fact only when
  no equivalent fact already exists for the movement
- synced facts use `emitter_lane: 'post_processor'`,
  `emitter_id: 'ledger_override_sync'`, and `evidence: 'asserted'`
- when the override is cleared, the sync step deletes only
  `ledger_override_sync`-owned rows for that movement and leaves any
  processor-authored equivalent fact in place

Notably **not** carried on movements: `fee` and `gas`. Those live in the
separate fees table. The accounting layer reads `accounting_role` to decide
what counts as transferable principal — it does not need to consult any other
channel for that decision.

Authoring invariant: when ledger and semantics both express the same
observation, the two must agree. V1 fixes one mandatory overlap: any
movement authored with `accounting_role: 'staking_reward'` must also emit a
movement-scoped `staking_reward` fact targeting that same movement. Transaction
labels may project that upward when helpful, but the durable semantic fact
stays leg-scoped. The other ledger roles do not, by themselves, imply a
semantic fact kind; `principal`, `protocol_overhead`, and `refund_rebate` may
appear with or without richer semantic facts depending on what the processor
can prove.

`transaction.operation` is **gone**. There is no canonical stored "what
happened" field on transactions. Plain transfer labels (`send`, `receive`,
`self_transfer`, `trade`) are derived from ledger shape on read by a small
helper in the ledger package — not stored, not authored.

For non-semantic policy code, the ledger package also owns a structural helper
`deriveLedgerShape()` whose result is one of:
`send`, `receive`, `self_transfer`, `trade`, `fee`.
That helper answers structural questions only. Downstream policy code must not
branch on rendered label text.

### 2. Semantic Facts — "what happened?"

The shared machine-semantic surface. The only place consumers read for
transaction meaning above the ledger.

Each semantic fact is a typed row keyed by a deterministic
`fact_fingerprint`. Facts are scoped to a transaction or a single movement.
Each fact has:

- a typed `kind` (one of a small enum — see Kinds below)
- `evidence` of `asserted` or `inferred` (rename of the earlier `tier` field;
  reads more honestly with the word "fact")
- optional `role`, `protocol_ref`, `counterparty_ref`, `group_key`,
  `correlation_key`
- an `emitter_id` identifying the processor or post-processor that authored it
- `derived_from_tx_fingerprints` for provenance
- `metadata` validated by a per-kind Zod schema (no free-form blob)

Facts identify each other by **fingerprint**, never by database id. This
keeps the contract durable across reprocesses and across the draft-vs-
persisted boundary at ingestion time (see Processor Authoring below).

V1 fact targets are `transaction` or non-fee asset `movement`. Fees have
their own persisted fingerprint for ledger identity, but semantic facts do
not target fee rows in v1.

V1 kind scope is fixed:

- transaction-scoped kinds: `bridge`, `swap`, `wrap`, `unwrap`,
  `staking_deposit`, `staking_withdrawal`,
  `protocol_deposit`, `protocol_withdrawal`, `airdrop_claim`,
  `asset_migration`, `spam_inbound`, `phishing_approval`, `dust_fanout`
- movement-scoped kinds: `staking_reward`

`staking_reward` is movement-scoped in v1 because downstream tax, residual, and
linking logic need exact leg attribution inside mixed transactions. V1 does
not carry a second `staking_reward_component`-style fact family; the single
reasoning model is the movement-scoped `staking_reward` fact itself.

Movement-scoped support otherwise remains in the generic fact contract for
future narrow facts, but no current kind chooses its own scope ad hoc. When a
transaction-scoped kind needs to name specific legs, it does so in kind-
specific metadata using referenced `movement_fingerprint` values.

`asset_migration` is allowed in two non-overlapping authoring shapes:

- processor-lane `asset_migration` facts cover single-transaction migrations a
  source processor can prove from one transaction alone; they must write
  `group_key: null`
- post-processor-lane `asset_migration` facts cover grouped multi-transaction
  migrations and follow the grouping contract below

Provider-native batch, campaign, or venue-correlation hints for single-tx
processor facts belong in `correlation_key`, not `group_key`.

Each fact also carries an explicit `emitter_lane` of `processor` or
`post_processor`. This is a typed column, not a string-prefix convention on
`emitter_id`. Invalidation rules (see Cross-Transaction Post-Processing)
branch on lane, so the lane must be first-class in the schema.

#### Fingerprint contract

`fact_fingerprint` must be deterministic from:

- `kind`
- fact scope plus durable target ref
  - transaction-scoped fact: `tx_fingerprint`
  - movement-scoped fact: `movement_fingerprint`
- `protocol_ref`
- `counterparty_ref`
- `role`
- `group_key`
- canonicalized `metadata` (stable key ordering, no non-deterministic values)

All fingerprint construction must use one shared metadata canonicalizer in
`semantic-fact-fingerprint.ts`. Per-kind code may normalize semantic fields
before handing metadata to that canonicalizer, but must not invent alternate
serialization rules.

Explicitly excluded from fingerprint material:

- `evidence` — upgrading or downgrading support changes confidence about the
  same fact; it does not create a second fact identity
- `emitter_id` and `emitter_lane` — author provenance, not identity
- `derived_from_tx_fingerprints` — invalidation provenance, not identity
- `correlation_key` — non-identity external batch / correlation tag
- database ids and timestamps

Two runs that differ only in `asserted` vs `inferred` should produce the same
fingerprint. A stronger or weaker rerun replaces the same fact row; it does
not create a sibling row at a different evidence level.

Two emitters that would describe the same subject-scoped fact must also
produce the same fingerprint. That convergence rule is about identity only;
it is **not** permission for two emitters to persist the same fact. In steady
state, exactly one emitter owns any given fact tuple. If two emitters reach
the same fingerprint, the problem is duplicate authorship upstream, not
fingerprint design.

`emitter_lane` is excluded from fact identity, but it is part of the
replacement-authorization tuple and the invalidation contract.

V1 lane rule: `group_key` is reserved for grouped `post_processor` facts.
`processor`-lane facts must write `group_key: null`. Non-identity provider or
batch correlation belongs in optional `correlation_key`, which is scoped to
`emitter_id` for display/debug only and does not participate in identity,
replacement authorization, or invalidation.

Runtime rule: duplicate authorship fails closed. The semantics store may
replace an existing row for a `fact_fingerprint` only when the existing row
has the same `(emitter_lane, emitter_id)`. If the fingerprint already exists
with a different author, ingestion aborts the enclosing database transaction
with a deterministic `duplicate_fact_authorship` error. No last-writer-wins
merge, no silent replacement, no widening of the fingerprint to make the
collision disappear.

Migration rule: incremental rollout must use feature gating or staged cutover
so exactly one author owns any given fact tuple at a time. During migration,
do not leave legacy detector-style emission and new processor /
post-processor emission active for the same fact tuple in one run.

Authoring rule: if a processor can author a fact, a post-processor must not
re-emit the same scope + `kind` + refs + metadata tuple just to attach
different provenance or weaker/stronger evidence. Fix the emitter boundary;
do not widen the fingerprint.

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

Discriminated by `kind`. Each kind has its own metadata shape. Scope is fixed by
the earlier "V1 kind scope is fixed" contract; this list groups kinds by
meaning, not by target scope.

Actions ("what happened"):

- `bridge`
- `swap`
- `wrap`, `unwrap`
- `staking_deposit`, `staking_withdrawal`
- `staking_reward` (movement-scoped; all other listed action kinds are
  transaction-scoped in v1)
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

Each decision targets a subject, records a decision verb (`include`,
`exclude`, `confirm`, `dismiss`), the reason, and the reviewer (a user or a
named rule).

V1 assumes one interactive user authority per profile. `reviewer` may record a
concrete actor id for audit, but precedence collapses all user-authored
decisions into that single user authority class.

V1 keeps verb meaning narrow:

- `include` / `exclude` are participation decisions for `transaction`,
  `movement`, and `asset` subjects
- `confirm` / `dismiss` are truth-value decisions for `semantic_fact`
  subjects
- any other verb / subject pairing is invalid and rejected at write time

`movement`-scoped review is valid persisted review state in v1, but its
canonical effect is intentionally narrow. It may drive review queues, filters,
and inspector surfaces only. It does **not** rewrite ledger-owned
`accounting_role`, stand in for semantic-fact correction, or change
accounting, linking, transaction labeling, portfolio inclusion, or
transaction-level inclusion by itself.

`include` / `exclude` on `transaction` and `asset` subjects are the canonical
participation controls. The target architecture does **not** keep a second
canonical exclusion flag on `transactions`. If a materialized fast-path
projection exists for read performance, it is review-owned derived state
(for example `effective_participation_state`), not a parallel authority.
Participation-sensitive consumers — cost basis, linking, gap analysis,
readiness, portfolio, and balance-verification adjustments — read that
effective participation projection. History, audit, and debug surfaces still
read the underlying transactions even when participation is excluded.

Effective participation applies with transaction scope as the outer gate:

- if the effective `transaction` decision is `exclude`, the whole transaction
  is excluded for participation-sensitive consumers
- if the transaction is included or undecided, effective `asset` decisions
  prune only the matching movements and fees inside the surviving transaction
- mixed transactions stay in scope when included activity survives
- transaction-level `exclude` wins over any asset-level decision inside that tx
- transaction-level `include` does not resurrect an excluded asset leg
- asset-level `include` does not resurrect a transaction excluded at
  transaction scope

Subject refs are **fingerprint-based, never id-based**. Database ids are
ephemeral — a reprocess rewrites them — so an id-based ref would silently
detach a decision from its target. Fingerprints survive replay. The shape
is `{ kind, ref }` where `ref` resolves as:

- `transaction` → `tx_fingerprint`
- `movement` → persisted `movement_fingerprint` (the existing durable movement
  identity from `docs/specs/transaction-and-movement-identity.md`)
- `asset` → the asset id (asset ids are already stable across reprocess).
- `semantic_fact` → `fact_fingerprint`

Review decisions do **not** directly override ledger-owned
`movements.accounting_role`. Durable accounting-role correction remains a
ledger override keyed by `movement_fingerprint` and materialized back onto
movement state before accounting or linking reads.

V1 deliberately omits an atomic `reclassify` verb. If a fact is wrong, the
flow is:

- `dismiss` the old semantic fact
- apply the correction in the owning lane
  - new semantic fact through the correct authoring workflow, or
  - ledger override for `accounting_role` corrections

If product later needs a one-click "this is actually X" flow, that should be
modeled as an explicit correction workflow with its own payload contract, not
as an underspecified review-table verb.

`review_decisions` is append-only audit history. Reads collapse it into one
**effective review state** per subject:

1. For the same reviewer on the same subject, the latest decision wins.
2. User decisions outrank rule decisions. If any user decision exists for a
   subject, the latest user decision is the effective state and rule
   decisions are ignored for read paths.
3. If no user decision exists, the latest rule decision is the effective
   state.
4. If no effective decision exists, the subject is undecided.

Here, `latest` means latest by the review store's durable append sequence, not
by wall-clock timestamp. The exact storage column is an implementation detail;
the ordering contract is deterministic total order.

Consumers do not interpret raw decision history ad hoc. Portfolio, spam
filtering, and future review UI read the effective review state projection.

The boundary versus semantic facts is sharp: a `spam_inbound` fact is what
the processor _observed_. An `exclude` review decision is what the system or
user _decided_. They live in different tables because they have different
authorities, different lifecycles, and different audit needs.

Asset-level include / exclude lives here. Transaction- and movement-level
include / exclude lives here. User confirmation or dismissal of heuristic
facts lives here.

`spam_inbound` workflows must coordinate fact truth and participation decisions
explicitly. A workflow meaning "not spam" writes both `dismiss` on the
`semantic_fact` subject and `include` on the `transaction` subject in the same
write transaction. A workflow meaning "confirmed spam" may write `confirm` on
the fact and `exclude` on the transaction together when both truth and
participation are being decided. No review action on a semantic fact
implicitly mutates transaction participation.

Spam workflows should choose the narrowest subject that matches the intended
blast radius:

- exclude the `transaction` when the whole tx should drop out of accounting,
  linking, readiness, portfolio participation, and related review-sensitive
  reads
- exclude the `asset` when only the suspicious asset should be pruned while
  native fees or unrelated legs remain in scope

This narrow movement-review effect is intentional, not provisional.

### 4. Diagnostics — "why was this uncertain or odd?"

Demoted hard. Diagnostics carry processor warnings about uncertainty,
ambiguity, or odd processing — and nothing else. Allowed codes are a small
fixed enum for v1:
`classification_uncertain`, `allocation_uncertain`,
`counterparty_unresolved`, `batched_context_missing`,
`proxy_target_unresolved`, `multisig_participants_unresolved`,
`off_platform_settlement_unresolved`.

These names are intentionally about missing context or uncertainty, not about
event meaning. A diagnostic may say "we could not confidently resolve the
proxy target"; it must not be the canonical place that says "this was a proxy
operation." If a code starts answering "what happened?" it belongs in
`semantic_facts`, with diagnostics reserved for whatever uncertainty remains.

If a diagnostic code starts to encode "what happened," it has drifted into
the wrong channel and should be promoted to a semantic fact kind.

The diagnostic enum is closed. Adding a new code requires explicit review.
This is the forcing function that prevents diagnostics from regrowing into a
semantic contract.

Migration cutover rule: existing diagnostics that answer "what happened?"
must move into semantic facts, leaving only uncertainty or missing-context
diagnostics behind. Concretely:

| Current signal                          | V1 home                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `bridge_transfer`                       | `bridge` fact                                                                                                         |
| `possible_asset_migration`              | `asset_migration` fact when correlation is proven; otherwise `classification_uncertain`                               |
| `SCAM_TOKEN`, `SUSPICIOUS_AIRDROP`      | `spam_inbound` fact plus review-rule seeding                                                                          |
| `unsolicited_dust_fanout`               | `dust_fanout` fact                                                                                                    |
| `proxy_operation`                       | concrete semantic fact when known, plus `proxy_target_unresolved` if target resolution is still missing               |
| `multisig_operation`                    | concrete semantic fact when known, plus `multisig_participants_unresolved` if participant resolution is still missing |
| `batch_operation`                       | concrete semantic fact when known, plus `batched_context_missing` when grouping context is missing                    |
| `exchange_deposit_address_credit`       | `counterparty_ref.kind='exchange_endpoint'` when resolved; otherwise `counterparty_unresolved`                        |
| `off_platform_cash_movement`            | `off_platform_settlement_unresolved`                                                                                  |
| `classification_failed`                 | collapse into `classification_uncertain` in v1                                                                        |
| `contract_interaction`                  | no standalone v1 signal; emit a concrete fact if known, otherwise `classification_uncertain`                          |
| `unattributed_staking_reward_component` | `allocation_uncertain` until exact movement-scoped `staking_reward` attribution can be proven                         |

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

Store-facing semantic-fact targets are fingerprint-based, never id-based.
Shared ingestion-owned identity helpers compute canonical `tx_fingerprint`,
`movement_fingerprint`, and fee fingerprints from ledger drafts before
semantic facts are validated or persisted. Whether processors return already-
fingerprinted refs or ingestion enriches draft outputs with those fingerprints
before store write is an internal API detail; the durable semantics contract is
only that facts never key off database ids.

Fee drafts use their own persisted fee fingerprint helpers for ledger
identity. That identity is for fees storage and accounting; semantic-fact
subjects remain transaction or non-fee asset movement in v1.

The architectural rule: **if the processor knew the fact, the processor
authors the fact.** No detector for re-projection.

## Cross-Transaction Post-Processing

Some semantic facts require a profile-wide view. Heuristic bridge pairing
across two chains is the canonical example: no single processor can see both
sides. Grouped asset migration is another case where correlation may require
more than one persisted transaction.

An ingestion-owned post-processing stage exists for exactly this work. It runs
after transactions and raw bindings are persisted, loads a profile scope plus
whatever persisted source context the registered post-processors require, emits
semantic facts (typically `evidence: 'inferred'`), and persists them under the
grouping contract below.

Because this stage lives in ingestion, post-processors may use source-aware
persisted raw / normalized / provider context through ingestion-owned readers
when that is required for deterministic correlation. They still operate only on
persisted state: no network calls, no live provider clients, no hidden mutable
caches.

Post-processors are the **only** thing the runtime exists for. Anything
single-transaction that does not need profile context belongs in the
processor.

Post-processors emit semantic facts only. They do **not** emit diagnostics, and
no post-processing path may translate diagnostics into facts later. If a
signal is "what happened?" it must be authored as a fact directly by the owning
processor or post-processor lane.

V1 may satisfy freshness conservatively by rerunning all registered
post-processors over full profile scope after any transaction reprocess.
Narrower scheduling is allowed, but only if it produces the same final rows
as a full rerun for the evaluated scope.

### Grouping contract

Cross-transaction semantics — bridge pair, grouped asset migration, batched
operations — are represented as **N facts sharing a group**, not as a special
event row. This subsection is the single source of truth for how those N facts
cohere, replace, and invalidate. It replaces the earlier "two replacement
keys" framing by giving `group_key` and `derived_from_tx_fingerprints` one
unified role.

1. **Inputs declared.** Every fact carries
   `derived_from_tx_fingerprints: string[]` — the set of transactions
   whose state the fact reads. Canonicalized: sorted, deduped. Order
   never affects identity. A single-tx processor fact has a one-element
   set; a bridge-pair post-processor fact has a two-element set.
2. **Evaluated scope declared.** Every post-processor run executes against
   an explicit `evaluated_tx_fingerprints: string[]` set, canonicalized
   sorted/deduped. V1 may choose the whole profile. Narrower sets are
   allowed only when the runtime can prove they preserve the same final
   rows as a full rerun for that evaluated set.
3. **Group key derived.** For grouped post-processor facts, `group_key`
   is a deterministic function of the canonical
   `derived_from_tx_fingerprints` set (a stable hash). Post-processors
   never synthesize group keys from external randomness. Single-subject
   facts carry `group_key: null`.
4. **Correlation key separated.** Non-identity external batch or
   correlation tags belong in `correlation_key`, not `group_key`.
   `correlation_key` may appear on processor- or post-processor-lane
   facts, is interpreted only within `emitter_id`, and must not drive
   replacement, invalidation, or grouped semantic meaning.
5. **Replacement.** `fact_fingerprint` is the row identity. For a given
   `emitter_id` and `evaluated_tx_fingerprints` set, persistence is
   reconcile-not-append: after commit, the persisted rows authored by
   that emitter whose `derived_from_tx_fingerprints` are wholly contained
   in the evaluated set must equal exactly the newly emitted rows for
   that same evaluated set. Implementations may realize this with
   delete+insert or equivalent set reconciliation inside one database
   transaction. This is why a bridge pair can safely emit two
   participant facts that share one canonical input set.
6. **Scope.** `group_key` is always interpreted in the scope of
   `emitter_id`; the meaningful identity is `(emitter_id, group_key)`.
   Cross-emitter grouping, if ever needed, must be modeled explicitly
   rather than inferred from a raw `group_key` collision. For
   post-processors, `(emitter_id, group_key)` identifies one emitted
   group. `correlation_key` is never a lifecycle key.

Within the execution scope of a run, post-processor persistence is
reconcile-not-append. If grouping changes from `{A,B}` to `{A,C}`, the old
`{A,B}` rows are deleted as stale even though that previous `derived_from`
tuple did not recur.

Re-running a post-processor over unchanged inputs produces identical fact
fingerprints.

### Invalidation on reprocess

Fact invalidation branches on `emitter_lane`. When a transaction is
reprocessed:

- all `processor`-lane facts for that `tx_fingerprint` are deleted
  atomically as part of the reprocess and replaced by whatever the re-run
  processor emits
- all `post_processor`-lane facts whose `derived_from_tx_fingerprints`
  include that `tx_fingerprint` are deleted in the same database
  transaction — they are **not** left visible as stale state. Because
  `group_key` is derived from `derived_from_tx_fingerprints`, deleting
  by `derived_from` also clears the corresponding group; there is no
  separate "invalidate the group" step.

`correlation_key` does not widen invalidation scope. Reprocessing one
transaction invalidates only that transaction's processor-authored facts,
even if several rows share the same external correlation tag.

Post-processor facts are regenerated when the affected post-processors
re-run. Until then, consumers see fewer post-processor facts, never
silently stale ones. The workflow layer is expected to re-run affected
post-processors after a reprocess completes; the store contract guarantees
freshness, not the workflow.

`Affected` means any registered post-processor whose candidate search space
includes the reprocessed transaction under the runtime's scope rules. V1 may
implement this conservatively as "all registered post-processors for the
profile." Whatever scheduler is used, it must preserve the reconcile-not-
append contract above.

### Three-case sanity check

Any change to the grouping contract must still cleanly cover:

- **Bridge pair.** Two txs on two chains, one post-processor fact per tx,
  both sharing a `group_key` derived from the pair's `derived_from` set.
- **Asset migration.** N txs (old-asset withdrawal + new-asset deposits),
  N facts sharing a `group_key` derived from the set.
- **Accounting-role correction.** A user sets a movement's `accounting_role`
  to `staking_reward`. This remains a ledger-owned override keyed by
  `movement_fingerprint` and materialized back onto movement state before
  accounting or linking reads. It is not a semantic fact and does not touch
  the grouping contract at all.

If any of those three needs a special case in the contract, stop and
re-examine before shipping — the model is not yet greenfield-clean.

## Read Paths

Consumers read from one channel for each question:

- **Cost basis / accounting**: `movements.accounting_role` (transfer
  eligibility) + `semantic_facts WHERE evidence = 'asserted'` (forced by
  the query API — no defaulting) + effective participation state on
  `transaction` / `asset` subjects
- **Tax & readiness**: asserted semantic facts + diagnostics (for
  uncertainty issues only) + effective participation state where participation
  matters
- **Linking**: bridge / asset-migration facts (both evidence values, the
  consumer decides what to suggest) + `transaction_links` + effective
  participation state
- **Portfolio / balance**: movements + asserted facts + effective review
  state / participation state (excludes filter out)
- **History & filters**: facts of any evidence value, labeled clearly +
  diagnostics for the "why uncertain" surface; excluded items may still appear
  on audit/debug-oriented surfaces
- **Spam filtering**: effective review state where the decision is
  `exclude`, typically seeded from `spam_inbound` facts via a rule

No consumer reads diagnostics for semantic meaning. The closed diagnostic
enum makes that rule mechanically enforceable.

### Label composition

`deriveLedgerShape()` is the base structural projection for non-semantic
policy code. `deriveLedgerShapeLabel()` is the display projection over that
same structural result. Their canonical vocabulary is `send`, `receive`,
`self_transfer`, `trade`, and `fee`. Surfaces that prefer venue wording such
as "deposit" or "withdrawal" may remap those labels later from account
context, but the helper contract itself stays canonical.

`deriveOperationLabel()` is the only transaction-facing label helper.
It composes `deriveLedgerShapeLabel()` first, then overlays semantic facts
when a richer meaning exists (`bridge/send`, `bridge/receive`,
`asset migration/send`, `staking/reward`, and so on). For movement-scoped
facts such as `staking_reward`, the helper projects upward from the matching
leg facts when building a transaction label. Negative-signal facts do not
replace the primary operation label; they surface separately as flags or
badges.

Its evidence contract is explicit: the caller must pass either facts already
filtered to a chosen evidence policy, or an `evidence_policy` argument that
the helper itself enforces. There is no implicit default. V1 uses two
policies:

- `asserted_only` — accounting, tax, readiness, portfolio, exports, and any
  surface that must not let heuristics change canonical meaning
- `asserted_or_inferred` — history, filters, and suggestion-oriented
  surfaces that intentionally show heuristic semantics

If an inferred fact is what upgrades the base label, the rendering surface
must mark that uncertainty explicitly.

For DEX-like shapes, the contract is intentionally layered:

- `deriveLedgerShapeLabel()` may return `trade` for a structural
  one-asset-out / different-asset-in transaction
- `deriveOperationLabel()` upgrades that base label to `swap` when a
  `swap` fact is present
- if no semantic fact exists yet, transaction-facing surfaces fall back to
  the structural `trade` label rather than collapsing to send/receive

After evidence filtering, `deriveOperationLabel()` emits one primary
transaction-facing label. V1 primary-label precedence is:

1. `staking_reward`
2. `swap`
3. `wrap` / `unwrap`
4. `bridge`
5. `asset_migration`
6. `staking_deposit` / `staking_withdrawal`
7. `protocol_deposit` / `protocol_withdrawal`
8. `airdrop_claim`
9. fallback ledger shape

If multiple facts in the same precedence tier survive evidence filtering, the
helper uses stable lexical ordering of `fact_fingerprint` as a final
deterministic tie-breaker. That tie-break is for rendering determinism only;
it should be treated as an authoring smell, not as permission to emit
semantically overlapping fact families indefinitely.

Consumers rendering user-facing transaction labels, filters, exports, or
history rows should call `deriveOperationLabel()` with an explicit evidence
policy. Direct calls to `deriveLedgerShapeLabel()` are reserved for
ledger/debug surfaces and tests that intentionally ignore semantic facts.
Downstream policy code should branch on `deriveLedgerShape()` and semantic
facts, not on rendered label strings.

## What Stays From the Current Implementation

The current `transaction-interpretation` package is not all wrong. These
parts carry forward:

- The replace-by-fingerprint and replace-by-derived-from-inputs invalidation
  story. Keep it verbatim.
- The deterministic-replay discipline for the ingestion-owned post-processing
  runtime.
- Forced tier/evidence selection at the query API. Keep it; rename `tier`
  to `evidence`.
- The cross-transaction heuristic bridge pairing. It is exactly what the
  post-processor lane is for.
- The `protocol_ref` shape (id + optional version, chain not part of the
  ref). Sound.
- The existing override event-store / replay contract for movement-role
  correction. Preserve it; do not redesign it inside this refactor.

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
  not extracted), and the `deriveOperationLabel()` projection.
- `packages/review/` — review decisions, asset-level review, decision
  authority (user vs rule), and the effective participation projection. Spam
  _decisions_ live here; spam _observations_ are facts.
- `packages/ingestion/` — source processors, `ProcessorOutput`, diagnostics,
  and the ingestion-owned semantic post-processing stage that authors
  `post_processor`-lane facts after persistence.
- Diagnostics — kept as a folder under `packages/ingestion/`, not a
  standalone package. The forcing function is the closed diagnostic-code
  enum, not the package boundary.
- Existing provider packages (`blockchain-providers`, `exchange-providers`)
  return `ProcessorOutput` with all five draft kinds. Ingestion writes each
  to its store inside one transaction, then may run semantic post-processing
  as a later authoring stage over persisted scope.

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
      labels/
        derive-operation-label.ts
      index.ts

  review/
    src/
      decisions/
        review-decision-types.ts
        review-decision-store.ts
      participation/
        effective-participation-state.ts
      authority/
      asset-review/
      index.ts

  ingestion/
    src/
      semantic-authoring/
        processor-output.ts
        post-processing/
          post-processing-runtime.ts
          post-processor-registry.ts
          source-reader.ts
          post-processors/
            heuristic-bridge-pair.ts
            asset-migration-grouper.ts
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
  and label projection. It does not own source-aware authoring workflows.
- `review/` owns decisions, asset-review state, and effective participation
  state, not passive observations.
- `ingestion/` owns semantic authoring workflows, including the
  post-processing stage for the truly cross-transaction or source-aware cases.
- diagnostics stay narrow under ingestion-owned code.
- accounting-owned helpers that were temporarily parked under
  `transaction-interpretation` move back to accounting.

## Guardrails

- Do not add new diagnostic-mirror detectors.
- Do not reintroduce stored `transaction.operation` as canonical meaning.
- Do not let `transaction-semantics` absorb accounting or CLI policy helpers.
- If a processor can already say what happened, it should emit a semantic fact
  directly.
- Do not let ingestion post-processing emit diagnostics. It emits facts only.
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
  ingestion-owned post-processing lane
- move semantic post-processing runtime ownership under ingestion while keeping
  fact contracts in `transaction-semantics`

## Deferred / Non-Goals

The contract-critical decisions are fixed above. The following are later
implementation slices or broader product scope, not unresolved semantics in
this architecture:

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
- Transaction / asset participation is review-owned effective state. There is
  no second canonical transaction exclusion flag; if a fast-path projection
  exists it is review-owned derived state.
- Effective participation applies with transaction scope as the outer gate and
  asset scope as leg-level pruning inside surviving transactions.
- Consumer-side helpers (`gap`, `readiness`, `transfer`, `residual`) live
  with their consumers, not in the semantics package.
- The semantics package contains: facts + schemas + protocol/counterparty
  resolvers + the operation-label projection. Ingestion owns the semantic
  authoring runtimes. Nothing else.
- Per-kind metadata is validated by Zod. No `Record<string, unknown>` in
  the typed fact contract.
- The fact query API forces `kinds` and `evidence` selection. Heuristic /
  inferred facts cannot silently drive tax or readiness consumers.
- Semantic-fact subjects are transactions or non-fee asset movements. In the
  initial v1 kind set, `staking_reward` is movement-scoped; all other listed
  kinds are transaction-scoped unless a later kind is added explicitly.
- Duplicate authorship across emitters fails the enclosing ingestion
  transaction; cutovers are gated rather than merged ad hoc.
- Review reads use one effective review state with a fixed verb / subject
  matrix, one user authority per profile, user-over-rule precedence, and
  deterministic append-order semantics.
- Movement-level review is stored/projected but has no canonical effect on
  accounting, linking, labels, portfolio inclusion, or transaction-level
  inclusion.
- Workflows that change both fact truth and transaction participation write
  separate review decisions atomically; fact decisions do not implicitly
  mutate inclusion state.
- Manual correction to or from `accounting_role: 'staking_reward'` preserves
  the matching movement-scoped `staking_reward` fact invariant through the
  coordinated sync workflow above.
- Pure structural downstream checks read a ledger-owned `deriveLedgerShape()`
  contract rather than branching on display labels.
- `deriveOperationLabel()` requires an explicit evidence policy; inferred
  facts do not silently relabel asserted-only surfaces.
- Negative-signal facts do not replace the primary operation label; they
  surface separately as flags or badges.
- `staking_reward` is the only v1 movement-scoped kind and is the sole reward
  reasoning model. No parallel `staking_reward_component` fact family remains.
- `group_key` is post-processor-only in v1 and participates in grouped fact
  identity there. Processor-lane facts set `group_key` to `null`; non-identity
  batch/provider correlation uses `correlation_key`.
- Processor-lane `asset_migration` facts are single-transaction facts with
  `group_key: null`. Grouped `asset_migration` facts, when needed, are authored
  only by the ingestion-owned post-processing lane.
- Post-processor reruns reconcile an explicit evaluated transaction set; stale
  prior outputs within that set are deleted when candidate groupings change.
- Reprocessing a transaction replaces all processor-authored facts for that
  transaction atomically. Re-running a post-processor over unchanged inputs
  produces identical fact fingerprints.
- Ingestion-owned post-processing authors facts only. Diagnostics are emitted
  by processors at processing time, never by post-processing.

## Decisions & Smells

- One semantic surface, four channels with clear jobs. Eliminates the
  diagnostic / annotation parallel-contract risk that the prior design
  flagged but did not solve.
- Processors as fact authors. No detector layer for single-tx work.
- Ingestion owns semantic authoring runtimes. `post_processor` is a fact lane,
  not a package boundary.
- Per-kind metadata schemas. No more string-roundtripping through a
  free-form blob.
- Duplicate authorship fails closed. During migration, ownership must be
  cut over explicitly rather than tolerated at write time.
- `accounting_role` on movements keeps accounting fast — it does not need
  to join semantic_facts to decide transfer eligibility.
- Semantic-fact scope stays narrow: transactions or non-fee asset movements.
  The initial v1 kind set uses one movement-scoped kind (`staking_reward`);
  other facts stay transaction-scoped unless explicitly added later.
- Review state is decisions, not observations. `spam_inbound` is what was
  seen; `exclude` is what was decided.
- Transaction / asset participation is review-owned effective state, not a
  parallel transaction flag.
- Review reads collapse append-only history into one effective state with
  one user authority per profile, user-over-rule precedence, and deterministic
  append ordering.
- `group_key` is a post-processor lifecycle key. Non-identity external
  correlation uses `correlation_key` instead of overloading grouped identity.
- `asset_migration` has two non-overlapping shapes: processor-lane single-tx
  facts with `correlation_key`, and grouped post-processor facts with
  `group_key`.
- Post-processor persistence is reconcile-not-append within execution scope;
  candidate regrouping must delete stale prior rows.
- `deriveOperationLabel()` takes explicit evidence policy. Surfaces that
  allow inferred semantics must opt in.
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
- `correlation_key` is a better name for non-identity external batching than
  overloading `group_key`.
- `effective review state` is a better contract term than `active review
decisions`.
- `effective participation state` is the right contract term for canonical
  include / exclude reads.
- `derived_from_tx_fingerprints` (not `_ids`) — fingerprints survive the
  draft-to-persisted boundary; ids do not.
