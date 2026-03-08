# Transaction-Link Contract Tightening Plan

This document lays out a small foundation refactor that should land after the
linking-first work and before the large cost-basis cleanup.

It is intentionally narrow:

1. tighten the persisted `transaction_links` contract so it carries resolved
   source/target identity
2. add deterministic movement fingerprints in the same phase if the blast
   radius stays small
3. remove sentinel/orphaned-link ambiguity before cost basis consumes links
   again

This is a preconditioner, not the main accounting refactor. The goal is to fix
the persistence seam first so the next cost-basis phase can delete more logic
instead of relocating it.

## Why This Refactor Exists

Today `transaction_links` persists a lossy view of a transfer:

- transaction ids
- one shared `assetSymbol`
- `sourceAmount`
- `targetAmount`

That contract is defined in:

- [`packages/core/src/transaction/transaction-link.ts`](../../packages/core/src/transaction/transaction-link.ts)
- [`packages/data/src/database-schema.ts`](../../packages/data/src/database-schema.ts)
- [`packages/data/src/repositories/transaction-link-repository.ts`](../../packages/data/src/repositories/transaction-link-repository.ts)

But the linker already knows more than that at match time:

- source movement `assetId`
- target movement `assetId`
- source movement direction and candidate identity
- target movement direction and candidate identity

That richer context exists in:

- [`packages/accounting/src/linking/link-candidate.ts`](../../packages/accounting/src/linking/link-candidate.ts)
- [`packages/accounting/src/linking/link-construction.ts`](../../packages/accounting/src/linking/link-construction.ts)
- [`packages/accounting/src/linking/pre-linking/build-link-candidates.ts`](../../packages/accounting/src/linking/pre-linking/build-link-candidates.ts)

The persistence seam throws that identity away. Downstream consumers then have
to reconstruct meaning from symbol-only links:

- cost basis resolves links back onto accounting-scoped movements
- manual orphaned overrides materialize with sentinel zero amounts
- symbol-based fallbacks survive longer than they should

That is the wrong direction of complexity. The bottom layer already has the
truth and should persist it once.

## Core Decision

Do **not** add a single `assetId` column to `transaction_links`.

A cross-venue transfer can legitimately have different source and target asset
ids even when the display symbol matches:

- source: `exchange:kraken:usdc`
- target: `blockchain:ethereum:0xa0b8...`

The contract needs **both** sides:

- `sourceAssetId`
- `targetAssetId`

If we add movement fingerprints in the same phase, they also need both sides:

- `sourceMovementFingerprint`
- `targetMovementFingerprint`

## Scope

### In Scope

- extend persisted `transaction_links` with source/target asset identity
- populate those fields for all algorithm-generated links
- resolve and populate those fields for orphaned confirmed overrides when
  uniquely possible
- replace zero-amount orphaned-link materialization with resolved amounts
- add deterministic movement fingerprints if the implementation remains local
  to linking + data persistence
- update tests and docs to treat the stricter persisted contract as the new
  foundation

### Out of Scope

- redesigning the override event payload/UI in this phase
- redesigning matching strategies or scoring rules
- redesigning `transactions` or `transaction_movements`
- cost-basis matcher cleanup
- price-enrichment algorithm changes

## Target End State

After this refactor:

- every persisted algorithmic transfer link carries:
  - `sourceTransactionId`
  - `targetTransactionId`
  - `assetSymbol`
  - `sourceAssetId`
  - `targetAssetId`
  - `sourceAmount`
  - `targetAmount`
- orphaned confirmed overrides are only materialized when source/target
  identity can be resolved uniquely from current transaction movements
- orphaned override links no longer persist `sourceAmount=0` and
  `targetAmount=0`
- if movement fingerprints are included, they are deterministic and derived
  from transaction identity plus movement order, not database row ids
- cost basis can later consume a stricter link contract instead of re-resolving
  vague symbol-only links

## Recommended Contract

### Required Fields

Add to the domain/schema contract:

```ts
interface TransactionLink {
  sourceTransactionId: number;
  targetTransactionId: number;
  assetSymbol: Currency;
  sourceAssetId: string;
  targetAssetId: string;
  sourceAmount: Decimal;
  targetAmount: Decimal;
  // existing fields unchanged...
}
```

Database columns:

```text
source_asset_id TEXT NOT NULL
target_asset_id TEXT NOT NULL
```

### Recommended In The Same Phase

If the implementation stays as local as it looks today, add:

```ts
interface TransactionLink {
  sourceMovementFingerprint?: string;
  targetMovementFingerprint?: string;
}
```

Database columns:

```text
source_movement_fingerprint TEXT NULL
target_movement_fingerprint TEXT NULL
```

Recommended default:

