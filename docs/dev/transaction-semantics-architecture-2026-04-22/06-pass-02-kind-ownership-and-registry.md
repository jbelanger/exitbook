---
last_verified: 2026-04-22
status: proposed
derived_from:
  - ./02-semantic-facts-and-evolution.md
  - ./03-runtime-ownership-and-reads.md
  - ../../architecture/architecture-package-contract.md
---

# Pass 02: Kind Ownership And Registry Decentralization

This note records the second focused design pass over the transaction-semantics
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

The current split docs improve kind discipline, but the kind-definition
contract is still too centralized for the stated future-proofing goal.

The proposed contract requires each kind definition to declare not only its
identity-bearing semantics, but also:

- `label_projection`
- `primary_label_precedence`
- grouping behavior
- supersession behavior

and to register through one central registry
([02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md)).

That is good discipline for semantic identity, but it becomes a hotspot when
consumer policy gets pulled into the same contract.

## Evidence From Current Code

The current `@exitbook/transaction-interpretation` package already shows the
failure mode this refactor is trying to escape:

- one central kind list in
  [annotation-types.ts](../../../packages/transaction-interpretation/src/annotations/annotation-types.ts)
- one central label-priority list in
  [derive-operation-label.ts](../../../packages/transaction-interpretation/src/labels/derive-operation-label.ts)
- one broad package root exporting annotations, labels, transfer intent,
  readiness, residual attribution, gap policy, detectors, runtime, and store
  contracts from one entrypoint
  ([index.ts](../../../packages/transaction-interpretation/src/index.ts))

This is also visible in downstream policy code:

- transfer intent branches on label strings like `bridge/send` and
  `asset migration/receive` in
  [transaction-transfer-intent.ts](../../../packages/transaction-interpretation/src/transfer/transaction-transfer-intent.ts)
- gap policy branches on label strings and semantic kinds in
  [transaction-gap-policy.ts](../../../packages/transaction-interpretation/src/gap/transaction-gap-policy.ts)
- readiness uses a central derived operation helper to suppress or surface
  issues in
  [transaction-readiness-issues.ts](../../../packages/transaction-interpretation/src/readiness/transaction-readiness-issues.ts)

A quick repo scan found 56 files across `packages/transaction-interpretation`,
`packages/accounting`, and `apps/cli` referencing concrete semantic labels or
kind strings. That is a hotspot pattern, not a clean extension seam.

## Needs Inventory

Any replacement must preserve all of the following:

- one stable global semantic vocabulary for durable machine meaning
- one canonical place for identity-bearing kind contracts
- explicit schema and versioning rules for persisted semantics
- deterministic composition so hosts know which kinds exist
- clear extension rules for new chain / protocol behaviors
- freedom for downstream capabilities to opt into only the semantic projections
  they actually need

## Downstream Smell Check

This pass explicitly tests whether registry centralization is being justified by
downstream consumer smells rather than true semantic needs.

### Current warning sign

The repo architecture contract says feature packages own feature-specific read
models and consumer-owned ports, while shared packages should not become
cross-feature helper hubs
([architecture-package-contract.md](../../architecture/architecture-package-contract.md)).

The current `transaction-interpretation` package violates that direction by
owning:

- semantic meaning
- label derivation
- transfer heuristics
- readiness logic
- residual attribution support
- gap policy

in one package root.

Conclusion for this pass:

- if a new kind requires central changes mainly because transfer matching,
  readiness, portfolio filtering, or UI labeling need another branch, that is a
  downstream ownership smell
- the right move is usually to refactor the downstream consumer to own its
  projection or policy adapter
- the core kind registry should grow only for durable semantic identity, not
  because downstream consumers have been taught to depend on one shared policy
  hub

### Cardano / staking relevance

This matters directly for the staking example.

If a Cardano-specific semantic edge case forces:

- a new global kind
- a global label-precedence decision
- transfer or readiness behavior in the shared semantics package

only to satisfy one downstream accounting heuristic, then the lower layer is
being distorted by downstream ownership mistakes.

That case should be challenged before expanding the central kind system.

## Options

### Option 1: Keep A Central Registry Owning The Full Kind Contract

Confidence: 34 / 100

Description:

- keep one central registry in the transaction-semantics capability
- every kind definition must declare identity, schema, grouping, supersession,
  label projection, and label precedence
- downstream consumers continue to rely on shared helpers built on top of that
  central contract

What it preserves well:

- one place to inspect all supported kinds
- one consistent add-a-kind checklist
- easy enforcement of uniform metadata / versioning rules

What it handles poorly:

- adding a kind remains a central-taxonomy event
- consumer policies remain coupled to the same registry
- chain-specific evolution will keep touching the same hotspot
- the semantics capability becomes the place where product policy accumulates

Assessment:

- This is disciplined, but too heavyweight and too coupled.
- It would likely recreate the current `transaction-interpretation` hotspot
  under cleaner names.

