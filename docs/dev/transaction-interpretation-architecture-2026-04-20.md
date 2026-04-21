---
last_verified: 2026-04-20
status: proposed
---

# Transaction Interpretation Architecture

Owner: Codex + Joel

## Goal

Introduce a single persisted interpretation layer for transaction-level and
cross-transaction machine semantics without replacing ExitBook's canonical
transaction, movement, and fee model.

The design must:

- keep canonical accounting facts narrow and stable
- give downstream consumers one shared interpretation contract
- support both asserted and heuristic signals without pretending certainty
- plan for persistence from the start
- avoid a second redesign when review, pairing, and UI layers grow

## Scope

This document defines:

- the new `transaction-interpretation` capability
- the persisted annotation model
- how confidence and weaker signals are handled
- package boundaries
- how existing concepts migrate into the new model

This document does not define:

- full UI behavior
- every detector implementation
- every protocol registry entry
- human review workflows in detail

## Design Principles

### Canonical facts stay canonical

Transactions, movements, and fees remain the accounting source of truth.
Interpretation sits above canonical data. It does not replace it.

### One shared interpretation contract

Consumers should not need to combine raw diagnostics, `operation`, and
consumer-specific cues to understand what happened. They should read one shared
interpretation surface.

### Facts and weak signals are different

Strong machine conclusions and weaker machine hypotheses are both useful, but
they should not be represented the same way.

### Deterministic first, numeric scoring later

The core persisted model should not carry fake precision. Numeric confidence
scores belong on pairing and suggestion outputs, not on the shared fact row.

### Build for persistence now

Interpretation belongs in the database. The first implementation should use the
same core model that future review and projection work will build on.

## Architecture Overview

### Canonical layer

Canonical data remains:

- transaction identity and timing
- platform and chain context
- endpoint addresses
- movements
- fees
- diagnostics
- user notes
- accounting exclusion flag

### Interpretation layer

Add a dedicated feature package:

```text
packages/transaction-interpretation/
```

Responsibilities:

- derive transaction and movement annotations from canonical data
- persist those annotations
- expose read models and query APIs for downstream consumers
- provide detector registration and execution

This package does not own:

- raw provider parsing
- canonical transaction persistence
- tax policy
- asset-review decisions
- transfer link persistence

### Protocol identity layer

Add a separate package:

```text
packages/protocol-catalog/
```

Responsibilities:

- stable `ProtocolRef` identity
- known protocol contract and address mappings
- protocol display names and metadata
- resolution helpers from address or pattern to `ProtocolRef`

`transaction-interpretation` depends on `protocol-catalog`, not the other way
around.

## Core Model

### Interpretation primitive

The shared persisted primitive is `TransactionAnnotation`.

```ts
type AnnotationKind =
  | 'bridge_participant'
  | 'asset_migration_participant'
  | 'wrap'
  | 'unwrap'
  | 'protocol_deposit'
  | 'protocol_withdrawal'
  | 'airdrop_claim';

type AnnotationTier = 'asserted' | 'heuristic';

type AnnotationTarget = { scope: 'transaction' } | { scope: 'movement'; movementFingerprint: string };

interface TransactionAnnotation {
  annotationFingerprint: string;
  accountId: number;
  transactionId: number;
  txFingerprint: string;
  kind: AnnotationKind;
  tier: AnnotationTier;
  target: AnnotationTarget;
  protocolRef?: string | undefined;
  role?: string | undefined;
  groupKey?: string | undefined;
  detectorId: string;
  provenanceInputs: readonly (
    | 'processor'
    | 'diagnostic'
    | 'movement_role'
    | 'address_pattern'
    | 'timing'
    | 'counterparty'
  )[];
  metadata?: Record<string, unknown> | undefined;
}
```

### Meaning of `tier`

`tier` is the certainty class for the annotation.

- `asserted`
  - the detector has strong enough evidence to treat the annotation as a shared
    interpreted fact
- `heuristic`
  - the detector has useful but weaker evidence and the annotation should be
    available to consumers as a shared machine hypothesis

This replaces the need for a numeric confidence column on the core annotation
row.

### Annotation rules

