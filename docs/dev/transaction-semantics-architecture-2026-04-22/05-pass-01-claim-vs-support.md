---
last_verified: 2026-04-22
status: proposed
derived_from:
  - ./01-core-contract.md
  - ./02-semantic-facts-and-evolution.md
  - ./03-runtime-ownership-and-reads.md
---

# Pass 01: Claim Vs Support / Provenance

This note records the first focused design pass over the transaction-semantics
refactor. It is a decision-analysis surface, not part of the enduring runtime
contract unless later accepted into 01-03.

## Pass Rules

This pass uses the following analysis rules:

- enumerate the concrete capabilities that must be preserved before comparing
  options
- compare exactly three options
- give each option a confidence rating out of 100
- prefer refactoring downstream consumers over introducing lower-layer
  mechanisms whose main purpose is to compensate for a downstream modeling smell

## Problem Statement

The current split docs improve channel ownership, but the proposed
`semantic_fact` row still mixes two concerns:

- the durable machine claim about what happened
- the support record explaining which emitter produced that claim and on what
  basis

The proposed contract keeps `evidence`, `emitter_lane`, `emitter_id`,
`derived_from_tx_fingerprints`, and `correlation_key` on the same persisted row
as the reviewable semantic meaning in
[02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md).

That shape is simple, but it creates pressure at exactly the point where the
system should become more flexible:

- review targets the same row that also carries emitter-specific support
  details
- duplicate authorship fails closed when two emitters converge on the same
  semantic meaning
- richer provenance has to be squeezed into the same row model as durable
  meaning

## Evidence From Current Code

The current `@exitbook/transaction-interpretation` package already shows the
same coupling:

- `TransactionAnnotation` mixes `kind`, `target`, and `role` with `tier`,
  `detectorId`, `derivedFromTxIds`, and `provenanceInputs` in one row shape
  ([annotation-types.ts](../../../packages/transaction-interpretation/src/annotations/annotation-types.ts))
- annotation identity intentionally excludes detector-specific authorship
  details, which means different detectors can converge on the same semantic
  meaning ([annotation-fingerprint.ts](../../../packages/transaction-interpretation/src/annotations/annotation-fingerprint.ts))
- persistence replacement is still keyed by detector / input scope, which is a
  separate lifecycle from the semantic meaning itself
  ([transaction-annotation-store.ts](../../../packages/transaction-interpretation/src/persistence/transaction-annotation-store.ts))

This pass is deciding whether the new architecture should keep that fused shape
under a better name, or split claim from support explicitly.

## Needs Inventory

Any replacement must preserve all of the following:

- one durable machine answer to "what happened?"
- one stable review target for semantic truth decisions
- explicit evidence policy for canonical reads
- support for `processor`, `post_processor`, and `reconciler` contributions
- deterministic reprocess / invalidation behavior
- auditability of who contributed what and why
- freedom for multiple emitters to converge on the same meaning without
  producing incoherent canonical state

## Downstream Smell Check

This pass explicitly tests whether a lower-layer mechanism is being introduced
mainly to compensate for a downstream smell.

### `staking_reward_component`

The current repo has a concrete warning sign:

- `staking_reward_component` annotations are created from diagnostic metadata in
  [staking-reward-component-detector.ts](../../../packages/transaction-interpretation/src/detectors/staking-reward-component-detector.ts)
- they are then consumed by residual attribution logic in
  [exact-target-residual-role.ts](../../../packages/transaction-interpretation/src/residual/exact-target-residual-role.ts)

That data looks much closer to accounting attribution support than to durable,
cross-consumer semantic meaning.

Conclusion for this pass:

- `staking_reward` itself may still be a semantic claim when it truly answers
  "what happened?"
- `staking_reward_component` should not justify a general low-level
  support/attestation subsystem if its real purpose is to patch transfer
  matching or residual attribution downstream
- if this remains Cardano-specific accounting support, the better move is to
  refactor the downstream accounting / linking model rather than encode the
  workaround as core semantics architecture

## Options

### Option 1: Keep One Persisted Row Per Semantic Fact

Confidence: 26 / 100

Description:

- keep the proposed `semantic_fact` row as the single persisted unit
- review targets that row directly
- `evidence`, `emitter_lane`, `emitter_id`, support set, and provenance remain
  fields on the same row as the durable semantic meaning
- duplicate authorship across emitters stays a hard error

What it preserves well:

- simple read model
- simple review targeting
- straightforward persistence and invalidation
- minimal schema count

What it handles poorly:

- multiple independent supports for the same claim
- stable semantic truth across emitter cutovers
- richer provenance without bloating the semantic row
- separation of "what happened?" from "why do we think that happened?"

Assessment:

- This remains viable only if the architecture wants exactly one durable author
  for any given semantic meaning.
- That is too restrictive for the long-term direction of processor,
  post-processor, and reconciler cooperation.

