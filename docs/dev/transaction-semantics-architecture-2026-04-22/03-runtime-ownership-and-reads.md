---
last_verified: 2026-04-22
status: active
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
---

# Runtime Ownership And Reads

## Processor Authoring

Processors author semantic facts directly whenever they already know them.

A processor returns one `ProcessorOutput` containing:

- transaction draft(s)
- movement draft(s)
- fee draft(s)
- semantic fact draft(s)
- diagnostic draft(s)

Rules:

- processors return data; they do not import stores
- semantic-fact targets are fingerprint-based before persistence
- diagnostics are uncertainty only
- if the processor knew the fact, no detector layer re-projects it later

## Cross-Transaction Post-Processing

Post-processing exists only for semantic work that requires persisted broader
scope, such as grouped bridge pairing or grouped asset migration.

Rules:

- it runs after persistence over persisted state only
- it may use ingestion-owned source-aware readers for deterministic correlation
- it emits semantic facts only
- it never emits diagnostics
- it must not re-emit a fact the processor could already author directly

## Reconciler Workflows

Reconciler workflows author semantic facts from already-persisted state in order
to preserve a durable invariant.

V1 reconciler behavior:

- `staking_reward` overlap repair after ledger override persist/clear
- rerun after transaction reprocess or override replay/materialization when
  effective ledger state is rematerialized

Rules:

- reconciler facts are system-authored semantic facts, not review decisions
- reconciler facts are narrow and invariant-driven, not a generic second
  post-processing engine
- reconciler-owned facts use `group_key: null`

### `staking_reward` overlap workflow

The reconciler reconciles against the transaction's effective persisted
`accounting_role` state after override materialization, not against the raw
override event log.

For this workflow, an **equivalent** fact is any movement-scoped
`staking_reward` fact targeting the same `movement_fingerprint`. Equivalence
is about satisfying the overlap invariant for that movement — it is not about
matching `emitter_id`, `emitter_lane`, or `evidence`.

Upgrade path (override sets a movement to effective `staking_reward`), in
one database transaction:

1. persist (or clear) the ledger override
2. run the reconciler for the affected transaction
3. the reconciler may author a movement-scoped `staking_reward` fact only
   when no equivalent fact already exists for that movement
4. synced facts use the minimal v1 `staking_reward` payload: canonical empty
   metadata `{}`, no `role`, no `protocol_ref`, no `counterparty_ref`

Downgrade path (move a movement **away** from effective `staking_reward`) is
**not** a bare ledger override write. It must run in one database transaction:

1. append `dismiss` review decisions for every movement-scoped
   `staking_reward` fact targeting that `movement_fingerprint`
2. persist or clear the ledger override to the new effective `accounting_role`
3. delete only `ledger_override_sync`-owned rows for that movement

The downgrade workflow never hard-deletes processor-authored `staking_reward`
facts. They remain persisted audit history and are suppressed from canonical
semantic reads by the effective review state (`dismiss`).

Clear path: when the ledger override is cleared, the reconciler deletes only
`ledger_override_sync`-owned rows for that movement and leaves any
processor-authored same-movement `staking_reward` fact in place.

## Evaluated Scope And Replacement

Every post-processor run has an explicit `evaluated_tx_fingerprints` set.

Within that execution scope, persistence is reconcile-not-append:

- persisted rows authored by that emitter whose support sets are fully contained
  in the evaluated set must equal exactly the newly emitted rows for the same
  evaluated set after commit

That contract allows regrouping from `{A,B}` to `{A,C}` without leaving stale
semantic rows behind.

## Invalidation On Reprocess

When a transaction is reprocessed:

- all `processor`-lane facts for that `tx_fingerprint` are deleted and replaced
- all `post_processor`-lane facts whose support sets include that
  `tx_fingerprint` are deleted in the same transaction
- `reconciler` facts for the affected transaction set are regenerated from the
  resulting effective ledger state before canonical reads rely on them

Canonical readers must never observe stale grouped or reconciler facts after a
committed reprocess.

V1 may satisfy post-processor freshness conservatively by rerunning all
registered post-processors for the profile.

## Read Paths

Consumers read one channel per question.

Unless a surface is explicitly audit/debug-oriented, semantic reads operate on
effective semantic facts:

- evidence-filtered explicitly
- fact-decision-filtered explicitly
- with kind-specific supersession rules applied

### Canonical read map

- Cost basis / accounting:
  - `movements.accounting_role`
  - effective semantic facts with `asserted` evidence
  - effective participation state
- Tax / readiness:
  - effective semantic facts with `asserted` evidence
  - diagnostics only for uncertainty surfaces
  - effective participation where relevant
- Linking:
  - effective bridge / asset-migration facts
  - `transaction_links`
  - effective participation state
- Portfolio / balance:
  - movements
  - effective semantic facts with `asserted` evidence
  - effective review / participation state
- History / filters / audit:
  - facts of either evidence value
  - optionally dismissed or superseded rows
  - diagnostics for uncertainty

No consumer reads diagnostics for semantic meaning.

## Labels

### Ledger shape labels

`deriveLedgerShapeLabel()` is the display projection of ledger shape.

