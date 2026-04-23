---
last_verified: 2026-04-22
status: deferred
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
deferred_by:
  - ../accounting-ledger-rewrite-plan-2026-04-23.md
---

# Core Contract

Implementation from this contract is deferred pending the accounting ledger
rewrite. Re-evaluate this document after the processor-to-accounting boundary
lands.

## Goal

Define one semantic surface for transactions, with explicit ownership of who
authors what and with clear non-overlapping channels.

The target replaces the previous mix of:

- `transaction.operation`
- `movement.movementRole`
- diagnostics
- annotations
- asset-review side effects

with four channels that answer different questions and have different
authorities.

## The Four Channels

| Channel               | Question                       | Primary storage                                                    |
| --------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Ledger                | What moved?                    | `transactions`, `movements`, `fees`, `transaction_links`           |
| Transaction semantics | What happened?                 | `semantic_facts`                                                   |
| Review                | Should we trust or include it? | `review_decisions` plus effective review/participation projections |
| Diagnostics           | Why was this uncertain or odd? | `diagnostics`                                                      |

Every signal about a transaction has one primary channel. V1 also carries one
explicit cross-channel invariant documented below: `staking_reward` appears in
both ledger and semantics.

## Ledger

Ledger is canonical accounting truth: transactions, movements, fees, and links.

### Accounting role

Movements carry `accounting_role` with this v1 vocabulary:

- `principal`
- `staking_reward`
- `protocol_overhead`
- `refund_rebate`

Rules:

- `accounting_role` is `NOT NULL`.
- Reads never coerce a missing role.
- Durable user correction remains ledger-owned via the existing override event
  store and replay contract.
- Review does not directly rewrite `accounting_role`.

`protocol_overhead` is for non-fee protocol-side balance movements such as
rent, storage, account funding, or protocol rebate legs. It is not a synonym
for fee rows already represented in `fees[]`.

### Ledger and semantics overlap

The design goal is non-overlapping channels, but one durable overlap is frozen
in v1:

- a movement authored with `accounting_role: 'staking_reward'` must also have a
  matching movement-scoped `staking_reward` semantic fact

That overlap is handled by a reconciler-owned invariant workflow. The
authoritative semantic-fact mechanics live in
[Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md) and the
runtime ownership for the reconciler path lives in
[Runtime Ownership And Reads](./03-runtime-ownership-and-reads.md).

### Structural shape instead of stored transaction meaning

`transaction.operation` is not canonical semantic truth.

Ledger owns a structural helper `deriveLedgerShape()` with one fixed v1 result
set:

- `send`
- `receive`
- `self_transfer`
- `trade`
- `fee`

Rules:

- Classification is based on contributing non-fee movements.
- If principal movements exist, only principal inflows/outflows contribute.
- If no principal movements exist, all non-fee asset movements contribute.
- Fee rows never contribute except to the fee-only case.
- Reads fail loudly if there are no contributing movements and no fee rows.

Classification order:

1. no contributing inflows and no contributing outflows, but one or more fee
   rows -> `fee`
2. one or more contributing inflows and no contributing outflows -> `receive`
3. one or more contributing outflows and no contributing inflows -> `send`
4. both sides present and inflow/outflow asset-id sets share one or more exact
   asset ids -> `self_transfer`
5. both sides present and inflow/outflow asset-id sets are disjoint -> `trade`

`self_transfer` is structural only. It is not a same-owner proof.

## Transaction Semantics

Semantic facts are the only durable machine-semantic surface for "what
happened" above the ledger.

Core contract:

- facts are fingerprinted, typed rows
- fact targets are fingerprint-based, never DB-id-based
- semantic reads are explicit about evidence and fact-decision policy
- kinds may be transaction-scoped or movement-scoped
- fees are not semantic-fact targets in v1

The full fact contract, kind registry, identity rules, and evolution rules live
in [Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md).

## Review

Review records decisions, not observations.

### Verbs and subjects

V1 verb/subject matrix:

- `include` / `exclude` for `transaction`, `movement`, and `asset`
- `confirm` / `dismiss` for `semantic_fact`

Anything else is invalid at write time.

### Subject refs

All review subject refs are fingerprint-based:

- `transaction` -> `tx_fingerprint`
- `movement` -> `movement_fingerprint`
- `asset` -> stable `asset_id`
- `semantic_fact` -> `fact_fingerprint`

### Effective review state

