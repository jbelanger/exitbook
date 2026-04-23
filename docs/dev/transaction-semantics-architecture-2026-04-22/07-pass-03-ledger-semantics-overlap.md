---
last_verified: 2026-04-22
status: proposed
derived_from:
  - ./01-core-contract.md
  - ./02-semantic-facts-and-evolution.md
  - ./03-runtime-ownership-and-reads.md
---

# Pass 03: Ledger / Semantics Overlap Policy

This note records the third focused design pass over the transaction-semantics
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

The maintained contract says channels should not overlap, but freezes one
durable exception:

- a movement with `accounting_role: 'staking_reward'` must also have a matching
  movement-scoped `staking_reward` semantic fact
  ([01. Core Contract](./01-core-contract.md))

That exception is enforced through a reconciler workflow
([03. Runtime Ownership And Reads](./03-runtime-ownership-and-reads.md)).

This pass asks whether that overlap is a sound long-term architecture decision
or a symptom that downstream consumers are reading the wrong layer.

## Evidence From Current Code

The current system already shows both sides of the pressure.

### Ledger-owned usage

Many accounting and UI paths treat `staking_reward` as a ledger role:

- movement-role materialization and override replay live in
  [transaction-movement-role-replay.ts](../../../packages/data/src/overrides/transaction-movement-role-replay.ts)
- accounting model preparation, linking, and CLI views frequently read
  `movementRole` directly
- repo tests across accounting and CLI assert `movementRole: 'staking_reward'`
  as a first-class ledger concept

### Semantic usage

Some consumers also treat `staking_reward` as semantic meaning:

- the current detector simply mirrors `movementRole` into a movement-scoped
  semantic annotation in
  [staking-reward-detector.ts](../../../packages/transaction-interpretation/src/detectors/staking-reward-detector.ts)
- Canada tax workflow tests explicitly use asserted staking-reward annotations
  when building income-category behavior
- gap analysis prefers asserted staking-reward annotations over raw
  movement-role hints in some cases

### Overlap smell

The overlap is not driven by richer semantic evidence. The current detector is
derived directly from `movementRole` and uses `provenanceInputs: ['movement_role']`.

That means the lower layer is duplicating one ledger decision into semantics so
some downstream consumers can read a semantic-shaped signal instead of a
ledger-shaped one.

## Needs Inventory

Any replacement must preserve all of the following:

- ledger remains canonical for accounting role and user overrides
- consumers that need durable semantic meaning can still identify staking
  rewards correctly
- canonical reads stay transactionally fresh after override writes and reprocess
- user corrections do not silently disappear from accounting behavior
- the system remains open to future cases where ledger and semantics genuinely
  overlap

## Downstream Smell Check

This pass explicitly tests whether the overlap exists to satisfy a real semantic
need or to compensate for downstream modeling mistakes.

### Current warning sign

The current overlap is enforced by:

- a reconciler lane
- override-aware downgrade logic
- claim dismissal behavior
- special-case delete rules

all to keep `staking_reward` visible as both ledger role and semantic fact.

That is a lot of lower-layer machinery for a signal that is currently derived
from one ledger-owned classification.

Conclusion for this pass:

- if a consumer only needs to know that a movement is excluded from transfer
  matching, categorized as income, or treated specially in accounting, it
  should probably read the ledger-owned `accounting_role`
- semantics should only duplicate ledger truth when the duplicated claim is
  independently valuable as a semantic surface across consumers
- the fact that the current overlap is Cardano-shaped is a strong hint that we
  should challenge downstream ownership before normalizing this into a general
  lower-layer invariant

## Options

### Option 1: Keep The `staking_reward` Mirror As A Durable Exception

Confidence: 39 / 100

Description:

- keep the current v1 overlap
- preserve the reconciler and mirror rule
- allow downstream consumers to keep reading either ledger role or semantic
  claim depending on convenience

What it preserves well:

- minimal downstream migration
- semantic consumers keep their current shape
- user overrides remain visible through both channels

What it handles poorly:

- duplicated truth across channels
- special-case reconciler complexity
- future pressure to add more mirrored exceptions
- unclear ownership boundary between ledger and semantics

Assessment:

- This is acceptable as a temporary migration bridge.
- It is weak as a long-term architecture rule because it rewards downstream
  ambiguity instead of forcing clean reads from the right layer.

### Option 2: Make Ledger Canonical, Expose Consumer-Owned Projections

Confidence: 87 / 100

Description:

- ledger stays canonical for `accounting_role`
- semantics no longer mirrors ledger-owned roles by default
- consumers that need a semantic-shaped staking projection build that as a
  consumer-owned projection over ledger plus semantic context
