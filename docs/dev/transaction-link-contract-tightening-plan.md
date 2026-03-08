# Transaction-Link Contract Tightening

Status: landed.

This phase is complete enough to treat as the finished precondition for the
cost-basis refactor. There is no remaining Step 3 or Step 4 implementation
blocker in this phase.

## Phase Status

1. Step 1: complete. Persisted `transaction_links` now carry resolved
   `sourceAssetId` and `targetAssetId`.
2. Step 2: complete. Link candidates carry deterministic movement identity, and
   normal algorithmic links persist it.
3. Step 3: complete. Orphaned confirmed overrides no longer materialize vague
   zero-amount links.
4. Step 4: complete for implementation purposes. Consumers and tests were
   updated across accounting, data, price enrichment, cost basis, and CLI.

## Why This Refactor Exists

`transaction_links` used to persist a lossy transfer contract:

- transaction ids
- one shared display symbol
- source and target amounts

That pushed complexity upward:

- cost basis had to re-resolve persisted links back onto accounting movements
- orphaned manual overrides could persist weak sentinel links
- symbol-based recovery logic survived longer than it should

The linker already knew the real source/target movement identity. This phase
made the bottom layer persist that truth once.

## Final Persisted Contract

The effective persisted contract is now:

```ts
interface TransactionLink {
  id: number;
  sourceTransactionId: number;
  targetTransactionId: number;
  assetSymbol: Currency;
  sourceAssetId: string;
  targetAssetId: string;
  sourceAmount: Decimal;
  targetAmount: Decimal;
  sourceMovementFingerprint: string;
  targetMovementFingerprint: string;
  linkType: LinkType;
  confidenceScore: Decimal;
  matchCriteria: MatchCriteria;
  status: LinkStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}
```

Database shape:

```text
source_asset_id TEXT NOT NULL
target_asset_id TEXT NOT NULL
source_movement_fingerprint TEXT NOT NULL
target_movement_fingerprint TEXT NOT NULL
```

Important: the contract requires both asset ids. A single shared `assetId` is
not sufficient for cross-venue transfers:

- source: `exchange:kraken:usdc`
- target: `blockchain:ethereum:0xa0b8...`

## Movement Fingerprint Design

Fingerprints are deterministic and position-based:

```ts
computeMovementFingerprint({
  txFingerprint,
  movementType,
  position,
});

// movement:${txFingerprint}:${movementType}:${position}
```

Examples:

```text
movement:kraken:WITHDRAWAL-123:outflow:0
movement:blockchain:ethereum:0xabc...:inflow:0
```

This intentionally does not use `transaction_movements.id`. Movement rows are
rebuilt during price updates, so row ids are not stable enough to serve as
identity.

The safety invariant is:

- inflow order is stable
- outflow order is stable
- persistence continues to round-trip by `(transaction_id, position)`

## Landed Behavioral Changes

### Algorithmic Links

Normal algorithmic links now persist:

- `sourceAssetId = match.sourceMovement.assetId`
- `targetAssetId = match.targetMovement.assetId`
- `sourceMovementFingerprint = match.sourceMovement.movementFingerprint`
- `targetMovementFingerprint = match.targetMovement.movementFingerprint`

Partial links still persist one concrete source movement identity, one concrete
target movement identity, and the consumed amount.

### Same-Hash Internal Reduction

This phase ended up tightening the same-hash path more than the original plan:

- same-hash grouping now keys by `assetId`, not just symbol
- internal reduction refuses ambiguous multi-movement participants
- internal links are only upgraded to full persisted links after concrete source
  and target candidate fingerprints are attached

That avoids leaking a half-resolved `blockchain_internal` link into persistence.

### Orphaned Confirmed Overrides

Orphaned confirmed overrides now resolve through the same link candidates used
by the matcher, not through a weaker raw-movement fallback.

Required behavior now:

1. resolve the source and target transactions
2. resolve source/target link candidates for the override asset
3. only materialize when exactly one source candidate and one target candidate
   remain
4. persist resolved asset ids, resolved amounts, and movement fingerprints
5. otherwise log a warning and skip materialization

They no longer persist:

- `sourceAmount=0`
- `targetAmount=0`
- missing asset ids
- missing movement fingerprints

## Implementation Shape

The important implementation boundary is:

- pre-linking may hold a temporary internal-link shape before movement
  fingerprints are attached
- persistence only ever sees complete `NewTransactionLink` values

That intermediate shape exists only to keep the type contract honest. A
fingerprint-less internal link is not treated as a valid persisted link.

## Files That Define The Landed Contract

Core + data contract:

- [`packages/core/src/transaction/transaction-link.ts`](../../packages/core/src/transaction/transaction-link.ts)
- [`packages/data/src/database-schema.ts`](../../packages/data/src/database-schema.ts)
- [`packages/data/src/migrations/001_initial_schema.ts`](../../packages/data/src/migrations/001_initial_schema.ts)
- [`packages/data/src/repositories/transaction-link-repository.ts`](../../packages/data/src/repositories/transaction-link-repository.ts)

Linking identity flow:

- [`packages/accounting/src/linking/link-candidate.ts`](../../packages/accounting/src/linking/link-candidate.ts)
- [`packages/accounting/src/linking/pre-linking/build-link-candidates.ts`](../../packages/accounting/src/linking/pre-linking/build-link-candidates.ts)
- [`packages/accounting/src/linking/pre-linking/group-same-hash-transactions.ts`](../../packages/accounting/src/linking/pre-linking/group-same-hash-transactions.ts)
- [`packages/accounting/src/linking/pre-linking/reduce-blockchain-groups.ts`](../../packages/accounting/src/linking/pre-linking/reduce-blockchain-groups.ts)
- [`packages/accounting/src/linking/link-construction.ts`](../../packages/accounting/src/linking/link-construction.ts)
- [`packages/accounting/src/linking/linking-orchestrator-utils.ts`](../../packages/accounting/src/linking/linking-orchestrator-utils.ts)

Fingerprint helpers:

- [`packages/core/src/override/override-utils.ts`](../../packages/core/src/override/override-utils.ts)

## Verification Surface

This phase is covered by tests in:

- linking candidate construction
- orphaned override materialization
- same-hash internal reduction
- repository round-trip
- price-enrichment link fixtures
- cost-basis transfer fixtures
- CLI link workflows and export/view utilities

The movement-ordering invariant already has repository coverage at:

- [`packages/data/src/repositories/__tests__/transaction-repository.test.ts`](../../packages/data/src/repositories/__tests__/transaction-repository.test.ts)

## What This Unlocks

Cost basis can now assume:

- confirmed links already know which source and target asset ids they connect
- confirmed links no longer need zero-amount manual-link fallbacks
- movement-level targeting is available directly from persisted links
- any remaining resolution logic in cost basis is local accounting policy, not
  persistence debt

## Remaining Follow-Up

No additional Phase 0 implementation work is required before the cost-basis
refactor.

The one optional hardening step left is to introduce a dedicated
`MovementFingerprintSchema` instead of treating fingerprints as plain strings.
That is a cleanup, not a blocker.
