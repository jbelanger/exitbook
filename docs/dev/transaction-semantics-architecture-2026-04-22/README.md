---
last_verified: 2026-04-22
status: deferred
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
deferred_by:
  - ../accounting-ledger-rewrite-plan-2026-04-23.md
---

# Transaction Semantics Architecture

## Current Status

Implementation work from this doc set is paused while the accounting ledger
rewrite is evaluated and built. The docs are retained as design history and
input for later review, but they are no longer the active implementation plan.

Re-evaluate this doc set after
[Accounting Ledger Rewrite Plan](../accounting-ledger-rewrite-plan-2026-04-23.md)
lands far enough to settle the processor-to-accounting boundary.

This split set replaces the single long-form architecture note as the
maintained design surface for transaction semantics.

The original source document is intentionally retained at
[`docs/dev/transaction-semantics-architecture-2026-04-22.md`](../transaction-semantics-architecture-2026-04-22.md)
as a traceable source snapshot.

## Maintained Contract Docs

- [01. Core Contract](./01-core-contract.md)
- [02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md)
- [03. Runtime Ownership And Reads](./03-runtime-ownership-and-reads.md)

These three docs were the maintained transaction-semantics contract drafts
before the accounting ledger rewrite decision. Treat them as deferred drafts
until the ledger work determines which semantic surfaces still need to exist.

## Supporting Docs

- [04. Rollout And Checklist](./04-rollout-and-checklist.md) — transitional
  implementation guidance for moving the codebase to the target contract
- [05. Pass 01: Claim Vs Support / Provenance](./05-pass-01-claim-vs-support.md)
  — decision-analysis note for the first focused design pass; not yet part of
  the enduring contract
- [06. Pass 02: Kind Ownership And Registry Decentralization](./06-pass-02-kind-ownership-and-registry.md)
  — decision-analysis note for the second focused design pass; not yet part of
  the enduring contract
- [07. Pass 03: Ledger / Semantics Overlap Policy](./07-pass-03-ledger-semantics-overlap.md)
  — decision-analysis note for the third focused design pass; not yet part of
  the enduring contract
- [08. Pass 04: Evidence Model](./08-pass-04-evidence-model.md) — decision-analysis
  note for the fourth focused design pass; not yet part of the enduring
  contract
- [09. Pass 05: Review Namespace And Authority Model](./09-pass-05-review-namespace-and-authority.md)
  — decision-analysis note for the fifth focused design pass; not yet part of
  the enduring contract
- [Traceability Sheet](./traceability.md) — archived split/migration history,
  retained for review context rather than ongoing maintenance

## Status

- [01. Core Contract](./01-core-contract.md),
  [02. Semantic Facts And Evolution](./02-semantic-facts-and-evolution.md), and
  [03. Runtime Ownership And Reads](./03-runtime-ownership-and-reads.md) are
  deferred contract drafts. Do not implement them until they are re-evaluated
  against the accounting ledger rewrite.
- [04. Rollout And Checklist](./04-rollout-and-checklist.md) is intentionally
  transitional and should be rewritten or archived after the ledger rewrite
  settles.
- [05. Pass 01: Claim Vs Support / Provenance](./05-pass-01-claim-vs-support.md)
  is intentionally a decision-analysis note. It captures a recommended
  direction, not accepted contract text.
- [06. Pass 02: Kind Ownership And Registry Decentralization](./06-pass-02-kind-ownership-and-registry.md)
  is intentionally a decision-analysis note. It captures a recommended
  direction, not accepted contract text.
- [07. Pass 03: Ledger / Semantics Overlap Policy](./07-pass-03-ledger-semantics-overlap.md)
  is intentionally a decision-analysis note. It captures a recommended
  direction, not accepted contract text.
- [08. Pass 04: Evidence Model](./08-pass-04-evidence-model.md) is intentionally
  a decision-analysis note. It captures a recommended direction, not accepted
  contract text.
- [09. Pass 05: Review Namespace And Authority Model](./09-pass-05-review-namespace-and-authority.md)
  is intentionally a decision-analysis note. It captures a recommended
  direction, not accepted contract text.
- [traceability.md](./traceability.md) is intentionally archival. It documents
  how the split started, not a live maintenance obligation for every future edit.
- The source note at
  `../transaction-semantics-architecture-2026-04-22.md` is `status: superseded`
  and retained only as a traceable snapshot; do not edit it.
