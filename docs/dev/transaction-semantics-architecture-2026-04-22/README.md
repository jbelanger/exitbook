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

## Design Closures Added During The Split

These are the main architecture closures that were implicit or under-specified
in the source note and are now explicit in the split docs:

- Semantic kinds are owned through a typed kind-definition contract and central
  registry, not by ad hoc edits across multiple unrelated modules.
- `kind` remains a small global semantic family key. Chain-specific detail
  belongs in typed per-kind metadata or future typed refs, not in ad hoc
  namespacing conventions.
- Semantic fact identity now has both an envelope version
  (`semantic_fact:v1`) and a per-kind `kind_version` for identity-bearing
  payload evolution.
- `ledger_override_sync` is treated as reconciler-owned semantic authoring, not
  as ordinary processor or post-processor behavior.
- Effective participation freshness is now a contract: canonical reads may not
  observe stale participation state after a committed write.
- Fee semantics stay ledger-owned in v1, but future `fee`-scoped semantic facts
  are now explicitly reserved rather than implicitly forbidden.
