---
last_verified: 2026-04-23
status: proposed
derived_from:
  - ./01-core-contract.md
  - ./02-semantic-facts-and-evolution.md
  - ./03-runtime-ownership-and-reads.md
  - ./05-pass-01-claim-vs-support.md
---

# Pass 04: Evidence Model

This note records the fourth focused design pass over the transaction-semantics
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

The current split docs use a very thin semantic evidence model:

- `evidence` lives on the persisted semantic row
- `evidence` is only `asserted` or `inferred`
  ([02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md))
- canonical reads filter by evidence policy, but review `confirm` / `dismiss`
  is explicitly orthogonal to evidence visibility
  ([01. Core Contract](./01-core-contract.md))

That is cleaner than the old system, but too coarse for the actual support
shapes already present in the repo.

## Evidence From Current Code

The existing `transaction-interpretation` layer already distinguishes more than
two support qualities, even if it names them loosely.

### Explicit tier filtering already matters

`TransactionAnnotationQuery` forces callers to choose `tiers` explicitly
([transaction-annotation-query.ts](../../../packages/transaction-interpretation/src/persistence/transaction-annotation-query.ts)).

Callers already use this to make materially different trust decisions:

- linking loads `['asserted', 'heuristic']`
- gap analysis and manual-link prep often prefer `asserted` but can fall back
  to `heuristic`
- many tax and readiness paths want only `asserted`

### Provenance already carries real signal

The current system is not just distinguishing "strong" and "weak" evidence.
It is distinguishing different support bases:

- source-local + diagnostic-backed bridge annotations use
  `['processor', 'diagnostic']`
- heuristic bridge pairing uses `['timing', 'address_pattern', 'counterparty']`
- staking mirror uses `['movement_role']`

Those are materially different support shapes, but the current proposal would
compress them into a binary `asserted | inferred`.

### Broad all-tier loading is already a smell

Some ports still just load `ANNOTATION_TIERS` wholesale, for example
[cost-basis-ports.ts](../../../packages/data/src/accounting/cost-basis-ports.ts),
which means part of the trust boundary has leaked out of the query surface and
into downstream ad hoc filtering.

### The repo already has a stronger evidence / confirmation split elsewhere

Asset review already models evidence and confirmation separately:

- `asset_review_state` stores `evidence_fingerprint`,
  `confirmed_evidence_fingerprint`, and `confirmation_is_stale`
- `asset_review_evidence` stores the contributing evidence rows
  ([001_initial_schema.ts](../../../packages/data/src/migrations/001_initial_schema.ts),
  [database-schema.ts](../../../packages/data/src/database-schema.ts))

That existing pattern supports the direction from pass 1:

- support quality and support contents belong with evidence rows
- confirmation belongs with review state, not with the evidence row itself

## Needs Inventory

Any replacement must preserve all of the following:

- explicit consumer trust boundaries
- distinction between direct source-local support, deterministic derived
  support, and heuristic support
- deterministic persistence and replacement rules
- review orthogonality: `confirm` / `dismiss` changes claim truth, not support
  quality
- small enough surface that consumers do not need to parse free-form provenance
  blobs to decide what to include

## Downstream Smell Check

This pass explicitly tests whether evidence richness is needed for semantic
support quality or whether it is being asked to encode downstream policy that
belongs elsewhere.

### Current warning signs

- some broad ports load all tiers and leave consumers to sort it out later
- many downstream tests branch directly on `tier === 'asserted'`
- provenance inputs are exposed raw into exports and CLI surfaces

Conclusion for this pass:

- the evidence model should become richer than a binary enum
- but it should not become a dumping ground for every consumer’s threshold,
  scoring rule, or manual trust override
- if a consumer wants "heuristic bridge support is acceptable for linking but
  not for tax", that is a consumer trust policy, not a reason to build a
  universal semantics-layer scoring engine
- if manual review wants to treat a weakly supported claim as acceptable in one
  workflow, that is a review-policy question, not evidence promotion

## Options

### Option 1: Keep Binary Evidence On Supports

Confidence: 33 / 100

Description:

- adopt pass 1 claim/support separation
- keep support-level evidence as a binary enum like `asserted | inferred`
- leave richer support reasoning in auxiliary metadata or emitter-specific code

What it preserves well:

- simple query surface
- simple canonical read rules
- easy migration from the current proposal

What it handles poorly:

- it still collapses direct, derived, and heuristic support into too few
  categories
- it invites consumers to peek into metadata or emitter ids to recover nuance
- it cannot cleanly express the trust boundary already present in current code

Assessment:

- This is cleaner than today’s fused row model, but still too lossy.
- It would force the system to re-invent nuance through side channels.

### Option 2: Support Mode Taxonomy Plus Basis Inputs

Confidence: 91 / 100

Description:

