---
last_verified: 2026-04-22
status: active
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
---

# Semantic Facts And Evolution

## Semantic Fact Row

Each semantic fact is a typed persisted row with:

- `kind`
- `kind_version`
- `target`
- `evidence`
- optional `role`
- optional `protocol_ref`
- optional `counterparty_ref`
- optional `group_key`
- optional `correlation_key`
- `emitter_lane`
- `emitter_id`
- `derived_from_tx_fingerprints`
- `metadata`

Core meanings:

- `kind` is the stable semantic family key
- `kind_version` is the identity-bearing payload version for that family
- `target` is the durable subject ref
- `evidence` is `asserted` or `inferred`
- `emitter_lane` explains who authored the fact

## Targets

V1 semantic-fact targets are:

- transaction
- non-fee asset movement

V1 does not target fee rows.

That is a shipping constraint, not a permanent model limit. Future `fee` scope
is reserved explicitly; it is not silently forbidden.

## Emitter Lanes

V1 lanes are:

- `processor`
- `post_processor`
- `reconciler`

### Lane meanings

- `processor`: source-local authoring from one transaction or raw record
- `post_processor`: cross-transaction or profile-scoped authoring over
  persisted state
- `reconciler`: system-authored semantic facts emitted from already-persisted
  state in order to preserve a durable cross-channel invariant

`ledger_override_sync` belongs to `reconciler`, not to `post_processor`.

V1 uses reconciler lane only for the ledger/semantics `staking_reward`
invariant. The lane remains narrow until a second invariant-driven semantic
workflow exists.

## Identity And Fingerprinting

`fact_fingerprint` is deterministic from:

- `kind`
- `kind_version`
- target ref
- `protocol_ref`
- `counterparty_ref`
- `role`
- `group_key`
- canonicalized `metadata`

Explicitly excluded from identity:

- `evidence`
- `emitter_lane`
- `emitter_id`
- `derived_from_tx_fingerprints`
- `correlation_key`
- DB ids
- timestamps

### Canonicalization rules

- fingerprinted values must be plain JSON values only
- `undefined`, `Date`, `Decimal`, `Map`, `Set`, `bigint`, functions, and
  non-finite numbers are invalid
- object keys use recursive lexicographic ordering
- arrays preserve authored order
- strings are serialized exactly after any per-kind normalization
- identity-sensitive decimals should be strings, not floats
- canonical empty metadata is `{}` exactly

### Envelope version

The common fingerprint envelope remains `semantic_fact:v1:<sha256_hex>`.

That envelope version covers shared serialization and target encoding rules.
It does not replace per-kind evolution.

### Per-kind versioning

Every kind definition owns a `kind_version`.

Rules:

- `kind_version` starts at `1`
- any identity-bearing metadata or target-contract change bumps
  `kind_version`
- `kind_version` participates in `fact_fingerprint`
- non-identity additive data must not be smuggled into fingerprinted metadata
  without a version decision
- a `kind_version` bump requires an explicit migration note

This is the main evolution contract that was missing from the source note.

## Reserved Refs

### `protocol_ref`

Shape:

- `{ id: string; version?: string }`

Rules:

- `version` may be set only when `id` is set
- chain is not encoded in `protocol_ref`
- null-to-populated backfill is an identity migration, not silent enrichment

### `counterparty_ref`

Shape:

- `{ id: string; kind: 'protocol' | 'validator' | 'exchange' | 'exchange_endpoint' | 'address' }`

Rules:

- ids must be globally namespaced
- `address` ids carry chain namespace
- `exchange_endpoint` is for specific deposit/withdraw endpoints
- null-to-populated backfill is an identity migration

### Chain-specific deployment identity

If later semantics need both a protocol family and a chain/deployment context,
that should be modeled as a separate typed ref such as a future
`protocol_deployment_ref`.

It should not be smuggled into `kind` naming.

## Kind Naming Rule

`kind` is a small global semantic family key.

Rules:

- do not chain-namespace kinds with ad hoc strings such as `cosmos:redelegate`
- do not encode provider or chain identity in the `kind` string itself
- put chain/protocol-specific detail in typed metadata or typed refs
- add a new kind only when the behavior matters as a durable semantic family
  across consumers

That keeps the global semantic vocabulary small and avoids string parsing
conventions becoming architecture.

## Kind Definition Contract

Every kind is owned by one definition module in `transaction-semantics/kinds/`.

Each definition must declare:

