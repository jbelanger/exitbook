---
last_verified: 2026-04-23
status: proposed
derived_from:
  - ./01-core-contract.md
  - ./05-pass-01-claim-vs-support.md
  - ./08-pass-04-evidence-model.md
---

# Pass 05: Review Namespace And Authority Model

This note records the fifth focused design pass over the transaction-semantics
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

The current split docs define one broad `review_decisions` model for two
families inside transaction semantics:

- participation review via `include` / `exclude` on `transaction`, `movement`,
  and `asset`
- claim-truth review via `confirm` / `dismiss` on `semantic_fact`
  ([01. Core Contract](./01-core-contract.md))

That is much cleaner than the current repo-wide sprawl, but it is still broad
enough to invite the wrong next step: treating every review-like or
override-like workflow in the repo as one unified review system.

The current codebase already shows that several decision families look similar
at the storage level while still having materially different semantics.

## Evidence From Current Code

### A shared event substrate already carries multiple decision families

The durable override store is one append-only table with `scope`, `reason`,
`actor`, and `payload_json`
([override-store.ts](../../../packages/data/src/overrides/override-store.ts),
[001_initial_schema.ts](../../../packages/data/src/overrides/migrations/001_initial_schema.ts)).

The core override union currently includes 12 scopes
([override.ts](../../../packages/core/src/override/override.ts)).

Those scopes are not one semantic family. At minimum, they already split into:

- participation-style state:
  - `asset-exclude`
  - `asset-include`
- evidence confirmation:
  - `asset-review-confirm`
  - `asset-review-clear`
- issue resolution:
  - `link-gap-resolve`
  - `link-gap-reopen`
- relationship adjudication or manual correction:
  - `link`
  - `unlink`
  - `transaction-movement-role`
  - `transaction-user-note`
  - price and FX overrides

Shared storage exists today. Shared meaning does not.

### Participation review is already its own family

Asset exclusion replay is intentionally strict and latest-event-wins by
`asset_id`
([asset-exclusion-replay.ts](../../../packages/data/src/overrides/asset-exclusion-replay.ts)).

That is a participation decision:

- it changes accounting scope
- it is keyed by asset identity
- re-inclusion means "back in scope", not "the prior claim was false"

This aligns with the proposed transaction/asset participation decisions in the
doc.

### Evidence confirmation is not the same as truth review

Asset review confirmation is keyed by `asset_id`, but its meaning is "the user
confirmed this specific evidence fingerprint"
([asset-review-replay.ts](../../../packages/data/src/overrides/asset-review-replay.ts)).

The asset-review projection then marks confirmation stale when the evidence
fingerprint changes
([asset-review-summary-overlays.ts](../../../packages/core/src/asset-review/asset-review-summary-overlays.ts),
[asset-review.ts](../../../packages/core/src/asset-review/asset-review.ts)).

That is not the same as semantic claim truth review:

- it is confirmation of a support set, not confirmation that a durable claim is
  true
- it has first-class staleness semantics
- clearing the confirmation means "needs fresh review", not "dismiss the claim"

If this gets forced into the same semantic review contract as
`confirm` / `dismiss` on claims, the contract will either become vague or start
growing family-specific escape hatches.

### Issue resolution is not review truth either

Link-gap resolution replay is keyed by an issue identity and means "treat this
gap as intentionally resolved until reopened"
([link-gap-resolution-replay.ts](../../../packages/data/src/overrides/link-gap-resolution-replay.ts)).

That is an issue workflow, not review of a semantic fact or participation
subject:

- the subject is an issue key, not a domain entity fingerprint
- the verbs are `resolve` / `reopen`, not `include` / `exclude` or
  `confirm` / `dismiss`
- it has a reason trail that matters to the issue workflow itself

### Relationship adjudication is separate again

Transaction links already have their own domain status model:

- `suggested`
- `confirmed`
- `rejected`
  ([transaction-link.ts](../../../packages/core/src/transaction/transaction-link.ts))

That is another sign that not every "user decision" should be normalized into
one review vocabulary just because it is append-only and auditable.

## Needs Inventory

Any replacement must preserve all of the following:

- append-only, auditable decision history
- deterministic effective state per decision family
- atomic multi-decision workflows where one action intentionally writes several
  decisions together
- manual-over-rule precedence where that policy is actually needed
- room for families with different subject identities, verbs, and staleness or
  reopening semantics
- the ability to share storage primitives without forcing unlike workflows into
  one semantic contract

## Downstream Smell Check

This pass explicitly tests whether a broad lower-layer review system is being
designed because downstream workflows already happen to use append-only
decision history.

Warning signs in the current repo:

- asset review confirmation is a freshness-sensitive evidence workflow
- link-gap resolution is an issue-resolution workflow
- link confirmation/rejection is relationship adjudication
- price / FX overrides are direct data corrections

Those workflows may share persistence machinery, but they do not need a shared
review meaning model.

Conclusion for this pass:

- transaction semantics should define only the decision namespaces it actually
  owns
