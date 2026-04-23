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
as a traceable source snapshot.

## Maintained Contract Docs

- [01. Core Contract](./01-core-contract.md)
- [02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md)
- [03. Runtime Ownership And Reads](./03-runtime-ownership-and-reads.md)

These three docs are the enduring architecture contract for transaction
semantics.

## Supporting Docs

- [04. Rollout And Checklist](./04-rollout-and-checklist.md) — transitional
  implementation guidance for moving the codebase to the target contract
- [Traceability Sheet](./traceability.md) — archived split/migration history,
  retained for review context rather than ongoing maintenance

## Status

- [01. Core Contract](./01-core-contract.md),
  [02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md), and
  [03. Runtime Ownership And Reads](./03-runtime-ownership-and-reads.md) are
  the maintained contract surfaces.
- [04. Rollout And Checklist](./04-rollout-and-checklist.md) is intentionally
  transitional and may be archived after implementation converges.
- [traceability.md](./traceability.md) is intentionally archival. It documents
  how the split started, not a live maintenance obligation for every future edit.
- The source note at
  `../transaction-semantics-architecture-2026-04-22.md` is `status: superseded`
  and retained only as a traceable snapshot; do not edit it.
