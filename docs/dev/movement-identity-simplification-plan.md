---
status: implemented
last_updated: 2026-03-18
---

# Movement Identity Simplification Plan

## Summary

This plan removes `transaction_movements.position` and stops using ordinal position as movement identity.

Movement identity becomes:

- `txFingerprint`
- canonical semantic movement content within that transaction
- duplicate occurrence within the exact same canonical movement-content bucket

This is a clean-slate refactor:

- no legacy compatibility path
- no mixed old/new fingerprint support
- no migration of old links or overrides
- update `001_initial_schema.ts` directly
- reset local data and rebuild from scratch

## Implementation Status

Implemented on the current dev line.

Landed:

- `computeMovementFingerprint()` now hashes canonical movement material plus `duplicateOccurrence`
- `transaction_movements.position` and its uniqueness constraint were removed
- repository writes and reads now canonicalize movement identity/order from movement content
- `LinkableMovement.position` was removed
- scoped accounting no longer carries `rawPosition`

Still required outside code changes:

- reset local `transactions.db`
- reset local `overrides.db`
- re-import and relink from scratch

## Relationship To Existing Docs

This document supersedes the movement-identity assumptions in:

- `docs/dev/persisted-fingerprints-plan.md`
- the movement-specific sections of `docs/dev/transaction-identity-simplification-plan.md`

Those documents assume:

- `movementFingerprint = movement:${txFingerprint}:${movementType}:${position}`
- `transaction_movements.position` remains in the schema

This plan deletes that model.

## Why This Plan Exists

Today movement identity is still position-based:

- `computeMovementFingerprint()` takes `position`
- the repository assigns per-type movement ordinals during write
- `transaction_movements.position` persists flattened row order
- read paths sort by persisted row order before rebuilding movement arrays

That creates several problems:

- movement identity depends on processor-emitted array order
- the same semantic movement set can get different fingerprints if provider or processor ordering changes
- the schema still exposes `position` as if it were business identity
- linking and override replay treat `movementFingerprint` as exact durable identity even though it still depends on ordinal slots
- cost-basis specs still talk about preserving raw movement slot order when the actual identity contract is already more indirect than that

The goal of this plan is not to solve provider split-vs-merge disagreement. That problem remains upstream. The goal is to stop treating generic array order as movement identity when the rows are semantically distinguishable by their own data.

## Reset Assumption

Use the strict dev-mode assumption:

- delete and rebuild local `transactions.db`
- delete and rebuild local `overrides.db`
- re-import source data
- re-run linking

No compatibility work is required for:

- old `movement_fingerprint` values in `transaction_movements`
- old `source_movement_fingerprint` / `target_movement_fingerprint` values in `transaction_links`
- old link overrides stored in `overrides.db`

Note:

- transaction-note overrides are keyed by `txFingerprint`, not `movementFingerprint`
- they could theoretically survive
- for this refactor, do not carry partial override compatibility; reset the override store with everything else

## Decision

Use canonical movement content plus duplicate occurrence.

Specifically:

- remove `transaction_movements.position`
- remove `(transaction_id, position)` uniqueness
- remove `position` from `computeMovementFingerprint()`
- compute movement identity from semantic movement content, not ordinal slot
- treat exact same-key duplicates as interchangeable
- assign a 1-based duplicate occurrence within each exact canonical-key bucket
- persist only `movement_fingerprint`; do not add a second compatibility fingerprint column
- canonicalize read order from movement content, not persisted insertion order

## Canonical Movement Contract

### 1. Canonical Asset Movement Key

For asset movements:

- include `movementType`
- include `assetId`
- include `grossAmount.toFixed()`
- include effective net amount:
  - `movement.netAmount?.toFixed()`
  - or `movement.grossAmount.toFixed()` when `netAmount` is absent

Canonical material:

```ts
`${movementType}|${assetId}|${grossAmount.toFixed()}|${effectiveNetAmount.toFixed()}`;
```

Do not include:

- `assetSymbol`
- `priceAtTxTime`
- notes
- source/provider metadata

### 2. Canonical Fee Movement Key