- do this in the same phase
- only defer if it starts forcing unrelated processor or CLI override redesign

Reason:

- the repo already persists stable per-transaction movement ordering through
  `(transaction_id, position)`
- the extra linker/data work is modest once the contract is already being
  touched
- future cost-basis and override precision get much simpler if movement
  identity is available now

## Movement Fingerprint Design

### Why Not Use `transaction_movements.id`

Do not use database row ids as movement identity.

`updateMovementsWithPrices()` deletes and rebuilds movement rows during price
updates, so row ids are not stable across rewrites:

- [`packages/data/src/repositories/transaction-repository.ts`](../../packages/data/src/repositories/transaction-repository.ts)

### Deterministic Fingerprint Format

Use transaction fingerprint + movement kind + position:

```ts
computeMovementFingerprint({
  txFingerprint,
  movementType,
  position,
});

// movement:${txFingerprint}:${movementType}:${position}
```

Example:

```text
movement:kraken:WITHDRAWAL-123:outflow:0
movement:blockchain:ethereum:0xabc...:inflow:0
```

Implementation notes:

- reuse `computeTxFingerprint()` from
  [`packages/core/src/override/override-utils.ts`](../../packages/core/src/override/override-utils.ts)
- add a sibling helper rather than duplicating string concatenation in linking
- do not include mutable values like amount or price metadata in the fingerprint

### Required Invariant

Processor/emitter order becomes part of the identity contract:

- inflows keep their emitted order
- outflows keep their emitted order
- fees keep their emitted order
- persistence continues to round-trip by `(transaction_id, position)`

This is already close to true today:

- movement rows are written in inflow → outflow → fee order at
  [`packages/data/src/repositories/transaction-repository.ts`](../../packages/data/src/repositories/transaction-repository.ts)
- repository tests already assert position ordering survives rebuilds at
  [`packages/data/src/repositories/__tests__/transaction-repository.test.ts`](../../packages/data/src/repositories/__tests__/transaction-repository.test.ts)

## Step 1: Extend The Persisted Link Contract

### File Changes

Update:

- [`packages/core/src/transaction/transaction-link.ts`](../../packages/core/src/transaction/transaction-link.ts)
- [`packages/accounting/src/linking/schemas.ts`](../../packages/accounting/src/linking/schemas.ts)
- [`packages/accounting/src/linking/types.ts`](../../packages/accounting/src/linking/types.ts)
- [`packages/data/src/database-schema.ts`](../../packages/data/src/database-schema.ts)
- [`packages/data/src/migrations/001_initial_schema.ts`](../../packages/data/src/migrations/001_initial_schema.ts)
- [`packages/data/src/repositories/transaction-link-repository.ts`](../../packages/data/src/repositories/transaction-link-repository.ts)

Changes:

- add `sourceAssetId` and `targetAssetId` to the Zod schema
- add movement fingerprint fields if included in this phase
- persist them in the repository
- parse them on reads
- add NOT NULL constraints for asset ids
- keep movement fingerprint columns nullable if introduced in the same phase

### Exit Criteria

- link rows always round-trip source/target asset identity
- link repository tests fail if either asset id is missing
- schema/docs no longer describe a transfer link as symbol-only identity

## Step 2: Carry Identity Through Link Candidates And Match Construction

### File Changes

Update:

- [`packages/accounting/src/linking/link-candidate.ts`](../../packages/accounting/src/linking/link-candidate.ts)
- [`packages/accounting/src/linking/pre-linking/build-link-candidates.ts`](../../packages/accounting/src/linking/pre-linking/build-link-candidates.ts)
- [`packages/accounting/src/linking/link-construction.ts`](../../packages/accounting/src/linking/link-construction.ts)

Recommended `LinkCandidate` additions:

```ts
interface LinkCandidate {
  // existing fields...
  position: number;
  movementFingerprint?: string;
}
```

Implementation detail:

- populate `position` while iterating transaction inflows/outflows in
  `buildLinkCandidates()`
- if fingerprints are included now, compute them there once, near candidate
  creation
- `createTransactionLink()` should persist:
  - `sourceAssetId = match.sourceMovement.assetId`
  - `targetAssetId = match.targetMovement.assetId`
  - `sourceMovementFingerprint = match.sourceMovement.movementFingerprint`
  - `targetMovementFingerprint = match.targetMovement.movementFingerprint`

Important:

- for partial matches, the link still persists one source candidate and one
  target candidate identity plus the consumed amount
- this phase does not need movement ids in `UniversalTransactionData`
- do not reopen the matching algorithms just to get identity persisted

### Exit Criteria

- normal algorithmic links persist both asset ids
- partial links persist both asset ids and, if enabled, both movement
  fingerprints
