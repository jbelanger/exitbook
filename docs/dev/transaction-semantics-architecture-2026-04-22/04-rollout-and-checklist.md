---
last_verified: 2026-04-22
status: deferred
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
deferred_by:
  - ../accounting-ledger-rewrite-plan-2026-04-23.md
---

# Rollout And Checklist

Implementation from this checklist is deferred pending the accounting ledger
rewrite. Re-evaluate this document after the processor-to-accounting boundary
lands.

This document is transitional implementation guidance for moving the codebase
to the target architecture. Unlike 01–03, it is not part of the enduring
runtime contract and may be archived after rollout converges.

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
- package-placement assumptions that bypass the repo architecture contract
- stored `transaction.operation` as canonical meaning

## Guardrails

- do not add new diagnostic-mirror detectors
- do not reintroduce stored `transaction.operation`
- do not let `transaction-semantics` absorb accounting or CLI policy helpers
- if a processor can say what happened, it should emit a fact directly
- ingestion post-processing emits facts only, never diagnostics
- processors never emit decisions
- review authorities never emit observations
- do not treat capability ownership as an automatic package move; package
  boundaries stay subject to
  [`docs/architecture/architecture-package-contract.md`](../../architecture/architecture-package-contract.md)
- keep the diagnostic enum small and closed

## Naming Changes

- `TransactionAnnotation` -> `SemanticFact`
- `tier` -> `evidence`
- `movementRole` -> `accounting_role`
- `detectorId` -> `emitter_id`
- `transaction-interpretation` -> `transaction-semantics`

## Immediate Direction

Near-term implementation should:

- stop adding new diagnostic-to-fact reprojection paths
- move consumer-side helpers out of `packages/transaction-interpretation`
- convert asserted single-transaction semantics to processor-authored facts
- preserve replay and invalidation guarantees for persisted semantic state
- keep heuristic bridge pairing only in ingestion-owned post-processing
- define consumer-owned ports for semantic, review, and ledger reads before
  locking any package moves
- move semantic post-processing runtime ownership under ingestion while keeping
  fact contracts in `transaction-semantics`
- treat any `protocol-catalog` relocation as a separate package-boundary review,
  not as an automatic carry-forward from the source note

## Incremental Rollout

Duplicate-authorship steady state is defined in the semantic-fact contract
([02 Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md)): at
most one `(emitter_lane, emitter_id)` owns any given `fact_fingerprint`.
Migration must preserve that invariant, not relax it:

- cutovers use feature gating or staged emission so exactly one author owns a
  given fact tuple at any moment
- do not leave legacy detector-style emission and new processor /
  post-processor emission active for the same fact tuple in one run
- `kind_version` bumps ship with an explicit migration note (data path + a
  statement about whether any persisted facts must be re-emitted)

If a cutover cannot be made single-author in one slice, gate the new emitter
off by default until the old path is removed in the same merge.

## Deferred / Non-Goals

- counterparty resolver implementation details
- large populated protocol seeds beyond a small initial seed
- background scheduling sophistication for post-processors
- first-class review UI
- migration of every existing consumer in one slice
- deeper staking taxonomy than v1 kinds
- fee-scoped semantic facts in v1

## Legacy Diagnostic Migration Map

| Current signal                          | V1 home                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `bridge_transfer`                       | `bridge` fact                                                                                      |
| `possible_asset_migration`              | `asset_migration` fact when correlation is proven; otherwise `classification_uncertain`            |
| `SCAM_TOKEN`, `SUSPICIOUS_AIRDROP`      | `spam_inbound` fact plus review-rule seeding                                                       |
| `unsolicited_dust_fanout`               | `dust_fanout` fact                                                                                 |
| `proxy_operation`                       | concrete semantic fact when known, plus `proxy_target_unresolved` if unresolved                    |
| `multisig_operation`                    | concrete semantic fact when known, plus `multisig_participants_unresolved` if unresolved           |
| `batch_operation`                       | concrete semantic fact when known, plus `batched_context_missing` when grouping context is missing |
| `exchange_deposit_address_credit`       | `counterparty_ref.kind='exchange_endpoint'` when resolved; otherwise `counterparty_unresolved`     |
| `off_platform_cash_movement`            | `off_platform_settlement_unresolved`                                                               |
| `classification_failed`                 | collapse into `classification_uncertain`                                                           |
| `contract_interaction`                  | no standalone v1 signal; emit a concrete fact if known, otherwise `classification_uncertain`       |
| `unattributed_staking_reward_component` | `allocation_uncertain` until exact movement-scoped `staking_reward` attribution is provable        |

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
- review uses one effective-state collapse model with manual-over-rule
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