For fee movements:

- fixed kind prefix `fee`
- `assetId`
- `amount.toFixed()`
- `scope`
- `settlement`

Canonical material:

```ts
`fee|${assetId}|${amount.toFixed()}|${scope}|${settlement}`;
```

Do not include:

- `assetSymbol`
- `priceAtTxTime`

### 3. Duplicate Occurrence

If multiple movements in the same transaction share the exact same canonical material:

- they are treated as semantically interchangeable duplicates
- assign `duplicateOccurrence` as `1..n` within that bucket

Important constraint:

- the duplicate occurrence is only a bucket-local slot label
- it is not a separate business concept
- if two exact duplicates swap order, we accept that as semantically equivalent

### 4. Fingerprint Shape

Use a hashed canonical movement key plus duplicate occurrence.

Suggested shape:

```ts
movementContentHash = sha256Hex(canonicalMaterial);
movementFingerprint = `movement:${txFingerprint}:${movementContentHash}:${duplicateOccurrence}`;
```

Implication:

- `computeMovementFingerprint()` stays synchronous, like `computeTxFingerprint()`

### 5. Canonical Ordering

After `position` is removed, movement arrays must still materialize in a deterministic order.

Within each logical movement array (`inflows`, `outflows`, `fees`), sort by:

1. canonical movement material ascending
2. `duplicateOccurrence` ascending

This means:

- processor insertion order is no longer preserved as a contract
- read order becomes canonical semantic order
- exact duplicates are stable only up to interchangeable bucket-local occurrence

## Accepted Limitation

This refactor does **not** solve provider disagreement on movement decomposition.

Examples that remain unsolved:

- provider A emits two exact same-asset same-amount outflows, provider B emits one merged outflow
- provider A exposes a token leg that provider B omits
- provider A exposes `traceId` / `logIndex` and provider B does not

No fingerprint scheme can make those decompositions line up if the processed movement sets are genuinely different.

This plan only improves identity for the case where:

- the processed movement set is semantically the same
- but ordering is different or unnecessarily positional

## Implementation Plan

## 1. Core Identity Helpers

Files:

- `packages/core/src/identity/fingerprints.ts`
- `packages/core/src/identity/__tests__/fingerprints.test.ts`

Changes:

- replace `MovementFingerprintInput.position` with:
  - `canonicalMaterial`
  - `duplicateOccurrence`
- keep `computeMovementFingerprint()` synchronous
- add validation:
  - `txFingerprint` must not be empty
  - `canonicalMaterial` must not be empty
  - `duplicateOccurrence` must be a positive integer
- keep the `movement:` prefix

Pseudo-shape:

```ts
export interface MovementFingerprintInput {
  txFingerprint: string;
  canonicalMaterial: string;
  duplicateOccurrence: number;
}

export function computeMovementFingerprint(input: MovementFingerprintInput): Result<string, Error> {
  const contentHash = sha256Hex(input.canonicalMaterial);
  return ok(`movement:${input.txFingerprint}:${contentHash}:${input.duplicateOccurrence}`);
}
```

Also add pure helpers in this file for canonical movement material:

- `buildAssetMovementCanonicalMaterial()`
- `buildFeeMovementCanonicalMaterial()`

Those helpers should accept both draft and persisted movement shapes where practical.

## 2. Schema Changes

Files:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`

Changes:

- remove `position` from `TransactionMovementsTable`
- remove the `position` column from the initial migration
- remove the unique index on `(transaction_id, position)`
- keep the unique index on `movement_fingerprint`

Do not:

- add an incremental migration
- add a compatibility column
- add a temporary `row_order` replacement in this slice

Clean-slate rule:

- change `001_initial_schema.ts` directly
- rebuild from scratch

## 3. Repository Write Path

File:

- `packages/data/src/repositories/transaction-repository.ts`

Functions to update:

- `buildMovementRows`
- `assetMovementToRow`
- `feeMovementToRow`
- `TransactionRepository/create`
- `TransactionRepository/createBatch`
- `TransactionRepository/updateMovementsWithPrices`

Concrete changes:

- remove `position` from movement-row insert values
- keep `buildMovementRows()` synchronous
- compute canonical material for each movement before insert
- assign duplicate occurrence within exact canonical-material buckets
- compute the persisted `movement_fingerprint` from:
  - `txFingerprint`
  - canonical material
  - duplicate occurrence

Pseudo-flow:

```ts
const duplicateCounts = new Map<string, number>();