### Option 2: Split `semantic_claims` From `semantic_supports`

Confidence: 90 / 100

Description:

- store one reviewable `semantic_claim`
- store one or more `semantic_support` rows that support that claim
- review targets claims, never supports
- canonical reads answer "what happened?" from claims, while evidence policy is
  computed from qualifying supports

Recommended row responsibilities:

- `semantic_claims`:
  - claim fingerprint
  - kind
  - kind version
  - target
  - role
  - typed refs
  - identity metadata
- `semantic_supports`:
  - support fingerprint
  - claim fingerprint
  - emitter lane / id
  - evidence mode
  - derived-from support set
  - correlation key
  - provenance basis / support metadata

What it preserves well:

- one durable semantic answer
- one stable review target
- explicit evidence filtering
- deterministic emitter-scoped replacement rules
- auditability of independent contributions

What it improves materially:

- two emitters can converge on the same claim without conflict
- provenance richness can grow without redefining claim identity
- claim truth and support lifecycle stop competing for the same row shape
- review becomes semantically cleaner because it targets meaning, not authorship

Tradeoffs:

- more schema and runtime machinery
- requires explicit visibility rules for claims with zero qualifying supports
- requires claim lifecycle rules during reprocess and support invalidation

Assessment:

- This is the best fit for the stated future-proofing goal.
- It creates a clean seam between semantics ownership and ingestion-owned
  support authoring.

### Option 3: Store Supports Only And Project Claims

Confidence: 62 / 100

Description:

- persist support / attestation rows only
- compute or materialize claims from those rows
- review targets a projected claim identity

What it preserves well:

- many emitters can contribute naturally
- no duplication between claim and support storage
- strong audit posture

What it complicates:

- stable review targeting
- transactional freshness of projected claims
- schema evolution for projections
- mental model for consumers, who now depend on a derived semantic layer for
  every read

Assessment:

- This is architecturally coherent, but it is too projection-heavy for the
  current codebase stage.
- It would front-load complexity before the claim contract is even stable.

## Recommended Decision

Choose Option 2: split `semantic_claims` from `semantic_supports`.

Decision summary:

- the durable semantic unit is the claim
- the durable audit / evidence unit is the support
- review targets the claim
- emitters author supports, not claims directly
- claims are visible in canonical reads only when they have at least one
  qualifying support under the caller's evidence policy
- duplicate authorship should fail only for duplicate support from the same
  emitter, not for independent emitters reaching the same claim

## Concrete Contract Changes If Adopted

These are the changes this pass would push into the maintained contract docs if
accepted.

### Changes To 01. Core Contract

- change the transaction-semantics channel from "semantic facts" to
  "semantic claims plus semantic supports"
- review subject `semantic_fact` becomes `semantic_claim`
- semantic truth decisions (`confirm` / `dismiss`) apply to claims, not to
  supports
- canonical semantic reads return effective claims filtered by support policy
  and review state

### Changes To 02. Semantic Facts And Evolution

- split the current "Semantic Fact Row" section into:
  - `semantic_claim` row contract
  - `semantic_support` row contract
- move `evidence`, `emitter_lane`, `emitter_id`,
  `derived_from_tx_fingerprints`, and `correlation_key` off the claim row and
  onto the support row
- keep claim identity close to the current `fact_fingerprint` recipe
- introduce a support identity recipe keyed by:
  - claim fingerprint
  - emitter lane / id
  - support set
  - support-shape fields that matter for replacement
- replace duplicate-authorship failure across all emitters with a narrower
  conflict rule:
  - same emitter may replace its own support
  - different emitters may support the same claim

### Changes To 03. Runtime Ownership And Reads

- processors, post-processors, and reconcilers author supports
- claim materialization happens transactionally alongside support writes
- reprocess invalidates supports by emitter scope; claims are then recomputed or
  removed transactionally when they no longer have any surviving support
- canonical reads evaluate:
  - effective claim review state
  - qualifying support set under explicit evidence policy
  - kind-specific supersession

## Consequences For Later Passes

This decision narrows the scope of later passes:

- the evidence-model pass can focus on support quality, not claim identity
- the review-namespace pass can focus on claim truth and participation policy
- the ledger-overlap pass can ask whether `staking_reward` should be a claim at
  all in some cases, without forcing that decision to carry emitter-provenance
  semantics with it

## Naming Notes

Preferred terms for this pass:

- `semantic_claim` over `semantic_fact` for the reviewable meaning
- `semantic_support` over `attestation`

Reason:

- `claim` vs `support` reads clearly as "meaning" vs "basis"
- `attestation` risks sounding more formal and trust-heavy than the system
  currently is

## Current Recommendation Status

Recommended, not yet accepted.

Do not rewrite the maintained contract docs around this decision until the
project confirms that claim/support separation is the direction to adopt.