- adopt pass 1 claim/support separation
- move evidence onto `semantic_support`
- replace binary evidence with a small support-mode taxonomy
- keep a structured basis-input set so callers can understand why a support
  exists without reverse-engineering emitter ids

Recommended support fields:

- `support_mode`: one of
  - `direct`
  - `derived`
  - `heuristic`
- `basis_inputs`: a small enum set, replacing the current
  `provenanceInputs`

Recommended meanings:

- `direct`: source-local or transaction-local support where the system knows the
  claim from the raw record / transaction itself
- `derived`: deterministic system derivation over persisted state or typed
  supporting data
- `heuristic`: pattern- or correlation-based support that is intentionally not
  strong enough for every consumer

What it preserves well:

- explicit trust boundaries
- current direct vs heuristic usage patterns
- deterministic storage and replacement
- orthogonality between support quality and review truth

What it improves materially:

- consumers can filter on support mode without parsing ad hoc provenance
- the model can express deterministic post-processor support without pretending
  it is either "asserted" or fully heuristic
- current provenance signals remain useful without becoming the primary trust
  API

Tradeoffs:

- migration requires replacing `tier` with `support_mode`
- a few existing provenance inputs may need renaming or consolidation
- consumers must keep their evidence policies explicit rather than relying on
  one default

Assessment:

- This is the best fit for the current repo and for the pass-1 claim/support
  decision.
- It is rich enough to reflect real support shapes, while still small enough to
  avoid policy sprawl.

### Option 3: Numeric Confidence / Score-Based Evidence

Confidence: 46 / 100

Description:

- store a numeric confidence score or probability on each support
- optionally keep provenance inputs alongside the score
- let consumers choose thresholds

What it preserves well:

- flexible filtering
- good fit for heuristic or ML-like sources if they appear later

What it handles poorly:

- consumers now own threshold tuning instead of reading a stable evidence class
- scores imply a precision the current rules do not actually have
- deterministic migrations become harder when scoring heuristics change
- review discussions turn into threshold arguments instead of semantic ones

Assessment:

- This is tempting, but premature.
- It would encode downstream threshold policy into the semantics model before
  the project has even stabilized the support taxonomy.

## Recommended Decision

Choose Option 2: put evidence on supports, use a small support-mode taxonomy,
keep basis inputs structured, and keep review orthogonal.

Decision summary:

- `semantic_claim` owns meaning
- `semantic_support` owns support quality
- support quality is expressed as `direct | derived | heuristic`
- basis inputs remain structured and explicit
- `confirm` / `dismiss` never promote or demote support mode
- consumers must choose explicit support policies; the semantics layer should
  not own per-consumer trust defaults

## Concrete Contract Changes If Adopted

These are the changes this pass would push into the maintained contract docs if
accepted.

### Changes To 02. Semantic Facts And Evolution

- remove `evidence` from the claim contract
- add support-level fields:
  - `support_mode`
  - `basis_inputs`
- replace the binary `asserted | inferred` statement with a small support-mode
  taxonomy
- keep support identity independent from review state

Suggested support contract shape:

- `claim_fingerprint`
- `support_fingerprint`
- `support_mode`
- `basis_inputs`
- `emitter_lane`
- `emitter_id`
- support set / correlation fields
- non-identity support metadata

### Changes To 01. Core Contract

- clarify that claim truth decisions and support quality are separate concerns
- keep `confirm` / `dismiss` as claim-truth decisions only
- state explicitly that review does not widen support visibility or rewrite
  support mode

### Changes To 03. Runtime Ownership And Reads

- canonical semantic reads operate on:
  - effective claim review state
  - explicit support filter / evidence policy
  - kind-specific supersession
- transaction-semantics should expose generic filtering over support modes
  rather than consumer-specific trust presets
- consumer-owned ports may define named evidence policies, but those policy
  names belong to the consumer, not to the core semantics contract

## Consequences For Later Passes

This decision narrows later passes:

- the review-namespace pass can focus on claim truth and participation without
  also owning support strength
- the kind-catalog pass stays clean because support quality no longer leaks into
  kind identity
- future chain-specific heuristics can land as `heuristic` support without
  forcing binary "asserted vs inferred" arguments

## Naming Notes

Preferred terms for this pass:

- `support_mode` over `evidence`
- `basis_inputs` over `provenanceInputs`

Reason:

- `support_mode` is less overloaded than `evidence`, which in this repo already
  appears in other review and issue contexts
- `basis_inputs` better communicates "what this support relies on" than
  `provenanceInputs`, which sounds more historical than epistemic

## Current Recommendation Status

Recommended, not yet accepted.

Do not rewrite the maintained contract docs around this decision until the
project confirms that semantic support quality should be modeled as a small
support-mode taxonomy rather than a binary enum or numeric score.
