---
last_verified: 2026-04-22
status: deferred
derived_from:
  - ../transaction-semantics-architecture-2026-04-22.md
deferred_by:
  - ../accounting-ledger-rewrite-plan-2026-04-23.md
---

# Semantic Facts And Evolution

Implementation from this contract is deferred pending the accounting ledger
rewrite. Re-evaluate this document after the processor-to-accounting boundary
lands.

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

The canonical v1 reconciler emitter identity is:

- `emitter_lane: 'reconciler'`
- `emitter_id: 'ledger_override_sync'`
- `evidence: 'asserted'`

Duplicate-authorship enforcement keys on `(emitter_lane, emitter_id)`, so this
name is load-bearing: reconciler writes must use exactly this id, and no other
lane may author facts under it.

V1 uses reconciler lane only for the ledger/semantics `staking_reward`
invariant. The lane remains narrow until a second invariant-driven semantic
workflow exists; any new reconciler workflow must register its own
`emitter_id` through kind-definition / workflow review before shipping.

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

### Canonical target serialization

`target` is serialized as exactly one of these shapes, with no other keys:

- `{ "scope": "transaction", "tx_fingerprint": "<...>" }`
- `{ "scope": "movement", "movement_fingerprint": "<...>" }`

### Hash recipe

`fact_fingerprint` is:

- the lowercase hex SHA-256 digest of the UTF-8 bytes of one canonical JSON
  object with exactly these fields:
  - `kind`
  - `kind_version`
  - `target`
  - `protocol_ref`
  - `counterparty_ref`
  - `role`
  - `group_key`
  - `metadata`
- prefixed as `semantic_fact:v1:<sha256_hex>`

`group_key` for grouped post-processor facts is:

- the lowercase hex SHA-256 digest of the UTF-8 bytes of the canonical JSON
  array of the sorted, deduped `derived_from_tx_fingerprints` set
- prefixed as `semantic_group:v1:<sha256_hex>`

Single-subject facts write `group_key: null`.

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

Every kind is owned by one definition module within the transaction semantics
capability. The exact package or path is non-binding; kind ownership is
architectural, not a package-placement shortcut.

Each definition must declare:

- `kind`
- `kind_version`
- `scope`
- allowed `role` values
- `metadata_schema`
- `label_projection`, which is either `none` or a typed contribution to the
  primary operation label (`group` + canonical `label_key`)
- `primary_label_precedence`, which is a number when the kind may drive the
  primary label and `null` otherwise
- `grouping_mode`, which is `single_subject` or `groupable_correlated`
- `supersession`, which declares whether grouped facts suppress the
  single-subject meaning for canonical reads

The central registry is the composition point, but kind ownership stays local to
the definition module.

### Adding a new kind

Adding a new kind requires:

1. a new kind definition module
2. registration in the central kind registry
3. metadata schema tests
4. explicit `label_projection` decision
5. explicit `primary_label_precedence` decision if it can drive the primary
   label
6. explicit `grouping_mode` / `supersession` decision
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
- V1 processor-lane `asset_migration` is intentionally one-sided: at most one
  fact per transaction, with `role: 'source'` or `role: 'target'`. Even when
  one transaction contains both the old-asset send leg and the new-asset
  receive leg, processors do **not** emit two same-kind `asset_migration`
  facts for that one transaction in v1. Same-transaction dual-leg migrations
  wait for a later schema that names specific `movement_fingerprint` values.

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

### Three-case sanity check

Any change to the grouping contract must still cleanly cover all three of these
cases. If any case needs a special path in the contract, stop and re-examine
before shipping — the model is not yet greenfield-clean.

- **Bridge pair.** Two txs on two chains, one post-processor fact per tx, both
  sharing a `group_key` derived from the pair's `derived_from` set.
- **Asset migration.** N txs (old-asset withdrawal + new-asset deposits), N
  facts sharing a `group_key` derived from the set.
- **Accounting-role correction.** A user sets a movement's `accounting_role`
  to `staking_reward`. This remains a ledger-owned override keyed by
  `movement_fingerprint` and materialized back onto movement state before
  accounting or linking reads. It is not a semantic fact on its own and does
  not touch the grouping contract at all; reconciler-authored semantic facts
  carry `group_key: null`.

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
