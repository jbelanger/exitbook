---
last_verified: 2026-04-20
status: canonical
---

# Transaction Linking Specification

> ⚠️ **Code is law**: If this document disagrees with implementation, update the spec to match code.

Defines how Exitbook turns processed transactions into persisted `transaction_links`.
It covers the linking runtime boundary, same-hash blockchain reduction, matching,
override replay, and the persisted link contract.

## Quick Reference

| Concept                 | Key Rule                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime boundary        | Linking builds linkable movements in memory from processed transactions; it does not persist a pre-linking shadow table                                                            |
| Linkable movement unit  | One `LinkableMovement` per inflow or outflow movement                                                                                                                              |
| Matching amount         | `netAmount ?? grossAmount`, except clear same-hash internal sends can reduce the source outflow amount first                                                                       |
| Structural trades       | Transactions with disjoint inflow/outflow asset sets are excluded from strategy matching                                                                                           |
| Same-hash grouping      | Blockchain transactions group by normalized hash, then by `assetId`                                                                                                                |
| Internal-link topology  | Only one pure outflow participant plus one or more pure inflow participants is linkable; ambiguous groups are skipped                                                              |
| Movement identity       | Persisted links carry deterministic source/target movement fingerprints: `movement:${movementHash}:${duplicateOccurrence}`                                                         |
| Asset identity          | Persisted links carry both `sourceAssetId` and `targetAssetId`; one shared asset id is not enough                                                                                  |
| Match thresholds        | Defaults: `maxTimingWindowHours=48`, `clockSkewToleranceHours=2`, `minConfidenceScore=0.7`, `autoConfirmThreshold=0.95`, `minPartialMatchFraction=0.1`                             |
| Strategy order          | `exact-hash` → `same-hash external outflow` → `counterparty-roundtrip` → `bridge-annotation` → `amount-timing` → `partial-match`                                                   |
| Bridge annotation       | Explicit blockchain bridge pairs may link only when both sides carry compatible asserted `bridge_participant` annotations and the pair is uniquely safe                            |
| Same-hash external send | Exact same-hash exchange target match is allowed either exactly or with one exact explained residual on the target                                                                 |
| Override replay         | Last event wins per link fingerprint; orphaned confirmed overrides from `links confirm` or `links create` materialize only when exactly one source and one target movement resolve |
| Persistence             | `links run` replaces persisted non-rejected links atomically and then marks the `links` projection fresh                                                                           |

## Goals

- **Deterministic transfer linking**: The same processed transactions and override log produce the same persisted links.
- **Strict persisted contract**: Persist enough source/target identity that downstream consumers do not have to rebuild it heuristically.
- **Conservative blockchain handling**: Prefer skipped ambiguous same-hash cases over false internal links.
- **Rebuild-safe user decisions**: Link and unlink overrides survive `links run` reprocessing.

## Non-Goals

- Defining cost-basis accounting behavior on top of links.
- Inferring ownership inside ambiguous same-hash blockchain groups.
- Persisting pre-linking linkable movements or UTXO-adjusted shadow tables.
- Solving movement-level accounting exclusions.

## Definitions

### LinkableMovement

Ephemeral matching input built from processed transactions:

```ts
interface LinkableMovement {
  id: number;
  transactionId: number;
  accountId: number;
  platformKey: string;
  platformKind: PlatformKind;
  assetId: string;
  assetSymbol: Currency;
  direction: 'in' | 'out';
  amount: Decimal;
  grossAmount?: Decimal;
  timestamp: Date;
  blockchainTxHash?: string;
  fromAddress?: string;
  toAddress?: string;
  transactionAnnotations?: TransactionAnnotation[];
  isInternal: boolean;
  excluded: boolean;
  movementFingerprint: string;
}
```

Important semantics:

- `amount` is the matching amount.
- `grossAmount` is only present when it differs from `amount`.
- `transactionAnnotations` carries persisted transaction-level interpretation facts
  needed by strategies that no longer scrape raw diagnostics.