- annotations are machine-authored
- annotations are persisted
- annotations are typed
- annotations are stable enough to support downstream reads and future review
- annotations must never be inferred from free-form note text
- annotations may be transaction-scoped or movement-scoped
- downstream consumers should read annotations for machine interpretation before
  consulting raw diagnostics

## Confidence Model

### Confidence is not a numeric field on the core row

The interpretation layer needs to represent uncertainty, but a scalar confidence
number on `TransactionAnnotation` is the wrong core abstraction.

Why:

- consumers need policy decisions, not floating-point mythology
- different consumers use different thresholds
- pairing confidence is not the same thing as annotation certainty
- a persisted number invites false precision

### The three channels of machine uncertainty

#### 1. Omit the annotation

If a detector does not have enough evidence to emit even a heuristic
annotation, it emits nothing.

#### 2. Emit a diagnostic

Diagnostics remain the home for processor warnings, ambiguity, and provenance.
They are still useful when the processor can say something is unusual but cannot
claim a shared interpretation.

#### 3. Emit a heuristic annotation

If a weaker signal is still important enough that multiple downstream consumers
should be able to reason about it consistently, emit a heuristic annotation.

Examples:

- `bridge_participant` + `tier='asserted'`
  - direct call to a known bridge protocol contract
- `bridge_participant` + `tier='heuristic'`
  - amount, timing, and address pattern evidence without direct protocol proof

### Where numeric confidence belongs

Numeric confidence still has a place, but not on the core annotation row.

- link and pair confidence belongs on transfer link suggestions
- view-specific ranking belongs on consumer projections
- optional future candidate tables may store scores if a real ranking workflow
  needs them

## Persistence

### Database shape

Persist interpretation in a dedicated table:

```text
transaction_annotations
```

Recommended columns:

- `id`
- `annotation_fingerprint`
- `account_id`
- `transaction_id`
- `tx_fingerprint`
- `target_scope`
- `movement_fingerprint` nullable
- `kind`
- `tier`
- `role` nullable
- `protocol_ref` nullable
- `group_key` nullable
- `detector_id`
- `provenance_inputs_json`
- `metadata_json` nullable
- `created_at`
- `updated_at`

Recommended constraints:

- unique `annotation_fingerprint`
- if `target_scope='movement'`, `movement_fingerprint` is required
- if `target_scope='transaction'`, `movement_fingerprint` must be null

### Why a table instead of `annotations_json`

Use a table, not a JSON column on `transactions`.

Reasons:

- transaction- and movement-scoped annotations share one model
- downstream consumers need to query by kind, tier, protocol, and group key
- future review and projection work needs stable row identity
- write and replay behavior stays explicit

### Fingerprint stability

`annotation_fingerprint` must be deterministic from:

- annotation kind
- tier
- target
- protocol ref
- role
- group key
- normalized detector-stable metadata

This creates a durable identity for replay and future review without making the
annotation row itself mutable review state.

## Package Layout

### `packages/transaction-interpretation`

Recommended structure:

```text
packages/transaction-interpretation/
  src/
    annotations/
      annotation-types.ts
      annotation-fingerprint.ts
      annotation-schemas.ts
    detectors/
      bridge-participant-detector.ts
      asset-migration-participant-detector.ts
      wrap-unwrap-detector.ts
    projections/
      derive-operation-label.ts
      interpretation-read-models.ts
    persistence/
      annotation-repository.ts
    runtime/
      detector-registry.ts
      interpretation-runtime.ts
    index.ts
```

### Detector classes

Two detector styles are supported.

#### Processor-embedded detectors

Used when strong evidence is available while processing a single transaction.

Examples:

- direct bridge contract interaction
- protocol deposit into a known contract
- deterministic wrap / unwrap shape

#### Post-processing detectors

Used when interpretation depends on multiple transactions or broader context.

Examples:

- bridge counterpart heuristics across chains
- asset migration candidates
- grouped protocol flow inference

All detectors should be pure functions over explicit inputs.

## Protocol Catalog

### `ProtocolRef`

Interpretation should carry a stable protocol identifier, not a free-form
string.

```ts
type ProtocolRef = string;
```

Examples:

- `wormhole`
- `ibc`
- `lido`
- `weth`

### Catalog responsibilities

The protocol catalog owns:

- protocol identity
- known address mappings per chain
- display labels and metadata
- resolution helpers

