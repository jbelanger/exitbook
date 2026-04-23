---
last_verified: 2026-04-22
status: active
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
---

# Transaction Semantics Architecture

This split set replaces the single long-form architecture note as the
maintained design surface for transaction semantics.

The original source document is intentionally retained at
[`docs/dev/transaction-semantics-architecture-2026-04-22.md`](../transaction-semantics-architecture-2026-04-22.md)
as a traceable source snapshot. The docs below are the maintained contract
surfaces.

## Documents

- [01. Core Contract](./01-core-contract.md)
- [02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md)
- [03. Runtime Ownership And Reads](./03-runtime-ownership-and-reads.md)
- [04. Rollout And Checklist](./04-rollout-and-checklist.md)
- [Traceability Sheet](./traceability.md)

## New Decisions Introduced By The Split

These are deliberate architecture decisions introduced during the split rather
than direct carry-forward from the source note. Their accepted/open/revert
status is tracked in [Traceability Sheet](./traceability.md).

- Semantic kinds are owned through a typed kind-definition contract and central
  registry, not by ad hoc edits across multiple unrelated modules.
- Semantic fact identity now has both an envelope version
  (`semantic_fact:v1`) and a per-kind `kind_version` for identity-bearing
  payload evolution.
- `ledger_override_sync` is treated as reconciler-owned semantic authoring, not
  as ordinary processor or post-processor behavior.
- `bridge` and `asset_migration` share one grouped correlated-kind contract
  rather than two separate special cases.
- Fee semantics stay ledger-owned in v1, but future `fee`-scoped semantic facts
  are explicitly reserved.
- Movement scope remains `staking_reward`-only in shipped v1 kinds, but future
  movement-scoped kinds are allowed through the kind-definition contract with
  explicit invariant/read-path review.

## Maintaining This Set

The split docs (01–04) are the authoritative contract surfaces. The source
note at `../transaction-semantics-architecture-2026-04-22.md` is `status:
superseded` and retained only as a traceable snapshot; do not edit it.

[`traceability.md`](./traceability.md) records how source sections and the
review-day findings map into the split and records the status of any
split-introduced decisions. Edits to 01–04 that drop, move, or substantially
change a row in that sheet must update the sheet in the same commit. Once the
ecosystem relies only on the split docs, the traceability sheet may be frozen
(`status: archived`) rather than kept live.