- `excluded=true` means the linkable movement exists for observability but strategies must not match it.
- `movementFingerprint` is copied from the persisted processed movement.

### Movement Fingerprint

Stable movement identity derived from transaction identity plus canonical movement content:

```ts
computeMovementFingerprint({
  txFingerprint,
  canonicalMaterial,
  duplicateOccurrence,
});

// movement:${sha256Hex(txFingerprint|canonicalMaterial)}:${duplicateOccurrence}
```

This intentionally does not use `transaction_movements.id`. Movement rows can be
rebuilt because identity is rooted in semantic movement content plus a bucket-local
duplicate occurrence, not insertion order.

### TransactionLink

Persisted transfer relationship:

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
  linkType:
    | 'exchange_to_blockchain'
    | 'blockchain_to_exchange'
    | 'blockchain_to_blockchain'
    | 'exchange_to_exchange'
    | 'blockchain_internal';
  confidenceScore: Decimal;
  matchCriteria: MatchCriteria;
  status: 'suggested' | 'confirmed' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}
```

Important semantics:

- `assetSymbol` is the matching/display asset used by override fingerprints and matching heuristics.
- `sourceAssetId` and `targetAssetId` are the persisted accounting identities for the specific linked movements.
- `sourceMovementFingerprint` and `targetMovementFingerprint` identify the exact linked movements within those transactions.

### Link Fingerprint

Override replay identity for a logical source/target pair:

```ts
link:${sorted(sourceFingerprint, targetFingerprint)}:${assetSymbol}
```

This is order-invariant. Confirming A→B and B→A refers to the same override key.

### Same-Hash Asset Group

Internal reducer input for blockchain transactions that share a normalized hash:

```ts
interface SameHashAssetGroup {
  normalizedHash: string;
  blockchain: string;
  assetId: string;
  assetSymbol: string;
  participants: SameHashParticipant[];
}
```

Grouping is by `assetId`, not by symbol alone.

## Behavioral Rules

### Runtime Boundary

`links run` is a projection build with this shape:

1. mark the `links` projection as `building`
2. load processed transactions
3. build `LinkableMovement[]` plus internal blockchain links in memory
4. run matching strategies over those linkable movements
5. replay link/unlink overrides
6. persist all non-rejected links by replacement inside one transaction
7. mark the `links` projection as `fresh`

Important boundary rules:

- Linking persists `transaction_links` only.
- Pre-linking linkable movements are ephemeral runtime data.
- On failure, the projection is marked `failed`.

### Candidate Building

`buildLinkableMovements()` creates one linkable movement per inflow and outflow movement.

For every transaction:

- normalize blockchain hash when present
- reuse the persisted `txFingerprint` on the transaction
- reuse the persisted `movementFingerprint` on each inflow and outflow
- set `amount = netAmount ?? grossAmount`
- set `grossAmount` only when `netAmount` exists and differs from `grossAmount`

Structural trade exclusion:

- a transaction with at least one inflow and one outflow
- where inflow asset-symbol set and outflow asset-symbol set are disjoint
- is treated as a structural trade and marked `excluded=true`

Excluded linkable movements remain in the in-memory set but are not eligible for
strategy matching.

### Same-Hash Blockchain Reduction

Before ordinary matching, linking groups blockchain transactions by normalized
hash and then by `assetId`.

Only groups that span at least two transactions and at least two accounts are
considered.

Each participant is summarized with:

- total inflow gross amount for the asset
- total outflow gross amount for the asset
- inflow movement count
- outflow movement count
- same-asset on-chain fee amount

Reducer rules:

1. If a group has only pure outflow participants:
   - emit no internal links
   - apply no reductions
   - leave all ordinary linkable movements unchanged
   - later strategies may still consume the unchanged linkable movements for exact same-hash external-send matching
2. If any participant has both inflow and outflow for the same asset:
   - treat the group as ambiguous
   - log a warning
   - emit no internal links
   - apply no reductions
3. If a group has more than one pure outflow participant and at least one pure inflow participant:
   - treat the group as ambiguous
   - log a warning
   - emit no internal links
   - apply no reductions
4. If a group has exactly one pure outflow participant and one or more pure inflow participants:
   - require the sender to have exactly one outflow movement for that asset
   - require every receiver to have exactly one inflow movement for that asset
   - otherwise treat the group as ambiguous and skip it
5. For the clear internal case:
   - mark all participants as internal for linkable-movement metadata
   - create `blockchain_internal` links only for cross-account sender→receiver pairs
   - compute source reduction as:

```text
reduced source amount =
  sender outflow gross
  - total tracked inflow gross
  - deduplicated same-asset on-chain fee
