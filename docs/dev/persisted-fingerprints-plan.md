---
status: superseded
last_updated: 2026-03-17
---

# Persisted Fingerprints Plan

> Superseded by [Transaction Identity Simplification Plan](./transaction-identity-simplification-plan.md).
> This document is kept as historical context for the earlier persisted-fingerprint slice and still describes the pre-`txFingerprint` simplification model.

## Summary

This plan captures the practical version of the fingerprint work:

- persist transaction fingerprints on `transactions`
- persist movement fingerprints on `transaction_movements`
- keep the current `position` column for now
- stop treating `position` as semantic identity
- move linking and override flows to use stored fingerprints directly

This is intentionally not a full identity-model redesign. The goal is to make movement and transaction identity explicit in the database without coupling this work to removal or renaming of `position`.

## Why This Plan Exists

Today the code already treats fingerprints as the logical identity for overrides and linking, but those fingerprints are mostly computed on demand.

Current pain points:

- override lookups require recomputing transaction fingerprints
- link replay requires recomputing fingerprints across all candidate transactions
- movement identity is indirectly tied to array order after rows are loaded from the database
- the `transaction_movements.position` column looks more important than it really is, because it currently carries row-order semantics that downstream code uses to rebuild arrays before recomputing fingerprints

Persisted fingerprints improve this by making identity explicit and queryable.

Because the database is dropped during development and rebuilt from `001_initial_schema.ts`, this plan does not need a mixed-state compatibility path. Once steps 2 and 3 land, every persisted transaction and movement row will have fingerprints.

## Decision

Use the practical version.

In scope:

- `transactions.tx_fingerprint`
- `transaction_movements.movement_fingerprint`
- `Transaction.txFingerprint`
- `AssetMovement.movementFingerprint`
- `FeeMovement.movementFingerprint`
- read/write path changes needed to populate and preserve those values
- targeted linking and override-flow refactors that use persisted fingerprints

Out of scope for this slice:

- removing `transaction_movements.position`
- renaming `position` to `row_order`
- changing the fingerprint format
- introducing a new movement identity model that avoids ordinal disambiguation
- redesigning the override store schema beyond what is needed for direct fingerprint usage

## Current State

### Transaction Identity

Transaction fingerprints are currently computed from:

- `source`
- `accountId`
- `externalId`

Implementation:

- `packages/core/src/override/override-utils.ts`
- function: `computeTxFingerprint`

### Movement Identity

Movement fingerprints are currently computed from:

- `txFingerprint`
- `movementType`
- `position`

Implementation:

- `packages/core/src/override/override-utils.ts`
- function: `computeMovementFingerprint`

Important nuance:

- fingerprint `position` means ordinal within movement type
- database `transaction_movements.position` is currently flattened row order across inflows, outflows, then fees

That mismatch is confusing, but this plan does not solve it by changing the model. It solves it by persisting the fingerprint directly and using that persisted value as the identity.

## Desired End State

After this slice:

- every persisted transaction row has a durable `tx_fingerprint`
- every persisted movement row has a durable `movement_fingerprint`
- link and override flows look up affected rows from stored fingerprints instead of recomputing identity from read order
- `position` remains in the database only as a persistence/detail field, not as the primary concept humans need to reason about

## Implementation Plan

## 1. Schema Changes

Update the initial schema and Kysely types.

Files:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`

Changes:

- add `tx_fingerprint: string` to `TransactionsTable`
- add `movement_fingerprint: string` to `TransactionMovementsTable`
- add an index on `transactions.tx_fingerprint`
- add an index on `transaction_movements.movement_fingerprint`
- keep the existing `position` column and `(transaction_id, position)` uniqueness constraint unchanged for this slice

Pseudo-shape:

```ts
export interface TransactionsTable {
  // existing fields...
  tx_fingerprint: string;
}

export interface TransactionMovementsTable {
  // existing fields...
  movement_fingerprint: string;
}
```

Migration notes:

- this project currently updates `001_initial_schema.ts` directly during development
- do not add an incremental migration for this work

## 2. Persist Transaction Fingerprints on Write

Write the fingerprint once when inserting transactions.

Files:

- `packages/data/src/repositories/transaction-repository.ts`

Functions to update:

- `buildInsertValues`
- `TransactionRepository/create`
- `TransactionRepository/createBatch`

Plan:

- compute `tx_fingerprint` inside `buildInsertValues`
- make `buildInsertValues` return both:
  - transaction insert values
  - the computed `tx_fingerprint`
- use the same inputs already used elsewhere in the app:
  - `transaction.source`
  - `accountId`
  - `transaction.externalId`
- if fingerprint computation fails, return an error and stop the write

Pseudo-code:

```ts
const txFingerprintResult = computeTxFingerprint({
  source: transaction.source,
  accountId,
  externalId: transaction.externalId || generateDeterministicTransactionHash(transaction),
});