- no algorithm-generated link needs downstream symbol-only recovery to know
  which asset ids it connects

## Step 3: Fix Orphaned Confirmed Override Materialization

### Problem

Today orphaned confirmed overrides can create links with:

- `sourceAmount=0`
- `targetAmount=0`

That behavior lives in:

- [`packages/accounting/src/linking/linking-orchestrator-utils.ts`](../../packages/accounting/src/linking/linking-orchestrator-utils.ts)

That is acceptable for “the user confirmed these two transactions are related,”
but it is too weak as a persisted contract if cost basis will later consume it
without symbol-based recovery logic.

### Required Behavior

When materializing an orphaned confirmed override:

1. resolve source transaction and target transaction as today
2. resolve the eligible source outflow movement(s) for the override asset symbol
3. resolve the eligible target inflow movement(s) for the override asset symbol
4. if exactly one source movement and exactly one target movement remain:
   - persist resolved source/target asset ids
   - persist resolved source/target amounts
   - persist movement fingerprints if included in this phase
5. otherwise:
   - log a warning with concrete reason
   - skip materializing the link

Keep the current non-fatal behavior for stale/ambiguous overrides. Do **not**
materialize vague links just to preserve a historical confirmation.

### File Changes

Update:

- [`packages/accounting/src/linking/linking-orchestrator-utils.ts`](../../packages/accounting/src/linking/linking-orchestrator-utils.ts)
- [`packages/accounting/src/linking/linking-orchestrator.ts`](../../packages/accounting/src/linking/linking-orchestrator.ts)
- [`packages/accounting/src/linking/__tests__/linking-orchestrator.test.ts`](../../packages/accounting/src/linking/__tests__/linking-orchestrator.test.ts)

### Exit Criteria

- orphaned override links no longer persist zero sentinel amounts
- orphaned override links no longer persist missing asset ids
- ambiguous override resolution remains visible via warning/tests, not silent
  fuzzy materialization

## Step 4: Update Consumers And Tests

### File Changes

Update tests in:

- [`packages/accounting/src/linking/__tests__/link-construction.test.ts`](../../packages/accounting/src/linking/__tests__/link-construction.test.ts)
- [`packages/accounting/src/linking/__tests__/schemas.test.ts`](../../packages/accounting/src/linking/__tests__/schemas.test.ts)
- [`packages/accounting/src/linking/__tests__/linking-orchestrator.test.ts`](../../packages/accounting/src/linking/__tests__/linking-orchestrator.test.ts)
- [`packages/data/src/repositories/__tests__/transaction-link-repository.test.ts`](../../packages/data/src/repositories/__tests__/transaction-link-repository.test.ts)
- [`packages/data/src/repositories/__tests__/transaction-repository.test.ts`](../../packages/data/src/repositories/__tests__/transaction-repository.test.ts)

Add assertions that:

- exchange → blockchain links can persist different source/target asset ids for
  the same symbol
- algorithmic links persist actual source/target amounts and asset ids
- orphaned overrides with unique movement resolution persist actual amounts and
  ids
- orphaned overrides with ambiguous source/target movements are skipped
- movement fingerprints, if included, survive movement row rebuilds because they
  are position-based rather than row-id-based

## Recommended Implementation Order

For one developer working locally, follow this order:

1. extend the core/domain `TransactionLink` contract with source/target asset ids
2. extend the DB schema and repository round-trip
3. add `position` to `LinkCandidate`
4. add movement fingerprint helper + `LinkCandidate.movementFingerprint` if the
   scope is still clean
5. populate identity fields in `createTransactionLink()`
6. rewrite orphaned override materialization to resolve real movements instead
   of writing sentinel zero-amount links
7. update tests
8. only then begin the larger cost-basis simplification

## What This Unlocks

Once this lands, the next cost-basis phase can assume:

- confirmed links already know which source/target asset ids they connect
- confirmed links no longer need amount-free matcher fallbacks for manual links
- movement fingerprints may be available for exact source/target targeting
- any remaining cost-basis-specific resolution logic is local policy, not
  persistence debt

That is a much cleaner foundation than teaching cost basis to reinterpret a
symbol-only persisted link contract.

## Decisions And Smells

- Main smell: the bottom layer already knows source/target asset identity, but
  the persisted link contract discards it and forces downstream recovery.
- Important decision: persist `sourceAssetId` and `targetAssetId`, not one
  shared `assetId`.
- Recommended design: movement fingerprints should be deterministic
  `tx-fingerprint + movement-type + position`, not DB row ids.
- Important caveat: movement fingerprints are only safe if movement ordering is
  treated as part of the transaction contract and tested.
- Failure-policy decision: ambiguous orphaned overrides may remain non-fatal,
  but they must not materialize vague sentinel links.