```

Fee deduplication rule:

- deduplicated on-chain fee is the maximum same-asset on-chain fee seen across the group, not the sum

Internal-link materialization rule:

- the reducer first returns a fingerprint-less `PendingInternalLink`
- linking upgrades it to a persisted `NewTransactionLink` only after exactly one
  matching source movement and one matching target movement are found
- if either side is ambiguous, linking fails rather than persisting a partial link

### Strategy Matching

Ordinary strategies operate on non-internal cross-source linkable movements.

Default order:

1. `exact-hash`
2. `same-hash external outflow`
3. `counterparty-roundtrip`
4. `bridge-annotation`
5. `amount-timing`
6. `partial-match`

Bridge annotation rules:

- blockchain -> blockchain only
- source must carry asserted `bridge_participant` with `role='source'`
- target must carry asserted `bridge_participant` with `role='target'`
- annotations must remain compatible with existing asset-equivalence rules
- explicit chain-hint conflicts are a hard veto
- links are emitted as `suggested`, never `confirmed`

Hard filters:

- source and target cannot come from the same transaction
- source must be `direction='out'`; target must be `direction='in'`
- source and target must share `assetSymbol`
- linkable movements from the same `platformKey` are skipped
- explicit address mismatch is a hard veto
- timing must be within `[-clockSkewToleranceHours, maxTimingWindowHours]`
- confidence must meet `minConfidenceScore`

Scoring model:

- asset match base: `0.30`
- amount similarity: up to `0.40`
- valid timing: `0.20`
- close timing bonus (`<= 1h`): `0.05`
- address match bonus: `0.10`

Amount similarity is fee-aware:

1. compare `source.amount` vs `target.amount`
2. if needed, compare `source.grossAmount` vs `target.amount`
3. if needed, compare `source.amount` vs `target.grossAmount`

Hash-match fast path:

- if normalized hashes match and both sides are blockchain linkable movements, the pair is skipped here because same-hash blockchain handling owns that case
- if normalized hashes match and the pair is not blockchain→blockchain, the pair gets confidence `1.0`
- multi-target hash matches are allowed only when the summed target amount does not exceed the source amount

Same-hash external outflow fast path:

- only considers same-hash blockchain outflow groups with:
  - at least two source movements
  - at least two accounts
  - exactly one shared `toAddress`
  - zero or more tracked blockchain sibling inflows for the same `(hash, assetId, platformKey)`
- first resolves source capacity per source movement:
  - `deduped_shared_fee`
    - use source `grossAmount`
    - subtract the single shared same-hash fee exactly once from one deterministic fee-bearing source
  - `per_source_allocated_fee`
    - use each source movement's already fee-adjusted transfer amount
- then computes:

```text
group amount =
  total source capacity
  - tracked sibling inflow amount