if (txFingerprintResult.isErr()) {
  return err(txFingerprintResult.error);
}

return ok({
  insertValues: {
    // existing insert fields...
    tx_fingerprint: txFingerprintResult.value,
  },
  txFingerprint: txFingerprintResult.value,
});
```

Important detail:

- use the exact external ID that will be persisted on the transaction row
- do not compute a fingerprint from one external ID and persist a different one
- `TransactionRepository/create` and `TransactionRepository/createBatch` should pass the returned `txFingerprint` into `buildMovementRows`

## 3. Persist Movement Fingerprints on Write

Write movement fingerprints while building movement rows.

Files:

- `packages/data/src/repositories/transaction-repository.ts`

Functions to update:

- `buildMovementRows`
- `assetMovementToRow`
- `feeMovementToRow`

Plan:

- change `buildMovementRows` so it receives the persisted `tx_fingerprint` as an explicit parameter
- compute movement fingerprints there, before rows are inserted
- keep the existing `position` column as-is for now
- set `movement_fingerprint` explicitly on each inserted movement row

Concrete data flow:

1. `buildInsertValues` computes `tx_fingerprint`
2. `buildInsertValues` returns both insert values and `txFingerprint`
3. `create` / `createBatch` insert the transaction row
4. the caller passes `txFingerprint` into `buildMovementRows`
5. `buildMovementRows` computes and persists `movement_fingerprint` for each movement row

Pseudo-code sketch:

```ts
const insertResult = buildInsertValues(transaction, accountId, createdAt);
if (insertResult.isErr()) return err(insertResult.error);

const { insertValues, txFingerprint } = insertResult.value;

const txResult = await db.insertInto('transactions').values(insertValues) ...;

const movementRowsResult = buildMovementRows(transaction, transactionId, txFingerprint);
if (movementRowsResult.isErr()) return err(movementRowsResult.error);

for (let inflowIdx = 0; inflowIdx < inflows.length; inflowIdx++) {
  const movementFingerprintResult = computeMovementFingerprint({
    txFingerprint,
    movementType: 'inflow',
    position: inflowIdx,
  });
  // assign to row.movement_fingerprint
}

for (let outflowIdx = 0; outflowIdx < outflows.length; outflowIdx++) {
  const movementFingerprintResult = computeMovementFingerprint({
    txFingerprint,
    movementType: 'outflow',
    position: outflowIdx,
  });
  // assign to row.movement_fingerprint
}