- if a downstream workflow needs a different decision family, prefer keeping it
  downstream or refactoring that workflow there
- do not enlarge the semantics-layer review contract just to absorb unrelated
  override families

## Options

### Option 1: Keep One Unified Review Model

Confidence: 38 / 100

Description:

- keep the proposed `review_decisions` contract essentially as written
- treat participation and claim-truth review as one shared model with one
  authority system and one subject-family vocabulary
- extend it later if other workflows need in

What it preserves well:

- one simple conceptual surface
- one collapse model for manual and rule precedence
- straightforward atomic workflows across participation and claim truth

What it handles poorly:

- it encourages unrelated downstream workflows to force-fit themselves into the
  same model
- `subject family` becomes overloaded because participation, claim truth,
  evidence confirmation, and issue resolution do not partition the same way
- family-specific semantics like stale confirmation or `resolve` / `reopen`
  have nowhere clean to live

Assessment:

- This is acceptable only if transaction semantics remains the strict boundary
  and no one treats it as the generic decision framework for the repo.
- Given the current code shape, that is not a safe assumption.

### Option 2: Shared Decision Substrate, Explicit Namespaces

Confidence: 93 / 100

Description:

- keep or allow a shared append-only storage substrate if it is operationally
  useful
- make decision meaning explicit through a `decision_namespace`
- transaction semantics owns only the namespaces it actually needs in v1:
  - `participation`
  - `claim_truth`
- each namespace defines its own:
  - subject kinds
  - verbs
  - effective-state collapse rules
  - authority-family partitioning
- other families stay outside this contract unless there is a real reason to
  bring them in later

Recommended boundaries:

- `participation`
  - subjects: `transaction`, `asset`, optionally `movement`
  - verbs: `include`, `exclude`
  - authority families: by participation subject family
- `claim_truth`
  - subjects: `semantic_claim`
  - verbs: `confirm`, `dismiss`
  - authority families: by claim-truth family, likely kind-group or
    namespace-owned kind partition rather than one raw global subject type
- outside this contract for now:
  - asset-review evidence confirmation
  - link-gap issue resolution
  - transaction-link adjudication
  - direct price / FX correction

Manual authority recommendation:

- keep effective manual precedence profile-scoped if desired
- but persist actor metadata for audit; do not pretend person identity is
  irrelevant to the stored history just because it is not part of effective
  precedence

What it preserves well:

- append-only audit history
- atomic participation + claim-truth workflows
- a clean manual-over-rule story where it actually matters
- flexibility to reuse storage without pretending all decisions mean the same
  thing

What it improves materially:

- keeps transaction semantics from becoming the repo-wide override framework
- lets each namespace own the semantics it actually needs
- avoids polluting claim-truth review with evidence-confirmation or issue-state
  mechanics

Tradeoffs:

- one more contract concept to name and document
- slightly more query and write plumbing than a single universal review API
- some existing language like `subject family` should be tightened

Assessment:

- This is the cleanest fit for both the proposed architecture and the current
  code evidence.
- It preserves the good part of unification, shared substrate and atomicity,
  without over-unifying the meaning model.

### Option 3: Fully Separate Subsystems Per Decision Family

Confidence: 57 / 100

Description:

- give participation, claim truth, evidence confirmation, issue resolution, and
  link adjudication separate storage and runtime contracts
- do not share a generic decision model at all

What it preserves well:

- precise semantics per family
- minimal ambiguity about verbs, subjects, and authority
- low risk of accidental over-generalization

What it handles poorly:

- repeated append-only storage logic
- harder atomic workflows when one user action intentionally touches more than
  one family
- duplicated precedence and audit tooling

Assessment:

- This is safer than option 1, but it gives up too much useful shared
  infrastructure.
- The repo does not need one global review model, but it also does not need
  five unrelated persistence stacks.

## Recommendation

Choose option 2.

The architecture should separate:

- shared decision substrate, if needed
- decision namespace
- namespace-specific authority rules

For the transaction-semantics contract itself, define only:

- `participation` decisions
- `claim_truth` decisions

Do not widen that contract just because the current repo already has other
append-only override families.

## Contract Implications

If accepted, this pass would change the maintained docs in the following ways:

- replace the broad `review_decisions` framing with namespace-aware decision
  framing
- rename `semantic_fact` review subjects to `semantic_claim` if pass 1 is also
  accepted
- define authority ownership per namespace-specific decision family rather than
  one broad `subject family` abstraction
- keep workflow atomicity, but describe it as atomic writes across namespaces
  rather than proof that all decisions belong to one unified review model
- explicitly state that evidence confirmation and issue resolution are outside
  the transaction-semantics review contract unless brought in by a later pass

## Naming Notes

Names that likely need tightening if this pass is accepted:

- `review_decisions` -> `decision_events` or `review_events`
- `subject family` -> `decision family` or `authority family`
- `manual authority` -> keep as precedence concept, but do not use it as a
  substitute for stored actor identity