```

- builds one synthetic group source for scoring only
- only proceeds when exactly one exchange inflow target matches that synthetic source with:
  - `amountSimilarity = 1.0`
  - and either:
    - the target shares the exact normalized blockchain hash
    - or the target has no blockchain hash and is the only exact-amount exchange inflow within `1 hour` after the grouped send
  - or exact target excess explained by one exact same-hash residual described below
- hashless exchange-target fallback is allowed only when:
  - the group has no tracked blockchain sibling inflows
  - the exchange target has no normalized blockchain hash
  - the exchange target amount equals the grouped send amount exactly
  - the target timestamp is after the grouped send and within `1 hour`
  - address evidence does not explicitly contradict the route
  - exactly one exchange inflow target satisfies those conditions
- hash-backed group matches remain eligible for `confirmed` or `suggested` status based on confidence
- hashless exact-amount/tight-timing fallback matches are always emitted as `suggested`
- exact explained residual is allowed only when:
  - the group has no tracked blockchain sibling inflows
  - the target is an exchange inflow
  - the target and all sources share the same normalized blockchain hash
  - the target excess equals the sum of unique `unattributed_staking_reward_component` diagnostics across the source transactions
- expands the accepted group match back into pairwise partial links using the chosen capacity plan
- uses the synthetic group match confidence and status for every expanded link
- mixed same-hash groups that also have tracked blockchain sibling inflows persist `sameHashMixedExternalGroup=true` and residual-allocation metadata on the expanded links

Counterparty roundtrip fast path:

- only considers blockchain outflow→inflow pairs
- source candidate must have a `toAddress` and target candidate must have a `fromAddress`
- source and target must be on the same `platformKey` and `accountId`
- source and target must have equivalent assets and equal amounts
- source `toAddress` must equal target `fromAddress`
- if both source `fromAddress` and target `toAddress` are present, they must also match
- target timestamp must be after source timestamp and within `30 days`
- accepted pairs are emitted as `blockchain_to_blockchain` links with confidence `1.0`

Bridge diagnostic fast path:

- only considers blockchain outflow→inflow pairs
- both sides must carry `bridge_transfer` diagnostics
- source and target must be on different `platformKey` values
- source and target assets must already be equivalent under normal linking semantics
- target timestamp must be after source timestamp, allowing at most `0.25h` clock skew and at most `24h` total lag
- chain-hint metadata may be absent, but if present it must not contradict the source/destination `platformKey`
- token bridges require amount similarity `>= 0.995` and target-over-source variance `<= 2%`
- native bridges require amount similarity `>= 0.7` and target-over-source variance `<= 35%`
- the pair must be mutually unique among all eligible bridge candidates
- accepted pairs are emitted as `blockchain_to_blockchain` links with `status='suggested'`

### Capacity Allocation And Partial Matches

Potential matches are sorted by:

1. confidence descending
2. hash matches before non-hash matches on ties

Allocation then applies greedy capacity consumption:

- each `(transactionId, assetSymbol)` source and target starts with capacity equal to its movement amount
- accepted matches consume `min(remainingSource, remainingTarget)`
- matches below `minPartialMatchFraction` of the larger original amount are rejected

Pure 1:1 restoration:

- if a source participates in exactly one accepted link and the target also participates in exactly one accepted link
- linking removes `consumedAmount`
- the persisted link uses original source and target amounts instead of the consumed partial amount

Actual splits and consolidations keep `consumedAmount` and persist partial-link metadata.

### Link Construction

`createTransactionLink()` validates and persists the matched pair.

Validation rules:

- `sourceAmount` and `targetAmount` must both be positive
- target cannot exceed source, except for hash matches where up to `1%` target excess is tolerated
- variance above `10%` is rejected

Persisted metadata rules:

- ordinary 1:1 links store `variance`, `variancePct`, and `impliedFee`
- partial links store:
  - `partialMatch=true`
  - `fullSourceAmount`
  - `fullTargetAmount`
  - `consumedAmount`
- same-hash external outflow expansions additionally store:
  - `sameHashMixedExternalGroup`
  - `sameHashExternalTargetEvidence`
  - `sameHashExternalFeeAccounting`
  - `sameHashExternalTotalFee`
  - `dedupedSameHashFee`
  - `feeBearingSourceTransactionId`
  - `sameHashExternalGroupAmount`
  - `sameHashExternalGroupSize`
  - `sameHashExternalSourceAllocations`
  - `sharedToAddress`
  - `sameHashTrackedSiblingInflowAmount`
  - `sameHashTrackedSiblingInflowCount`
  - `sameHashResidualAllocationPolicy`
  - `explainedTargetResidualAmount`
  - `explainedTargetResidualRole`
- counterparty roundtrip links additionally store:
  - `counterpartyRoundtrip=true`
  - `counterpartyRoundtripHours`
- bridge diagnostic links additionally store score breakdown only; they do not currently persist extra bridge-specific metadata
- score breakdown is stored when available
- hash-match target excess allowance is recorded in metadata when used

Downstream contract for exact explained residual metadata:

- transfer validation may accept the target-side partial group exactly when every expanded link carries the same explained residual amount and role
- `links gaps` may omit the residual from open transfer review when that explained residual is exact and fully accounts for the uncovered target amount
- the generic standard lot pipeline may materialize the exact residual as a separate acquisition lot on the target inflow when the role is transfer-ineligible but acquisition-relevant
- tax projection may classify the surviving unmatched inflow quantity using `explainedTargetResidualRole` instead of treating it as a generic unexplained acquisition

Status rules:

- links with confidence `>= autoConfirmThreshold` are persisted as `confirmed`
- lower-confidence accepted links are persisted as `suggested`
- `blockchain_internal` links are always `confirmed`

### Override Replay

Override replay runs after algorithmic matching and before persistence.

Only `scope='link'` and `scope='unlink'` events participate.

Projection rule:

- project the override stream by link fingerprint
- last event wins

Replay behavior:

- if an override fingerprint matches an algorithmic link, update that link's `status`, `reviewedBy`, and `reviewedAt`
- if a `link_override` payload also carries one exact explained target residual,
  replay must rematerialize that residual metadata onto the final confirmed
  link set
- if a final `reject` state has no matching algorithmic link, do nothing
- if a final `confirm` state resolves both transactions but no algorithmic link exists, return it as orphaned for linkable-movement-based materialization
- if transaction fingerprints cannot be resolved, log and mark the event unresolved

### Orphaned Confirmed Override Materialization

Confirmed orphaned overrides are materialized from the same linkable movement set used by
the matcher.

Required behavior:

1. resolve source and target transactions from override fingerprints
2. resolve the exact source outflow movement by `transactionId + direction='out' + sourceMovementFingerprint + sourceAssetId`
3. resolve the exact target inflow movement by `transactionId + direction='in' + targetMovementFingerprint + targetAssetId`
4. materialize only when both exact movements resolve
5. derive the persisted link type from the source and target `platformKind`
6. persist `sourceAssetId`, `targetAssetId`, `sourceAmount`, `targetAmount`, `sourceMovementFingerprint`, and `targetMovementFingerprint` from those resolved linkable movements
7. persist `status='confirmed'`, `confidenceScore=1`, and override metadata
8. otherwise log and skip materialization

Explicitly forbidden:

- zero-amount sentinel links
- missing asset ids
- missing movement fingerprints
- raw-movement fallback that bypasses linkable-movement shaping

## Data Model

### `transaction_links`

```sql
id INTEGER PRIMARY KEY,
source_transaction_id INTEGER NOT NULL,
target_transaction_id INTEGER NOT NULL,
asset TEXT NOT NULL,
source_asset_id TEXT NOT NULL,
target_asset_id TEXT NOT NULL,
source_amount TEXT NOT NULL,
target_amount TEXT NOT NULL,
source_movement_fingerprint TEXT NOT NULL,
target_movement_fingerprint TEXT NOT NULL,
link_type TEXT NOT NULL,
confidence_score TEXT NOT NULL,
match_criteria_json TEXT NOT NULL,
status TEXT NOT NULL,
reviewed_by TEXT NULL,
reviewed_at TEXT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
metadata_json TEXT NULL
```

Field semantics:

- `asset`: asset symbol used for matching and override fingerprints
- `source_asset_id`, `target_asset_id`: concrete source and target movement asset identities
- `source_amount`, `target_amount`: persisted link quantities after matching/allocation
- `source_movement_fingerprint`, `target_movement_fingerprint`: exact linked movement identities
- `match_criteria_json`: serialized runtime scoring criteria
- `metadata_json`: variance, partial-match audit fields, hash-match allowances, and score breakdown

## Pipeline / Flow

```mermaid
graph TD
    A["Processed transactions"] --> B["buildLinkableMovements()"]
    B --> C["Same-hash blockchain reduction"]
    C --> D["StrategyRunner"]
    D --> E["createTransactionLink()"]
    F["Override events"] --> G["applyLinkOverrides()"]
    E --> G
    B --> H["buildLinkFromOrphanedOverride()"]
    G --> H
    H --> I["Replace non-rejected transaction_links"]
    I --> J["Mark links projection fresh"]