- only genuinely independent semantic claims remain in the semantics channel

Under this option:

- `staking_reward` as ledger role remains authoritative for accounting
  exclusions, residual attribution, and transfer behavior
- tax or history consumers that need a staking label or income-category signal
  can project that from ledger role and transaction context without requiring a
  mirrored semantic claim
- the reconciler exception goes away unless a later use case proves that the
  semantic claim must exist independently of the ledger role

What it preserves well:

- one owner for accounting-role truth
- clear user-override semantics
- smaller lower-layer surface
- future ability to add a true semantic claim later if needed

What it improves materially:

- removes the cross-channel invariant and reconciler special case
- forces downstream capabilities to read the appropriate layer
- avoids teaching the system that any ledger-owned role deserves a mirrored
  semantic claim

Tradeoffs:

- downstream consumers that currently rely on semantic `staking_reward` rows
  need refactors
- some user-facing history or tax projections may need new adapters
- you lose the convenience of a single semantic query answering every question

Assessment:

- This is the best fit for the non-overlapping-channel goal.
- It also follows the new analysis rule: refactor downstream consumers rather
  than institutionalize a lower-layer exception if the exception exists mainly
  to serve downstream convenience.

### Option 3: Generalize Ledger-Derived Semantic Claims As A Formal Category

Confidence: 58 / 100

Description:

- keep overlap, but stop pretending it is an exception
- define a formal class of ledger-derived semantic claims
- use a generic projection or reconciler mechanism whenever a ledger-owned role
  must also appear in semantics

What it preserves well:

- a principled story for future overlap
- explicit ownership of derived-semantic projection mechanics
- cleaner than one-off ad hoc exceptions

What it handles poorly:

- normalizes duplication between channels
- introduces a whole lower-layer mechanism before overlap demand is proven
- risks encoding downstream convenience as architecture

Assessment:

- This is stronger than Option 1 if overlap turns out to be common.
- Right now the evidence does not justify building a whole system around one
  Cardano-shaped exception.

## Recommended Decision

Choose Option 2: ledger stays canonical for `accounting_role`, and downstream
consumers that need staking-specific behavior should own projections over that
ledger truth instead of relying on a mirrored semantic claim.

Decision summary:

- remove the durable `staking_reward` overlap invariant from the target
  architecture
- treat the current mirror as a migration convenience, not as a greenfield rule
- read `accounting_role` directly for accounting, transfer, and residual logic
- only keep staking in semantics if a later use case proves that a semantic
  claim is independently meaningful beyond the ledger-owned role

## Concrete Contract Changes If Adopted

These are the changes this pass would push into the maintained contract docs if
accepted.

### Changes To 01. Core Contract

- remove the statement that `staking_reward` appears in both ledger and
  semantics as a durable frozen overlap
- strengthen the non-overlap rule:
  - ledger owns `accounting_role`
  - semantics owns only independent claims about "what happened?"
- document that consumer projections may combine ledger and semantic channels,
  but that does not make the channels overlap at storage level

### Changes To 02. Semantic Facts And Evolution

- remove the implication that movement-scoped `staking_reward` is required
  because of a ledger invariant
- keep movement scope available as an extension seam, but not for mandatory
  mirroring of ledger-owned roles

### Changes To 03. Runtime Ownership And Reads

- remove the reconciler-owned `staking_reward` overlap workflow from the target
  contract
- remove `ledger_override_sync` as a required durable semantic author for this
  use case
- require accounting / linking / tax consumers to read:
  - `movements.accounting_role`
  - semantic claims only when they provide independent meaning not already
    owned by the ledger

## Consequences For Later Passes

This decision sharpens later passes:

- the evidence-model pass no longer needs to justify a reconciler-authored
  support for ledger-derived staking claims
- the kind-ownership pass becomes cleaner because staking no longer forces a
  global semantic kind for a ledger-owned role
- future overlap can be judged against a clearer standard: independent semantic
  value, not downstream convenience

## Naming Notes

Preferred terms for this pass:

- `ledger-owned role` over `ledger-authored semantic`
- `consumer projection` over `mirror`

Reason:

- `ledger-owned role` makes it explicit that the durable truth belongs to the
  ledger channel
- `consumer projection` describes the right place to combine layers without
  implying duplicate storage truth

## Current Recommendation Status

Recommended, not yet accepted.

Do not rewrite the maintained contract docs around this decision until the
project confirms that the `staking_reward` overlap should be treated as a
migration bridge and removed from the target architecture.