for (let feeIdx = 0; feeIdx < fees.length; feeIdx++) {
  const movementFingerprintResult = computeMovementFingerprint({
    txFingerprint,
    movementType: 'fee',
    position: feeIdx,
  });
  // assign to row.movement_fingerprint
}
```

Important detail:

- do not derive fingerprint position from flattened DB row order
- derive it from the ordinal within each logical movement array

## 4. Preserve Fingerprints on Movement Rebuilds

Movement rebuild paths must continue to produce the same stored fingerprints.

Files:

- `packages/data/src/repositories/transaction-repository.ts`

Functions to verify/update:

- `TransactionRepository/updateMovementsWithPrices`
- `buildMovementRows`

Plan:

- make movement rebuild use the same fingerprint-generation rules as initial writes
- ensure that price enrichment and any full movement rewrite preserves fingerprint stability

Expected invariant:

- a pure price update must not change movement identity

## 5. Make Persisted Fingerprints First-Class on Read Paths

Stop requiring downstream code to reconstruct identity from row order wherever practical.

Files:

- `packages/data/src/repositories/transaction-repository.ts`
- `packages/core/src/transaction/transaction.ts`

Plan:

- add `txFingerprint` to `Transaction`
- add `movementFingerprint` to `AssetMovement`
- add `movementFingerprint` to `FeeMovement`
- wire the repository read path to map persisted columns into those shapes
- update affected fixtures and builders mechanically across tests instead of introducing a parallel transitional type
- use the universal model as the single read model for persisted fingerprints in steps 6 and 7

This is the key step that reduces dependence on `position` in the rest of the system.

These fields should be treated as required persisted identity, not optional compatibility data.

Concrete decision:

- do not create a narrower linking-only type for fingerprints
- put fingerprint fields on the transaction model directly
- accept the fixture churn as the simpler long-term path

## 6. Update Linking to Use Stored Fingerprints

Linking should use the persisted movement fingerprint directly.

Files:

- `packages/accounting/src/linking/pre-linking/build-linkable-movements.ts`
- `packages/accounting/src/linking/matching/linkable-movement.ts`
- `packages/accounting/src/linking/orchestration/linking-orchestrator-utils.ts`
- `packages/accounting/src/linking/orchestration/override-replay.ts`

Plan:

- stop recomputing linking identity from read order
- require loaded transaction/movement inputs used by linking to carry stored fingerprints
- use persisted `movement_fingerprint` as the source of truth

## 7. Simplify Override Lookups That Use Transaction Fingerprints

Use stored transaction fingerprints where transaction-targeted overrides already depend on them.

Files to review:

- `apps/cli/src/features/transactions/command/transactions-read-support.ts`
- `apps/cli/src/features/transactions/command/transactions-edit-handler.ts`
- `apps/cli/src/features/links/command/links-override-utils.ts`
- `packages/data/src/overrides/transaction-note-replay.ts`

Plan:

- where transaction rows are already loaded, read `tx_fingerprint` directly instead of recomputing
- keep existing override payload shapes unchanged in this slice

Note:

- this slice does not require redesigning the override store
- direct DB indexes inside the override store can be a later follow-up if scans remain a performance problem

## 8. Tests

Add or update tests for persistence, rebuild stability, and lookup behavior.

Files to update or add:

- `packages/data/src/repositories/__tests__/transaction-repository.test.ts`
- `packages/data/src/overrides/__tests__/override-store.test.ts`
- `packages/accounting/src/linking/orchestration/override-replay.test.ts`
- `packages/accounting/src/linking/pre-linking/build-linkable-movements.test.ts`
- any transaction note command tests affected by fingerprint reads

Test cases:

- transaction insert persists `tx_fingerprint`
- movement insert persists `movement_fingerprint`
- fee rows persist fingerprints with fee-local ordinal semantics
- repository reads hydrate `txFingerprint` and `movementFingerprint` onto the transaction model
- `updateMovementsWithPrices` preserves movement fingerprints for the same logical movements
- linking still resolves overrides correctly when reading persisted fingerprints
- transaction note flows can resolve directly from stored transaction fingerprints

## Step Order

Implement in this order:

1. schema types + migration
2. transaction write path
3. movement write path
4. movement rebuild path
5. repository read-path support
6. linking usage updates
7. override/CLI usage updates
8. tests and cleanup

This order keeps the work incremental and makes debugging easier.

## Non-Goals for This Slice

Do not do these in the same change unless they are required to finish the fingerprint work safely:

- remove `position`
- rename `position`
- redesign fingerprint formats
- redesign override payload schemas
- introduce raw-row fingerprints

Those can be follow-up tasks once the practical version is fully in place.

## Follow-Up Options

After this plan lands, the next cleanup choices are:

1. rename `transaction_movements.position` to `row_order`
2. add reference/index support inside the override store for reverse lookup by fingerprint
3. remove `position` entirely if no live code still depends on row-order reconstruction

## Decisions & Smells

- Decision: take the practical fingerprint-persistence route first, not a full identity redesign.
- Decision: do not carry a persisted-vs-recomputed dual path in dev; stored fingerprints become mandatory once the schema is updated.
- Decision: add fingerprint fields directly to `Transaction`, `AssetMovement`, and `FeeMovement` instead of introducing a parallel transitional type.
- Decision: make `buildInsertValues` the explicit handoff point for `txFingerprint` into `buildMovementRows`.
- Decision: keep `position` for now to reduce change scope and risk.
- Smell: `position` looks like business identity in the schema, but today it is mostly a row-order implementation detail.
- Smell: movement identity is currently split between persisted rows and recomputed array order.

## Naming Issues

- `transaction_movements.position` is misleading; long-term better names are `row_order` or `storage_position`.
- `movement_fingerprint` should become the term used in docs and code reviews when discussing movement identity, not `position`.