```

## Invariants

- **Ephemeral pre-linking**: Linking does not require a persisted linkable-movement or shadow-movement table.
- **Strict persisted identity**: Every persisted link has both asset ids and both movement fingerprints.
- **Positive quantities**: Persisted `sourceAmount` and `targetAmount` are always positive.
- **Conservative same-hash handling**: Ambiguous same-hash blockchain groups never emit synthetic internal links.
- **Conservative hashless exchange fallback**: Same-hash external outflow groups may use a
  hashless exchange target only when one exact-amount, tight-timing candidate exists; otherwise
  the group remains unmatched.
- **Deterministic replay**: For the same transaction set and override log order, replay produces the same final link states.
- **Rejected links are not persisted**: `links run` saves only non-rejected links.

## Edge Cases & Gotchas

- **Same-account participants**: Same-hash internal reduction can still mark participants as internal and reduce the sender, but persisted `blockchain_internal` links are only emitted for cross-account pairs.
- **Hash-match target excess**: A small target-over-source excess is only tolerated for hash matches, and only up to `1%`.
- **Multi-output hash matches**: A source can hash-match multiple targets only when their summed target amount does not exceed the source amount.
- **Asset-symbol matching**: Strategy matching and override fingerprints still key off `assetSymbol`, even though persisted links carry both asset ids.
- **Append-order replay**: Override conflict resolution follows SQLite append order; it is not re-sorted by `created_at`.

## Known Limitations (Current Implementation)

- Ambiguous same-hash blockchain groups are intentionally left unmatched rather than approximated.
- Same-hash external outflow matching handles:
  - exact hash-backed exchange targets
  - exact hash-backed targets with one exact explained residual
  - one exact-amount, tight-timing hashless exchange target fallback
- broader grouped exchange routing without exact quantity equality still remains unmatched.
- Matching allocation is greedy, not globally optimal.
- Override fingerprints are still symbol-based; they do not yet use the stricter persisted asset-id pair.
- Movement fingerprints are stored as plain strings rather than a dedicated fingerprint schema/type.

## Related Specs

- [Transaction and Movement Identity](./transaction-and-movement-identity.md) — canonical processed identity contracts for `txFingerprint` and `movementFingerprint`
- [Override Event Store and Replay](./override-event-store-and-replay.md) — append-only override storage and replay rules
- [UTXO Address Model](./utxo-address-model.md) — raw per-address UTXO semantics feeding same-hash grouping
- [Transfers & Tax](./transfers-and-tax.md) — downstream tax treatment of confirmed links
- [CLI Links README](./cli/links/README.md) — user-facing link command surface

---

_Last updated: 2026-04-16_