### Option 2: Keep A Thin Global Kind Catalog, Move Consumer Projections Out

Confidence: 89 / 100

Description:

- keep one small global semantic vocabulary
- keep one canonical catalog for identity-bearing kind contracts
- narrow that catalog to semantic responsibilities only
- move consumer projections and policies out to the capabilities that actually
  own them

The thin global catalog should own:

- `kind`
- `kind_version`
- scope and target rules
- allowed roles
- metadata schema
- claim/support identity participation
- grouping mode
- canonical semantic supersession rules

The thin global catalog should not require:

- operation-label projection
- primary-label precedence
- transfer-intent overrides
- readiness suppression rules
- gap / residual / portfolio policy

Those should be consumer-owned adapters or projection registries.

What it preserves well:

- one durable semantic language
- one stable place for persistence-facing kind identity
- one explicit composition surface for registered kinds
- strong versioning and schema discipline

What it improves materially:

- adding a kind no longer forces shared product-policy edits
- downstream capabilities opt in only where the new kind matters
- semantics stops acting like a feature-policy hub
- the extension seam for new chains is smaller and more honest

Tradeoffs:

- some projections will need their own registries or dispatch tables
- consumers must explicitly declare when they care about a new kind
- there is slightly more composition work at app wiring boundaries

Assessment:

- This is the best fit for the repo’s architecture contract and for the
  future-proofing goal.
- It keeps the global semantic language small without making the semantics
  package own every downstream implication of that language.

### Option 3: Fully Decentralize Kinds With No Global Catalog

Confidence: 47 / 100

Description:

- eliminate the global kind catalog entirely
- let capabilities or chain-specific modules define and interpret their own
  namespaced kinds
- consumers discover support by importing the modules they need

What it preserves well:

- very low central coordination
- easy chain-local experimentation
- no central hotspot

What it handles poorly:

- no single durable semantic language
- harder cross-consumer interoperability
- higher risk of string conventions becoming architecture
- more ambiguity in persistence and migration contracts

Assessment:

- This avoids the hotspot, but at too high a cost.
- It weakens exactly the shared semantic contract the refactor is supposed to
  establish.

## Recommended Decision

Choose Option 2: keep a thin global kind catalog and move consumer projections
out of the core kind registry.

Decision summary:

- keep one small global semantic vocabulary
- keep one central catalog for identity-bearing kind contracts
- remove consumer-policy fields from the mandatory kind-definition contract
- let accounting, history, readiness, transfer, and portfolio own their own
  projection or policy adapters over semantic kinds
- require explicit consumer opt-in when a new kind matters to that capability

## Concrete Contract Changes If Adopted

These are the changes this pass would push into the maintained contract docs if
accepted.

### Changes To 02. Semantic Facts And Evolution

- keep the kind-definition contract, but narrow it to persistence-facing and
  canonical-semantic concerns
- remove `label_projection` from the mandatory kind-definition contract
- remove `primary_label_precedence` from the mandatory kind-definition contract
- keep grouping and supersession only where they affect canonical semantic read
  behavior
- rename the central composition mechanism from "registry" to "catalog" if we
  want to emphasize declarative composition over manager-style ownership

Revised mandatory kind-definition shape:

- `kind`
- `kind_version`
- scope
- allowed roles
- metadata schema
- grouping mode
- canonical supersession behavior

### Changes To 03. Runtime Ownership And Reads

- move operation-label projection out of the transaction-semantics capability
  contract
- replace "kind-owned primary label precedence" with a consumer-owned labeling
  projection if the product still wants a unified label helper
- require downstream capabilities to branch on typed semantic queries or their
  own projection outputs, not on a shared semantics-package label policy

### Changes To Capability Ownership

- transaction semantics owns:
  - claim/support contracts
  - kind catalog
  - schema validation
  - fingerprinting
  - canonical semantic read rules
- accounting owns:
  - readiness
  - transfer policy
  - residual attribution
  - cost-basis-specific semantic projections
- history / presentation owns:
  - operation labels
  - display precedence
  - product-facing label vocabulary if still desired

## Consequences For Later Passes

This decision narrows later passes:

- the evidence-model pass can focus on support quality without dragging label
  policy into the same contract
- the ledger-overlap pass can ask whether some semantics should stay
  ledger-owned without also deciding UI label precedence
- future chain-specific semantics can be added with smaller central impact

## Naming Notes

Preferred terms for this pass:

- `kind catalog` over `kind registry` for the declarative composition surface
- `consumer projection` over `shared label helper` for downstream policy layers

Reason:

- `catalog` better communicates "declared set of supported kinds" than
  "runtime manager that owns all policy"
- `consumer projection` makes ownership explicit and fits the repo’s
  architecture contract better

## Current Recommendation Status

Recommended, not yet accepted.

Do not rewrite the maintained contract docs around this decision until the
project confirms that the central kind system should be narrowed to semantic
identity and canonical read behavior only.