Canonical vocabulary:

- `send`
- `receive`
- `self_transfer`
- `trade`
- `fee`

### Operation labels

`deriveOperationLabel()` is the transaction-facing label helper.

It composes:

1. ledger-shape fallback
2. semantic upgrade when a richer fact exists

It returns:

- `group: 'other' | 'staking' | 'trade' | 'transfer'`
- `label: string`
- `source: 'semantic_fact' | 'ledger_shape'`

V1 semantic upgrade vocabulary:

- `bridge/send`
- `bridge/receive`
- `asset migration/send`
- `asset migration/receive`
- `swap`
- `wrap`
- `unwrap`
- `staking/reward`
- `staking/deposit`
- `staking/withdrawal`
- `protocol/deposit`
- `protocol/withdrawal`
- `airdrop/claim`

Rules:

- callers must pass explicit evidence policy
- the helper does not query stores or apply hidden filtering
- dismissed or superseded facts must not be resurrected
- negative-signal facts do not replace the primary operation label
- policy code must branch on typed projections, not on rendered label strings

Presentation layers may map this canonical vocabulary to localized or
product-specific text later. That remapping must not become a policy input.

### Primary-label precedence

V1 precedence:

1. `staking_reward`
2. `swap`
3. `wrap` / `unwrap`
4. `bridge`
5. `asset_migration`
6. `staking_deposit` / `staking_withdrawal`
7. `protocol_deposit` / `protocol_withdrawal`
8. `airdrop_claim`
9. ledger-shape fallback

Keep precedence declarative and kind-owned through the kind-definition
registry.

## Capability Ownership And Port Boundaries

These ownership statements are binding. Final package extraction is not.
Package boundaries, dependency direction, and adapter placement must follow
[`docs/architecture/architecture-package-contract.md`](../../architecture/architecture-package-contract.md).

The capabilities in this design may land as dedicated packages, capability
subpaths inside existing feature packages, or workflow packages. Whatever
shape is chosen, consumers own app-internal ports and `data` implements them.

- Ledger capability owns transactions, movements with `accounting_role`, fees,
  links, and ledger-shape projection.
- Transaction semantics capability owns fact types, kind definitions and
  registry, schemas, fingerprinting, semantic read policies, protocol /
  counterparty refs, and operation-label projection.
- Review capability owns decision writes, rule evaluation, effective review
  state, and effective participation state.
- Ingestion capability owns processors, `ProcessorOutput`, diagnostics,
  post-processing runtime, and reconciler workflows.
- Accounting capability owns gap analysis, readiness, transfer policy,
  residual attribution, cost basis, and portfolio behavior.

Consumer-owned ports should be explicit rather than implied by package names.
Examples:

- accounting owns the app-internal ports it needs for ledger reads, effective
  semantic facts, and effective participation state
- history / audit surfaces own broader semantic-fact read ports when they need
  dismissed, superseded, or inferred rows
- ingestion owns the persistence ports it needs for writing semantic facts,
  diagnostics, and reconciler-side coordinated changes
- hosts compose these capabilities, but do not absorb business-policy
  orchestration that belongs in a workflow package

## Illustrative Package Sketch

This sketch is non-binding. It shows one possible extraction if the repo later
chooses dedicated packages for these capabilities. The final shape must still
follow [`docs/architecture/architecture-package-contract.md`](../../architecture/architecture-package-contract.md),
including consumer-owned ports and no direct feature-to-feature imports.

```text
packages/
  ledger/
    src/
      transactions/
      movements/
      fees/
      links/
      labels/
        derive-ledger-shape-label.ts
      index.ts

  transaction-semantics/
    src/
      facts/
        semantic-fact-types.ts
        semantic-fact-schemas.ts
        semantic-fact-fingerprint.ts
        semantic-fact-read-model.ts
        semantic-fact-ports.ts
      kinds/
        bridge.ts
        swap.ts
        wrap.ts
        staking.ts
        protocol-flow.ts
        airdrop.ts
        asset-migration.ts
        negative-signals.ts
        registry.ts
      protocol/
        protocol-ref.ts
        protocol-resolver.ts
        seed/
      counterparty/
        counterparty-ref.ts
        counterparty-resolver.ts
      labels/
        derive-operation-label.ts
      index.ts

  review/
    src/
      decisions/
        review-decision-types.ts
        review-decision-ports.ts
      rules/
        review-rule-registry.ts
        review-rule-runner.ts
        spam-inbound-rule.ts
      effective-state/
        effective-review-state.ts
        effective-participation-state.ts
      authority/
      index.ts

  ingestion/
    src/
      semantic-authoring/
        processor-output.ts
        reconciler/
          staking-reward-reconciler.ts
        post-processing/
          post-processing-runtime.ts
          post-processor-registry.ts
          source-reader.ts
          post-processors/
            heuristic-bridge-pair.ts
            asset-migration-grouper.ts
      diagnostics/
        diagnostic-types.ts
        diagnostic-codes.ts
        diagnostic-schemas.ts
      ...

  accounting/
    src/
      gaps/
      readiness/
      transfer-policy/
      residual-attribution/
      cost-basis/
      portfolio/
      ...
```