- `kind`
- `kind_version`
- `scope`
- allowed `role` values
- `metadata_schema`
- `label_behavior`
- precedence participation
- grouping mode
- supersession behavior

The central registry is the composition point, but kind ownership stays local to
the definition module.

### Adding a new kind

Adding a new kind requires:

1. a new kind definition module
2. registration in the central kind registry
3. metadata schema tests
4. explicit label contribution decision
5. explicit precedence decision if it can drive the primary label
6. explicit grouping decision
7. explicit migration note if the change affects persisted identity

This is the canonical extension contract. No hidden additional touch points
should exist.

## V1 Kinds

### Actions

- `bridge`
- `swap`
- `wrap`
- `unwrap`
- `staking_deposit`
- `staking_withdrawal`
- `staking_reward`
- `protocol_deposit`
- `protocol_withdrawal`
- `airdrop_claim`
- `asset_migration`

### Negative signals

- `spam_inbound`
- `phishing_approval`
- `dust_fanout`

Negative-signal kinds use the same kind-definition contract as action kinds.
They are not a second extension system.

## V1 Scope And Payload Matrix

| Kind(s)                                                                                                      | Scope         | Allowed `role`       | Metadata schema (v1)                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------- | -------------------- | ----------------------------------------------------- |
| `bridge`                                                                                                     | `transaction` | `source` \| `target` | `{ sourceChain?: string; destinationChain?: string }` |
| `asset_migration`                                                                                            | `transaction` | `source` \| `target` | `{ providerSubtype?: string }`                        |
| `swap`, `wrap`, `unwrap`, `staking_deposit`, `staking_withdrawal`, `protocol_deposit`, `protocol_withdrawal` | `transaction` | none                 | `{}`                                                  |
| `airdrop_claim`, `spam_inbound`, `phishing_approval`, `dust_fanout`                                          | `transaction` | none                 | `{}`                                                  |
| `staking_reward`                                                                                             | `movement`    | none                 | `{}`                                                  |

Additional rules:

- `bridge` chain hints are directional context only
- counterpart tx refs and external batch ids do not belong in bridge metadata
- `asset_migration.providerSubtype` is descriptive only
- future exact leg attribution must use explicit `movement_fingerprint` fields
  in the schema, not ad hoc blobs

### Movement scope

V1 ships only one movement-scoped kind: `staking_reward`.

That is a shipping constraint, not a permanent ban. A future movement-scoped
kind is valid when:

- exact leg attribution is required by downstream consumers, and
- the kind definition explicitly documents any ledger/semantic invariant or read
  path impact

## Groupable Correlated Kinds

`bridge` and `asset_migration` both use the same reusable pattern:

- processors may author single-transaction facts with `group_key: null`
- post-processors may author grouped correlated facts across transactions
- canonical reads suppress the processor-lane single-transaction meaning when a
  non-dismissed grouped fact exists for the same transaction

This is a generic `groupable_correlated` kind behavior, not two unrelated
special cases.

Kinds that opt into it must declare:

- grouped/non-grouped authoring shapes
- grouped supersession rule
- role rules
- any single-transaction restrictions

## Grouping Contract

Grouped facts use:

- `derived_from_tx_fingerprints` as the minimal support set
- `group_key` as deterministic group identity from that set
- `correlation_key` only for non-identity display/debug correlation

Rules:

1. `derived_from_tx_fingerprints` is sorted and deduped
2. `group_key` is deterministic from the canonical support set
3. `group_key` is interpreted in the scope of `emitter_id`
4. `correlation_key` does not drive identity, invalidation, or replacement
5. post-processor persistence is reconcile-not-append within explicit evaluated
   scope

`group_key` identifies a lifecycle cohort, not internal topology. If a future
grouped kind needs ordering or structure, that must be encoded in the kind's
typed fields, not forced into group identity.

## Duplicate Authorship

Duplicate authorship fails closed.

The store may replace an existing row for the same `fact_fingerprint` only when
the existing row has the same `(emitter_lane, emitter_id)`.

If a different author reaches the same fingerprint, ingestion aborts the
enclosing transaction with a deterministic duplicate-authorship error.

## Fee Semantics Boundary

V1 keeps fee semantics ledger-owned.

That means:

- semantic facts do not target fee rows yet
- fee meaning that only affects accounting stays in the fee schema
- fee meaning that would answer "what happened?" at semantic scope waits for an
  explicit future `fee`-scope fact contract

This preserves the current v1 boundary while keeping the future extension seam
open for burns, rebates, sponsored gas, refunds, or non-native fee semantics.
