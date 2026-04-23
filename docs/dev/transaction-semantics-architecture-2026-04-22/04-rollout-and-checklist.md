---
last_verified: 2026-04-22
status: active
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
---

# Rollout And Checklist

## What Carries Forward

- replace-by-fingerprint invalidation discipline
- replace-by-derived-from-inputs reconciliation discipline
- deterministic replay for post-processing
- explicit evidence selection at the query API
- cross-transaction heuristic bridge pairing
- existing movement-role override event-store and replay contract

## What Does Not Carry Forward

- diagnostic-to-annotation reprojection detectors
- free-form semantic metadata blobs
- consumer-owned helpers living inside the semantics package
- standalone `protocol-catalog` package
- stored `transaction.operation` as canonical meaning

## Guardrails

- do not add new diagnostic-mirror detectors
- do not reintroduce stored `transaction.operation`
- do not let `transaction-semantics` absorb accounting or CLI policy helpers
- if a processor can say what happened, it should emit a fact directly
- ingestion post-processing emits facts only, never diagnostics
- processors never emit decisions
- review authorities never emit observations
- keep the diagnostic enum small and closed

## Naming Changes

- `TransactionAnnotation` -> `SemanticFact`
- `tier` -> `evidence`
- `movementRole` -> `accounting_role`
- `detectorId` -> `emitter_id`
- `transaction-interpretation` -> `transaction-semantics`
- `protocol-catalog` -> folded into `transaction-semantics/protocol/`

## Immediate Direction

Near-term implementation should:

- stop adding new diagnostic-to-fact reprojection paths
- move consumer-side helpers out of `packages/transaction-interpretation`
- convert asserted single-transaction semantics to processor-authored facts
- preserve replay and invalidation guarantees for persisted semantic state
- keep heuristic bridge pairing only in ingestion-owned post-processing
- move semantic post-processing runtime ownership under ingestion while keeping
  fact contracts in `transaction-semantics`

## Deferred / Non-Goals

- counterparty resolver implementation details
- large populated protocol seeds beyond a small initial seed
- background scheduling sophistication for post-processors
- first-class review UI
- migration of every existing consumer in one slice
- deeper staking taxonomy than v1 kinds
- fee-scoped semantic facts in v1

## Acceptance Checklist

V1 is acceptable when all of the following are true:

- single-transaction semantic concerns are added through `ProcessorOutput`
  semantic facts, not through new diagnostic codes
- the diagnostic enum is uncertainty-only
- `transaction.operation` is gone from canonical storage
- `movements.movement_role` is replaced by `accounting_role`
- transaction and asset participation are review-owned effective state
- any participation projection is transactionally fresh
- semantic-fact identity uses one shared canonicalization recipe plus
  per-kind `kind_version`
- query APIs force explicit evidence and fact-decision policy
- duplicate authorship fails the enclosing transaction
- review uses one effective-state collapse model with user-over-rule
  precedence
- movement-level review remains intentionally non-canonical in v1
- fact truth decisions and participation decisions are written separately
  and explicitly
- the `staking_reward` overlap invariant is preserved through the reconciler
  workflow
- `deriveLedgerShape()` is the structural helper and policy code does not
  branch on rendered labels
- `deriveOperationLabel()` stays a projection over already-effective facts
- bridge and asset migration both use the grouped correlated-kind contract
- post-processor reruns reconcile explicit evaluated scope and delete stale
  prior outputs
- ingestion post-processing emits facts only
- review owns rule logic and decision writes

## Watch Items

These are not blockers, but they should be watched during implementation:

- negative observations drifting back into diagnostics
- post-processing regressing into diagnostic reprojection
- operation-label projection becoming a coupling hotspot as kinds grow
- empty-schema kinds drifting between omitted metadata and `{}` during cutover
- fee semantics putting pressure on the v1 no-fee-scope boundary