Interpretation detectors should resolve protocol identity through the catalog
before writing annotations.

## Consumer Contract

### Downstream rule

Consumers should read annotations, not raw diagnostics, as their primary
machine interpretation contract.

Diagnostics remain visible and useful, but they should not remain the main
shared semantic seam.

### Linking

Linking reads:

- asserted bridge and migration annotations
- heuristic bridge and migration annotations where suggestion logic allows them

Pair confidence remains on suggested links, not on annotations.

### Gap analysis

Gap analysis reads:

- unpaired asserted annotations
- heuristic annotations that should become review guidance

Legacy cue strings should be replaced by interpretation-backed issue facts.

### Tax and reporting

Tax and readiness consumers primarily read asserted annotations.

Heuristic annotations may appear in readiness or review surfaces, but they
should not silently drive tax treatment.

### CLI and exports

CLI and exports may render both tiers, but they must distinguish them clearly.

Examples:

- `Bridge (asserted)`
- `Bridge (heuristic)`

## Existing Concept Migration

### `operation.category/type`

`operation` should stop being stored canonical transaction truth.

Instead:

- keep a single derived operation label mapping in
  `transaction-interpretation`
- derive it from annotations plus movement shape
- use it only as a presentation label for hosts that still need it

This keeps compatibility without preserving a second semantic source of truth.

### Diagnostics

Diagnostics stay narrow:

- processor warnings
- ambiguity
- provenance
- conservative policy inputs

Diagnostics should no longer be the main consumer-facing semantic contract for:

- bridge detection
- migration detection
- gap context
- transaction-level interpretation

### `movementRole`

`movementRole` remains unchanged.

It is still the shared machine contract for movement-local transfer semantics.
It is not replaced by annotations.

### Spam

Spam should not become a general transaction annotation family.

Direction:

- processor spam signals remain diagnostics
- `asset-review` becomes the authoritative durable spam and review plane
- balance and review consumers should eventually read asset-review state instead
  of deriving spam meaning directly from diagnostics

## Review and Overrides

The annotation row should stay machine-authored interpretation state, not human
review state.

When user-facing interpretation review is needed, add a separate review table
keyed by `annotation_fingerprint`.

That keeps:

- detector output pure
- replay deterministic
- human disagreement explicit

## Target Vocabulary

The target interpretation vocabulary should stay focused and purpose-fit, but it
must cover more than the first delivery slice.

Planned annotation kinds:

- `bridge_participant`
- `asset_migration_participant`
- `wrap`
- `unwrap`
- `protocol_deposit`
- `protocol_withdrawal`
- `airdrop_claim`

Notably excluded from v1:

- transaction-level spam annotations
- a large subtype matrix
- consumer-specific category enums

## Coverage Plan

This architecture defines the interpretation foundation. It does not by itself
deliver full semantic-product parity with protocol-aware history systems.

The first delivery slice is intentionally narrow. It proves the persisted
contract, package boundary, and detector model. Broader semantic coverage must
be planned explicitly rather than assumed to emerge automatically from the core
schema.

### Target semantic coverage

The long-term interpretation surface should make these concepts first-class
across storage, read APIs, and user-facing consumers:

- counterparties
- bridge flows
- staking products
- protocol deposits and withdrawals
- wrapper transitions
- spam state through authoritative asset-review integration

### Coverage phases

#### Phase 1. Foundation

Ship:

- persisted `TransactionAnnotation`
- `bridge_participant`
- asserted and heuristic tiers
- `protocol-catalog`
- bridge-link consumer migration

This phase establishes the durable seam. It is not intended to solve broad
semantic coverage by itself.

#### Phase 2. User-visible interpretation surfaces

Move these surfaces onto interpretation-backed read models:

- transaction detail
  - render interpretation sections rather than relying on diagnostics as the
    primary machine explanation
- transaction browse
  - filter by annotation kind and tier
- exports
  - emit interpretation-aware labels and fields
- readiness and issue reporting
  - consume interpretation instead of raw diagnostic codes where business
    meaning is involved

Goal:

- the user starts seeing protocol-aware and interpretation-aware history, not
  only normalized transfers plus diagnostics

#### Phase 3. Core semantic breadth

Add durable interpretation support for:

- wrapper transitions
  - `wrap`
  - `unwrap`