for each inflow in transaction.movements.inflows:
  canonicalMaterial = buildAssetMovementCanonicalMaterial('inflow', inflow)
  bucketKey = canonicalMaterial
  occurrence = (duplicateCounts.get(bucketKey) ?? 0) + 1
  duplicateCounts.set(bucketKey, occurrence)
  movementFingerprint = computeMovementFingerprint({
    txFingerprint,
    canonicalMaterial,
    duplicateOccurrence: occurrence,
  })
  insert inflow row without position

for each outflow in transaction.movements.outflows:
  // same pattern

for each fee in transaction.fees:
  canonicalMaterial = buildFeeMovementCanonicalMaterial(fee)
  // same pattern
```

Important detail:

- use encounter order only for assigning occurrence within exact duplicate buckets
- that is acceptable because exact same-key duplicates are defined as interchangeable

## 4. Repository Read Path

File:

- `packages/data/src/repositories/transaction-repository.ts`

Functions and call sites to update:

- movement-row query paths that currently do `.orderBy('position', 'asc')`
- `TransactionRepository/toTransaction`
- any helper that assumes DB row order is the movement-array order

Plan:

- stop ordering movement rows by a deleted DB column
- load rows without positional semantics
- sort rows in memory into canonical order before rebuilding arrays

Suggested helper:

```ts
function sortMovementRowsCanonical(rows: MovementRow[]): MovementRow[] {
  // partition by movement_type
  // recompute canonical material from row content
  // parse duplicateOccurrence from movement_fingerprint
  // sort by (canonicalMaterial, duplicateOccurrence)
}
```

Materialization rule:

- `inflows`, `outflows`, and `fees` remain separate arrays
- each array uses canonical semantic ordering, not historical insertion order

## 5. Linking

Files:

- `packages/accounting/src/linking/matching/linkable-movement.ts`
- `packages/accounting/src/linking/pre-linking/build-linkable-movements.ts`
- `packages/accounting/src/linking/pre-linking/build-linkable-movements.test.ts`

Changes:

- remove `position` from `LinkableMovement`
- stop carrying positional metadata through pre-linking
- keep `movementFingerprint` as the exact identity used by matching and override replay

Expected outcome:

- linking keeps using exact `movementFingerprint`
- the identity is no longer coupled to position-based assumptions

## 6. Scoped Cost-Basis Identity Cleanup

Files to review:

- `packages/accounting/src/cost-basis/standard/matching/build-cost-basis-scoped-transactions.ts`
- `docs/specs/cost-basis-accounting-scope.md`

Current issue:

- scoped movement shapes still carry `rawPosition`
- that name was justified by the old positional identity model

Decision for this slice:

- if `rawPosition` is only observational/debug metadata, remove it
- if it is still needed for deterministic scoped ordering, rename it to `canonicalOrder`

Do not keep the name `rawPosition` if it no longer refers to a persisted raw slot.

## 7. Tests And Helpers

Core tests:

- `packages/core/src/identity/__tests__/fingerprints.test.ts`
- `packages/core/src/transaction/__tests__/transaction.test.ts`

Repository tests:

- `packages/data/src/repositories/__tests__/transaction-repository.test.ts`
- `packages/data/src/repositories/__tests__/helpers.ts`

Linking tests/helpers:

- `packages/accounting/src/linking/pre-linking/build-linkable-movements.test.ts`
- `packages/accounting/src/linking/shared/test-utils.ts`
- `packages/accounting/src/linking/orchestration/override-replay.test.ts`
- `packages/accounting/src/linking/orchestration/linking-orchestrator.test.ts`
- `packages/accounting/src/linking/strategies/test-utils.ts`

Cost-basis tests/helpers:

- `packages/accounting/src/cost-basis/standard/matching/__tests__/lot-matcher.test.ts`
- `packages/accounting/src/cost-basis/standard/matching/__tests__/lot-matcher-transfers.test.ts`
- `packages/accounting/src/cost-basis/standard/matching/__tests__/build-cost-basis-scoped-transactions.test.ts`
- `packages/accounting/src/__tests__/test-utils.ts`
- `packages/accounting/src/cost-basis/jurisdictions/canada/__tests__/test-utils.ts`
- `packages/accounting/src/cost-basis/jurisdictions/canada/tax/__tests__/canada-tax-event-builders.test.ts`

CLI/app test helpers:

- `apps/cli/src/features/shared/__tests__/transaction-test-utils.ts`
- `apps/cli/src/features/links/__tests__/test-utils.ts`

Specific test cleanup:

- remove assertions that expect `movementFingerprint` to end with `:inflow:0`, `:outflow:1`, etc.
- remove test logic that parses movement position from fingerprint suffixes
- replace those assertions with:
  - equality against helper-generated canonical fingerprints
  - or semantic assertions about duplicate-bucket behavior

## 8. Docs

Files to update after implementation:

- `docs/specs/transaction-linking.md`
- `docs/specs/cost-basis-accounting-scope.md`
- `docs/dev/transaction-identity-simplification-plan.md`
- `docs/dev/persisted-fingerprints-plan.md`

Documentation changes:

- remove language that says movement identity is position-based
- remove examples like `movement:${txFingerprint}:outflow:0`
- explain duplicate-bucket semantics explicitly
- explain the clean-slate reset assumption for links/overrides

## 9. Reset Procedure

Because this refactor changes persisted movement identity:

- delete local `transactions.db`
- delete local `overrides.db`
- re-import raw data
- rerun linking suggestions
- discard all persisted link overrides from the old identity model

Suggested command-level workflow for verification after landing:

1. remove the local transactional DB and override store
2. run fresh imports
3. run `pnpm run dev reprocess`
4. run link generation / review flows
5. verify cost-basis pipelines against the rebuilt dataset

## Step Order

Implement in this order:

1. add the new movement canonical-material helpers and synchronous fingerprint contract in core
2. remove `transaction_movements.position` from schema and initial migration
3. update repository write paths to assign duplicate occurrence and persist the new fingerprint
4. update repository read paths to canonical in-memory ordering
5. remove `position` from linking models
6. remove or rename scoped `rawPosition`
7. update tests and helper factories
8. update specs and dev docs
9. reset local data and verify with fresh imports

## Non-Goals

Do not do these in the same change:

- build a provider-provenance movement identity system
- solve provider split-vs-merge disagreements
- preserve old link overrides
- preserve old `transaction_links` movement endpoints
- add dual-read or dual-write compatibility logic
- redesign `txFingerprint`

## Expected End State

After this lands:

- no persisted `transaction_movements.position`
- no position-based `movementFingerprint`
- no `LinkableMovement.position`
- canonical movement identity based on semantic content plus duplicate occurrence
- exact duplicate movements treated as interchangeable bucket-local slots
- read order defined by canonical semantic ordering, not storage order
- all links and link overrides rebuilt from scratch against the new movement identity

## Decisions & Smells

- Decision: delete `position` instead of renaming it to `row_order`.
- Decision: use clean-slate reset semantics; no compatibility code.
- Decision: exact same-key duplicates are interchangeable, so duplicate occurrence is sufficient.
- Decision: canonical movement ordering replaces processor insertion order as the read contract.
- Smell: the old model conflated row order, duplicate disambiguation, and business identity.
- Smell: `rawPosition` in scoped accounting becomes misleading once persisted movement identity is no longer slot-based.

## Naming Issues

- `position` is the wrong name for duplicate disambiguation; the new term should be `duplicateOccurrence`.
- `rawPosition` should be removed or renamed to `canonicalOrder` if it survives.
- `movementFingerprint` should stay the main user-facing identity term; discussions should stop referring to movement “position” once this refactor lands.