`review_decisions` is append-only history. Canonical reads collapse that history
to one effective state per subject:

V1 review authorities are:

- `manual`, the singleton manual authority for the profile
- one or more named rule authorities

Collapse rules:

1. latest decision from the same authority wins for that authority
2. if a manual decision exists for the subject, the latest manual decision is
   effective
3. otherwise the latest rule decision is effective
4. otherwise the subject is undecided

`latest` means latest by durable append order, not wall-clock time.

### Participation

Participation-sensitive consumers read effective participation state, not raw
transaction flags.

Rules:

- transaction-level `exclude` excludes the whole transaction
- otherwise asset-level include/exclude applies by exact `asset_id`
- asset-level exclusion prunes same-asset movement and fee rows inside the
  surviving transaction
- mixed transactions stay in scope if any movement or fee survives
- fee-only survivors stay in scope
- movement-level review is persisted but intentionally non-canonical in v1

### Freshness contract

Canonical reads must never observe stale effective participation after a
committed review write.

V1 may satisfy that either by:

- computing effective participation on read, or
- maintaining a materialized projection updated in the same database
  transaction as the write that changes effective state

Asynchronous best-effort refresh is not sufficient for canonical accounting,
linking, readiness, portfolio, or balance reads.

### Semantic-fact truth decisions

For `semantic_fact` subjects:

- effective `dismiss` suppresses the fact from canonical semantic reads
- effective `confirm` keeps the fact visible and records reviewed trust state
- undecided facts remain visible subject to evidence policy and supersession;
  `confirm` does not widen visibility or override evidence filtering
- history/debug surfaces may opt into raw rows plus effective review state

### Workflow atomicity

A review action on a semantic fact never implicitly mutates transaction or
asset participation. Workflows that intend to change both fact truth and
participation must write both decisions in the same database transaction.

Canonical example — `spam_inbound`:

- "not spam" workflow writes `dismiss` on the `semantic_fact` subject **and**
  `include` on the `transaction` subject atomically
- "confirmed spam" workflow writes `confirm` on the fact **and** `exclude` on
  the transaction (or asset) atomically

Spam workflows should choose the narrowest subject that matches the intended
blast radius — `transaction` when the whole tx should drop out, `asset` when
only the suspicious asset should be pruned while native fees or unrelated legs
remain in scope.

### Rule authority

Rule-seeded review is reconcile-not-append at the workflow level.

Each named rule authority evaluates an explicit subject set and appends
whatever decision is required so that its latest rule-authored state matches
current rule output for each evaluated subject:

- for participation subjects, when a rule-authored `exclude` no longer applies,
  the rule appends `include` for that same subject
- for `semantic_fact` subjects, when a rule-authored `confirm` no longer
  applies and the fact still exists, the rule appends `dismiss`
- if a previously-reviewed `semantic_fact` subject no longer exists after
  reprocess, the historical rule rows remain audit history but are inert on
  read because the subject ref no longer resolves

Manual-over-rule precedence still applies on top of that reconciled rule
stream.

### Subject families

`subject family` is the rule-ownership namespace used to prevent overlapping
rule authorship.

V1 families are:

- participation families by subject type: `transaction`, `asset`, and
  `movement`
- semantic-fact truth families by semantic `kind`

One rule authority may own multiple subject families. No subject family may
have multiple rule authorities in v1 unless explicit precedence is added
first.

V1 constraint:

- manual review is a singleton authority per profile; person identity is not
  part of the architecture contract
- at most one rule authority may author participation decisions for a subject
  family
- at most one rule authority may author semantic-fact truth decisions for a
  subject family

If multiple rule authorities need the same subject family later, explicit rule
precedence must be added first.

## Diagnostics

Diagnostics exist only for uncertainty, ambiguity, or odd processing.

V1 diagnostic enum:

- `classification_uncertain`
- `allocation_uncertain`
- `counterparty_unresolved`
- `batched_context_missing`
- `proxy_target_unresolved`
- `multisig_participants_unresolved`
- `off_platform_settlement_unresolved`

Rules:

- diagnostics do not answer "what happened?"
- if a diagnostic begins to encode semantic meaning, it has drifted into the
  wrong channel and should become a semantic fact kind
- the enum is intentionally closed; adding a new diagnostic code requires
  explicit review

Legacy diagnostic-to-v1 migration mapping lives in
[04. Rollout And Checklist](./04-rollout-and-checklist.md).