- protocol flows
  - `protocol_deposit`
  - `protocol_withdrawal`
- asset migrations
  - `asset_migration_participant`
- airdrop claims
  - `airdrop_claim`

Goal:

- the interpretation package covers the main non-transfer protocol flows that
  currently leak into diagnostics and ad hoc consumer logic

#### Phase 4. Staking product coverage

Add first-class staking interpretation beyond `movementRole`.

Coverage should include:

- staking deposits
- staking withdrawals
- staking reward context
- staking product identity through the catalog

Design rule:

- `movementRole` continues to answer transfer eligibility
- transaction interpretation adds staking-product and staking-action context

Goal:

- downstream history, review, and reporting can distinguish staking product
  behavior from generic transfers and generic rewards

#### Phase 5. Counterparty identity

Protocol identity alone is not enough for full semantic coverage.

Plan for optional counterparty identity on interpretation reads and, when the
model stabilizes, on persisted annotations.

Coverage should include:

- bridge protocols
- validators and staking operators
- protocol-owned vaults and routers
- exchange-controlled deposit and withdrawal endpoints
- issuer or distributor identities where relevant

Goal:

- consumers can show not only the action kind, but who or what the action was
  with

#### Phase 6. Spam authority and review integration

Spam state should not become a generic annotation family.

Instead:

- processor spam signals remain diagnostics
- `asset-review` becomes the authoritative durable spam and review plane
- interpretation and balance consumers stop deriving spam meaning directly from
  diagnostics where asset-review state is available

Goal:

- spam state becomes durable, reviewable, and authoritative without polluting
  the general interpretation contract

### Parity bar

The interpretation program should be considered semantically broad enough only
when all of the following are true:

- the system has first-class coverage for bridge flows, staking products,
  protocol deposits, wrapper transitions, counterparties, and spam authority
- transaction history and review surfaces render those concepts directly
- filters and exports can query or display them without raw diagnostic
  branching
- issue and readiness flows no longer need ad hoc semantic mini-languages to
  explain the same facts

## First Delivery Slice

The first delivery slice should build the durable core, not a throwaway interim
layer.

### Package work

- create `packages/transaction-interpretation`
- create `packages/protocol-catalog`
- define annotation schemas and fingerprints
- define detector registry and runtime

### Persistence work

- add `transaction_annotations` to the initial schema
- add repository and materialization support
- persist annotations during replay and reprocess

### First detector

- implement `bridge_participant`
- support both asserted and heuristic tier emission
- resolve protocol refs for a small initial bridge catalog

### First consumer migration

- update bridge linking to read annotations instead of raw bridge diagnostics

### Operation label work

- add one shared `deriveOperationLabel()` helper
- stop treating stored `operation` values as canonical semantics

### Deliberate non-goals for slice 1

Do not treat the first slice as semantic-breadth completion.

Slice 1 does not yet deliver:

- counterparty identity
- staking-product coverage
- broad protocol-flow coverage beyond the first bridge path
- authoritative spam review integration
- full history/filter/export parity across interpretation concepts

## Acceptance Criteria

- interpretation is persisted from the first implementation
- asserted and heuristic signals share one typed model
- consumers can read interpretation without branching on raw diagnostics for
  bridge semantics
- protocol identity is resolved through `protocol-catalog`
- operation labels are derived presentation, not canonical stored semantics
- the design leaves room for later review workflows without mutating annotation
  rows
- the document explicitly plans later coverage for counterparties, staking
  products, wrapper transitions, protocol flows, and spam authority

## Decisions & Smells

- The core persisted primitive is `TransactionAnnotation`, not a larger
  workflow object.
- `tier` is the right first-class certainty model; numeric confidence is not.
- Persisting a strong interpretation core from the start avoids a second schema
  redesign later.
- The main risk is letting diagnostics remain a parallel semantic contract after
  annotations land. Consumers should migrate off that pattern deliberately.

## Naming Issues

- `transaction-interpretation` is a clearer package name than
  `semantic-activities`.
- `TransactionAnnotation` is clearer than `SemanticActivity` for the persisted
  core primitive.
- `tier` is clearer than multiplying kinds into `possible_*` variants.
- `deriveOperationLabel()` is a better framing than preserving canonical
  `operation.category/type`.
