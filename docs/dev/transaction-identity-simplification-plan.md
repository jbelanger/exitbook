---
status: draft
last_updated: 2026-03-17
---

# Transaction Identity Simplification Plan

## Summary

This plan removes `externalId` entirely and makes `txFingerprint` the only transaction identifier used by the system.

The design goal is simplification, not flexibility:

- one processed transaction identifier: `txFingerprint`
- no `externalId`
- no replacement `sourceReference`
- no content-hash identity fallback in the final design
- no processor-owned ID strings

Canonical identity inputs become:

- blockchain transactions: mandatory `blockchain.transaction_hash`
- exchange transactions: the sorted set of grouped raw `event_id` values already persisted on `raw_transactions`

This refactor is allowed to be strict. If authoritative identity material is missing, processing should fail rather than silently invent an ID.

## Migration Status

Status as of 2026-03-17:

- the temporary core `externalId` compatibility field has been removed
- `packages/` and `apps/` are now clean of `externalId` / `external_id` references
- downstream tests that still assumed exchange- or processor-owned IDs have been updated to assert `txFingerprint` / `movementFingerprint` behavior directly

Verification completed for this slice:

- `pnpm build`
- `pnpm test`
- targeted package type checks for `packages/ingestion`, `packages/accounting`, `packages/data`, and `apps/cli`
- targeted Vitest coverage across 40 touched files: 552 tests passed
- full workspace Vitest suite: 5241 tests passed, 29 skipped

Remaining work:

- update remaining historical/spec documentation that still describes pre-`txFingerprint` identity semantics
- keep this document as the design/reference source until the broader migration is fully closed

## Why This Plan Exists

Today transaction identity is split across three concepts:

- provider-chosen `externalId`
- generated fallback IDs from `generateDeterministicTransactionHash()`
- persisted `txFingerprint`

That creates several problems:

- processors are forced to choose a transaction ID string
- repository writes accept both provider IDs and generated IDs
- downstream code sometimes recomputes fingerprints from `source + accountId + externalId`
- reports and CLI output use `externalId`, even though overrides and links use `txFingerprint`

The result is a codebase where transaction identity is conceptually simple but mechanically fragmented.

This plan collapses those paths into one:

- raw events have `event_id`
- processed transactions have `txFingerprint`
- movement identity continues to derive from `txFingerprint`

## Relationship To Existing Docs

This document supersedes the transaction-identity assumptions in `docs/dev/persisted-fingerprints-plan.md`.

That earlier document is still valid for:

- persisting `transactions.tx_fingerprint`
- persisting `transaction_movements.movement_fingerprint`
- keeping `transaction_movements.position`

This document changes the meaning and derivation of `tx_fingerprint`.

## Decision

Use `txFingerprint` as the only durable transaction identifier.

Specifically:

- remove `externalId` from processed transaction models
- remove `external_id` from persisted `transactions`
- compute transaction identity centrally during persistence
- treat `raw_transactions.event_id` as the raw-event identity input for exchange transaction fingerprints
- in this slice, use exchange `event_id` values exactly as imported today
- require blockchain processors to emit `blockchain.transaction_hash`
- export `txFingerprint` in cost-basis and transaction reports

## Override Store Impact

`overrides.db` is a separate durable database that survives `transactions.db` wipes. Override payloads (link, unlink, transaction-note, price) store fingerprint values directly. Since the fingerprint formula changes completely, all existing overrides become dangling references after this refactor.

Decision: wipe `overrides.db` when shipping this change. The database is dropped during development, so this has no practical impact. Document this in the safety checklist.

## Non-Goals

Out of scope for this slice:

- redesigning movement identity beyond the existing `movement:${txFingerprint}:${movementType}:${position}` shape
- adding a new `raw_transactions` identity column
- introducing a second user-facing transaction reference field
- deduplicating the same real-world exchange activity across different account records
- making CSV and API imports for different accounts share fingerprints automatically
- making exchange fingerprints invariant to removing overlapping duplicate CSV files
- canonicalizing KuCoin duplicate rows at the importer boundary

## Current State

### Raw Event Identity

Raw imported events already have account-scoped persistent identity:

- table: `raw_transactions`
- column: `event_id`
- unique constraint: `(account_id, event_id)`

Relevant files:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/raw-transaction-repository.ts`

### Processed Transaction Identity

Transaction fingerprints are currently derived from:

- `source`
- `accountId`
- `externalId`

Relevant files:

- `packages/core/src/override/override.ts`
- `packages/core/src/override/override-utils.ts`
- `packages/data/src/utils/transaction-id-utils.ts`

### Exchange Group Evidence Exists But Is Dropped

Exchange interpretation already knows which raw events formed a grouped transaction:

- `evidence.providerEventIds`

But that information is discarded before persistence because `materializeProcessedTransaction()` only keeps business fields and `externalId`.

Relevant files:

- `packages/ingestion/src/sources/exchanges/shared/exchange-interpretation.ts`
- `packages/ingestion/src/sources/exchanges/shared/materialize-processed-transaction.ts`

### Transaction Model Conflates Draft And Persisted Shapes

`packages/core/src/transaction/transaction.ts` currently uses one transaction field shape for:

- processor output before persistence
- persisted transaction reads

That shape currently includes:

- required `externalId`
- optional `txFingerprint`

Those semantics become backward once `txFingerprint` is the only real identifier.

## Desired End State

After this refactor:

- a raw event is identified by `raw_transactions.event_id`
- a processed transaction is identified only by `txFingerprint`
- a movement is identified only by `movementFingerprint`
- processors never construct a canonical transaction ID string
- reports, overrides, links, and cost basis all reference `txFingerprint`

The final v1 fingerprint values are opaque lowercase SHA-256 hex strings.

Canonical material for blockchain transactions:

```text
${accountFingerprint}|blockchain|${source}|${blockchainTransactionHash}
```

Canonical material for exchange transactions:

```text
${accountFingerprint}|exchange|${source}|${sortedComponentEventIds.join('|')}
```

Canonical output:

```text
txFingerprint = sha256(canonicalMaterial) // hex digest
```

SHA-256 hashing must use the Web Crypto API (`globalThis.crypto.subtle.digest`), not `node:crypto`, because `@exitbook/core` must remain runtime-agnostic (React Native target is planned). The `computeTxFingerprint` and `computeAccountFingerprint` helpers in core should accept/return `Promise<Result<string, Error>>` to accommodate the async Web Crypto API.

Where:

- `accountFingerprint` is a stable fingerprint of the account identity material, not the database `accounts.id`
- `sortedComponentEventIds` are the grouped raw `event_id` values for one exchange transaction, sorted before joining

Versioning rule:

- v1 fingerprints are unprefixed SHA-256 hex strings
- if the formula ever changes later, a future version may introduce an explicit prefix such as `tx2_`
- unprefixed historical values are treated as v1

v1 stability guarantee:

- blockchain fingerprints are stable across rebuilds as long as account identity and blockchain transaction hash are unchanged
- exchange fingerprints are stable across rebuilds from the same account and the same imported raw event set
- exchange v1 does not guarantee invariance when overlapping duplicate CSV files are later added or removed

## Core Design Rules

### 1. No `externalId`

There is no replacement `externalId` field.

There is also no replacement `sourceReference` field.

If a user or report needs to refer to a transaction, it should use:

- `txFingerprint`

### 2. Fail Closed

The write path must reject transactions when identity material is missing.

Required inputs:

- blockchain transaction: `blockchain.transaction_hash`
- exchange transaction: at least one grouped raw `event_id`

This is a financial system. The repository should return an error instead of silently generating a fallback identity.

### 3. Reuse Existing Raw Event IDs

Do not add a new `raw_transactions` field.

The existing `raw_transactions.event_id` already fills the raw-event identity role. This refactor should reuse it and tighten its contract.

For v1 exchange transaction fingerprints:

- use the full grouped `event_id` set
- sort it before hashing
- do not choose a single representative event ID
- do not add duplicate-insensitive cleanup logic in the fingerprint layer

That cleanup belongs, if needed later, at the importer/raw-event identity boundary.

### 4. `accountHash` Is Not `accountFingerprint`

`packages/data/src/utils/account-hash.ts` computes a projection freshness hash over current DB rows. It is not suitable for exported transaction identity because:

- it includes database `accounts.id`
- it is a graph-level freshness checksum, not a per-account stable identifier
- it changes for reasons unrelated to one account’s semantic identity

This plan introduces a separate `accountFingerprint` helper.

### 5. Account Scope Uses Existing Account Semantics

To keep this refactor small, `accountFingerprint` should be derived from the current account identity material:

- `accountType`
- `sourceName`
- `identifier`

Suggested canonical material:

```text
${accountType}|${sourceName}|${identifier.trim()}
```

Suggested fingerprint:

```text
sha256(canonicalMaterial).digest('hex')
```

Important consequence:

- if an `exchange-csv` account changes its directory path, that is treated as a different account identity

That matches the current account model and avoids introducing a second persistent account identity field in this slice.

## Implementation Plan

### 6. Fingerprint Logic Lives In Core Identity Code

Transaction and movement fingerprint logic should not live under `overrides`.

Overrides should consume canonical fingerprints, not define their core contract.

This refactor should move:

- `TransactionFingerprintInput`
- `MovementFingerprintInput`
- `computeTxFingerprint()`
- `computeMovementFingerprint()`

into a dedicated core identity module.

`computeResolvedLinkFingerprint()` may remain in override/link-specific code if it is still only used there.

## 0. Define The Contract Before Editing Code

Before making code changes, write the contract into comments/tests:

- `txFingerprint` is the only transaction identifier
- blockchain fingerprint input is `blockchain.transaction_hash`
- exchange fingerprint input is `componentEventIds`
- `raw_transactions.event_id` is the authoritative raw-event ID for exchange grouping
- repository writes fail if identity material is missing

Files:

- new file: `packages/core/src/identity/fingerprints.ts`
- `packages/data/src/utils/transaction-id-utils.ts`

Do this first so all later edits are mechanically consistent.

## 1. Introduce Stable `accountFingerprint`

Create a new helper dedicated to durable account identity.

Files:

- new file: `packages/data/src/utils/account-fingerprint.ts`
- `packages/data/src/adapters/processing-ports-adapter.ts`
- `packages/data/src/repositories/transaction-repository.ts`

Steps:

1. Add `computeAccountFingerprint(account)` in the new helper.
2. Use SHA-256, not the current `accountHash` helper.
3. Input fields:
   - `account.accountType`
   - `account.sourceName`
   - `account.identifier.trim()`
4. Return lowercase SHA-256 hex:
   - `${hexDigest}`
5. Do not persist `accountFingerprint` to the database in this slice.
6. Compute it on demand in the transaction write path.

Pseudo-code:

```ts
export async function computeAccountFingerprint(account: Account): Promise<string> {
  const material = `${account.accountType}|${account.sourceName}|${account.identifier.trim()}`;
  const encoded = new TextEncoder().encode(material);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

Implementation note:

- do not reuse `computeAccountHash()` from `packages/data/src/utils/account-hash.ts`
- use Web Crypto API (`globalThis.crypto.subtle`), not `node:crypto` — core must stay runtime-agnostic

## 2. Split Persisted Transaction Shape From Processor Output

Cleanly separate “business transaction data before persistence” from “persisted transaction with identity”.

Files:

- `packages/core/src/transaction/transaction.ts`
- `packages/ingestion/src/shared/types/processors.ts`
- `packages/ingestion/src/ports/processed-transaction-sink.ts`

Required changes:

1. In core transaction types:
   - remove `externalId`
   - make persisted `txFingerprint` required
   - introduce a base transaction-data schema with no transaction ID fields
2. In ingestion:
   - stop aliasing `ProcessedTransactionSchema = TransactionDraftSchema`
   - create an ingestion-specific processed transaction shape that contains:
     - business transaction data
     - transient identity material used only before persistence

Recommended ingestion shape:

```ts
interface ProcessedTransactionIdentityMaterial {
  componentEventIds?: string[] | undefined; // exchange only
}

interface ProcessedTransaction {
  transaction: TransactionData;
  identityMaterial?: ProcessedTransactionIdentityMaterial | undefined;
}
```

Why use an envelope instead of adding fields to the core transaction schema:

- it keeps transient persistence-only identity material out of persisted `Transaction`
- it avoids reintroducing a disguised replacement for `externalId`
- it makes the repository boundary explicit

Implementation note for junior dev:

- this is the most invasive type-shape change in the refactor
- do not mix this change with UI cleanup
- land the new type shape and compiler fixes first

## 3. Remove `externalId` From Exchange Interpretation

Exchange processors should stop choosing a transaction ID string.

Files:

- `packages/ingestion/src/sources/exchanges/shared/exchange-interpretation.ts`
- `packages/ingestion/src/sources/exchanges/shared/materialize-processed-transaction.ts`
- `packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts`
- `packages/ingestion/src/sources/exchanges/kucoin/interpret-group.ts`
- `packages/ingestion/src/sources/exchanges/coinbase/interpret-group.ts`
- `packages/ingestion/src/sources/exchanges/shared/processing-result.ts`

Detailed steps:

1. Remove `externalId` from `ConfirmedExchangeTransactionDraft`.
2. Keep `evidence.providerEventIds`.
3. In `materializeProcessedTransaction()`:
   - build the business transaction object without any transaction ID
   - populate `identityMaterial.componentEventIds` from `draft.evidence.providerEventIds`
4. Sort `providerEventIds` before storing them in `identityMaterial`.
5. Remove logic that chooses one provider event ID or correlation key as a processed transaction ID.

Pseudo-code:

```ts
return {
  transaction: {
    datetime: new Date(draft.timestamp).toISOString(),
    timestamp: draft.timestamp,
    source: draft.source,
    sourceType: 'exchange',
    status: draft.status,
    movements: ...,
    fees: ...,
    operation: draft.operation,
    ...
  },
  identityMaterial: {
    componentEventIds: [...new Set(draft.evidence.providerEventIds)].sort(),
  },
};
```

Important design rule:

- `group.correlationKey` may still be useful for diagnostics, but it must not become the canonical transaction ID

## 4. Remove `externalId` From Blockchain Processors

Blockchain processors should emit business transaction data only. Their identity is the mandatory blockchain hash.

Files:

- `packages/ingestion/src/sources/blockchains/shared/correlated-transaction-processor.ts`
- `packages/ingestion/src/sources/blockchains/bitcoin/processor.ts`
- `packages/ingestion/src/sources/blockchains/cardano/processor.ts`
- `packages/ingestion/src/sources/blockchains/cosmos/processor.ts`
- `packages/ingestion/src/sources/blockchains/near/processor.ts`
- `packages/ingestion/src/sources/blockchains/solana/processor.ts`
- `packages/ingestion/src/sources/blockchains/substrate/processor.ts`
- `packages/ingestion/src/sources/blockchains/xrp/processor.ts`

Detailed steps:

1. Remove `externalId` assignments from processed transaction objects.
2. Update log messages that print `processedTransaction.externalId`.
3. Ensure every blockchain processed transaction includes:
   - `sourceType: 'blockchain'`
   - `blockchain.transaction_hash`
4. Add explicit guardrails:
   - if a blockchain processor cannot populate `blockchain.transaction_hash`, return `err(...)`

Do not leave any blockchain path using content-derived identity.

## 5. Move And Replace `computeTxFingerprint()` Inputs

Update canonical fingerprint computation so it no longer accepts `externalId`.

Files:

- new file: `packages/core/src/identity/fingerprints.ts`
- `packages/core/src/override/override.ts`
- `packages/core/src/override/override-utils.ts`

Replace:

```ts
interface TransactionFingerprintInput {
  source: string;
  accountId: number;
  externalId: string;
}
```

With:

```ts
interface TransactionFingerprintInput {
  accountFingerprint: string;
  source: string;
  sourceType: 'blockchain' | 'exchange';
  blockchainTransactionHash?: string | undefined;
  componentEventIds?: string[] | undefined;
}
```

Implementation rules:

1. Move `TransactionFingerprintInput`, `MovementFingerprintInput`, `computeTxFingerprint()`, and `computeMovementFingerprint()` into `packages/core/src/identity/fingerprints.ts`.
2. Blockchain branch:
   - require `blockchainTransactionHash`
   - build canonical material:
     - `${accountFingerprint}|blockchain|${source}|${blockchainTransactionHash}`
   - return SHA-256 hex via Web Crypto (`globalThis.crypto.subtle.digest`)
3. Exchange branch:
   - require `componentEventIds`
   - trim and sort them
   - reject blank component event IDs
   - do not dedupe them
   - build canonical material:
     - `${accountFingerprint}|exchange|${source}|${sortedComponentEventIds.join('|')}`
   - return SHA-256 hex via Web Crypto (`globalThis.crypto.subtle.digest`)
4. Reject:
   - empty `accountFingerprint`
   - empty `source`
   - missing blockchain hash for blockchain transactions
   - empty component event IDs for exchange transactions

Implementation note:

- v1 `txFingerprint` values are unprefixed SHA-256 hex
- if the formula ever changes in the future, later versions may add an explicit prefix such as `tx2_`
- keep `computeResolvedLinkFingerprint()` in override/link code if it remains override-specific
- movement fingerprints will automatically follow the new `txFingerprint`

## 6. Replace `materializeTransactionIdentity()` With Central Derivation

The repository write path becomes the single place where processed transaction identity is finalized.

Files:

- `packages/data/src/utils/transaction-id-utils.ts`
- `packages/data/src/index.ts`

Detailed steps:

1. Delete `generateDeterministicTransactionHash()` after all callers are removed.
2. Delete `materializeTransactionIdentity()`.
3. Replace them with a new helper that accepts:
   - `accountFingerprint`
   - the pre-persistence processed transaction envelope
4. Branch by `transaction.sourceType`:
   - blockchain => fingerprint from `blockchain.transaction_hash`
   - exchange => fingerprint from `identityMaterial.componentEventIds`
5. Return only:
   - `txFingerprint`

Suggested helper name:

- `deriveProcessedTransactionFingerprint`

Pseudo-code:

```ts
export function deriveProcessedTransactionFingerprint(
  input: PersistableProcessedTransaction,
  accountFingerprint: string
): Result<string, Error> {
  if (input.transaction.sourceType === 'blockchain') {
    const hash = input.transaction.blockchain?.transaction_hash;
    return computeTxFingerprint({
      accountFingerprint,
      source: input.transaction.source,
      sourceType: 'blockchain',
      blockchainTransactionHash: hash,
    });
  }

  return computeTxFingerprint({
    accountFingerprint,
    source: input.transaction.source,
    sourceType: 'exchange',
    componentEventIds: input.identityMaterial?.componentEventIds,
  });
}
```

## 7. Remove `external_id` From The Transactions Table

Once all write/read paths use only `txFingerprint`, remove the DB column.

Files:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/transaction-repository.ts`

Detailed steps:

1. Remove `external_id` from `TransactionsTable`.
2. Remove the column definition from `001_initial_schema.ts`.
3. Remove all row mapping code that reads or writes `external_id`.
4. Update `TransactionSummary` to remove `externalId`.
5. Keep `tx_fingerprint` indexed and unique.

Because this repo rebuilds from `001_initial_schema.ts` during development:

- do not write a compatibility layer for rows with and without `external_id`
- do not add an incremental migration

## 8. Update Transaction Repository Write Logic

The repository becomes the sole owner of transaction identity derivation.

Files:

- `packages/data/src/repositories/transaction-repository.ts`

Functions to update:

- `buildInsertValues`
- `resolveExistingTransactionConflict`
- `TransactionRepository/create`
- `TransactionRepository/createBatch`
- `toTransactionSummary`
- full row-to-domain materialization paths

Detailed step order:

1. Change `buildInsertValues()` to accept:
   - the processed transaction envelope
   - `accountFingerprint`
   - `createdAt`
2. Compute `txFingerprint` via the new central helper.
3. Insert the row without `external_id`.
4. Pass the persisted `txFingerprint` into `buildMovementRows()`.
5. Remove all logging strings referencing `transaction.externalId`.
6. Remove any fallback path that tries to recover identity using generated external IDs.

Conflict handling rules:

1. Look up existing rows by `tx_fingerprint`.
2. If the row exists, treat it as the same processed transaction.
3. For blockchain transactions:
   - if the existing row’s blockchain hash differs from the incoming hash, return an error
4. Do not retain the old “fingerprint miss, blockchain hash fallback lookup” behavior after this refactor lands.

Why no fallback:

- the new fingerprint derivation is authoritative
- a mismatch means the identity contract is wrong or the upstream data changed
- silently reconciling mismatched identities would reintroduce ambiguity

## 9. Follow-Up Phase: Canonicalize Exchange `event_id` For Duplicate-Insensitive Rebuilds

This is explicitly not part of the main `txFingerprint` simplification refactor.

The main refactor should ship first using current `event_id` semantics.

This follow-up phase exists only if we decide exchange fingerprints must remain stable even when overlapping duplicate CSV files are later removed or re-imported differently.

This step does not add schema. It hardens the meaning of existing `event_id`.

Files:

- `packages/ingestion/src/sources/exchanges/kucoin/importer.ts`
- `packages/ingestion/src/sources/exchanges/kraken/normalize-provider-event.ts`
- `packages/ingestion/src/sources/exchanges/coinbase/normalize-provider-event.ts`
- any exchange importer/normalizer that constructs or passes `eventId`

Required contract for exchange `event_id`:

- deterministic across repeated imports of the same source artifact
- unique within the account
- stable enough to be used as input to grouped transaction fingerprints independent of duplicate CSV artifact overlap

Specific caution:

- KuCoin CSV currently synthesizes some event IDs and appends duplicate counters

What changes in this follow-up:

- exact duplicate raw rows should collapse to the same canonical `event_id`
- importer logic should own duplicate-insensitive cleanup
- transaction fingerprint derivation should remain simple and continue hashing the full grouped event set

What must not happen in this follow-up:

- do not strip duplicate component event IDs during fingerprint derivation
- do not pick one arbitrary event ID as the representative transaction ID

Required tests:

- repeated import of the same CSV rows yields the same `event_id`
- exact duplicate rows collapse to the same canonical `event_id`
- file discovery order and row order do not accidentally change canonical `event_id` assignment
- removing an overlapping duplicate CSV file does not change the resulting exchange `txFingerprint`

Do not add a new raw-event column unless this contract proves impossible to satisfy.

## 10. Replace Downstream `externalId` Usage With `txFingerprint`

This is a cleanup phase after the core write path compiles.

### CLI Transaction Views And Commands

Files:

- `apps/cli/src/features/transactions/command/transactions-export-utils.ts`
- `apps/cli/src/features/transactions/command/transactions-edit-note.ts`
- `apps/cli/src/features/transactions/command/transactions-edit-handler.ts`
- `apps/cli/src/features/transactions/command/transactions-view-utils.ts`
- `apps/cli/src/features/transactions/view/transactions-view-state.ts`

Changes:

- remove `externalId` fields from view state and command results
- print `txFingerprint` when the CLI needs a transaction reference
- update transaction export columns to use `txFingerprint`

### Links UI And Gap Analysis

Files:

- `apps/cli/src/features/links/command/links-gap-utils.ts`
- `apps/cli/src/features/links/command/links-view-utils.ts`
- `apps/cli/src/features/links/view/links-view-components.tsx`

Changes:

- replace `externalId` display/reference fields with `txFingerprint`

### Accounting / Cost Basis

Files:

- `packages/accounting/src/cost-basis/export/tax-package-builder-shared.ts`
- `packages/accounting/src/cost-basis/export/tax-package-readiness-metadata.ts`
- `packages/accounting/src/cost-basis/standard/matching/build-cost-basis-scoped-transactions.ts`
- `packages/accounting/src/cost-basis/standard/validation/price-validation.ts`

Changes:

1. Export `txFingerprint` directly in reports.
2. Remove logic that prefers `externalId` for exchange transactions.
3. In `build-cost-basis-scoped-transactions.ts`, stop recomputing `txFingerprint` from `source + accountId + externalId`.
4. Use persisted `tx.txFingerprint` and fail if it is absent.

Important note:

- once this refactor lands, cost-basis exports should treat `txFingerprint` as the durable exported reference for the rebuilt raw dataset used to produce the report
- duplicate-insensitive exchange rebuild stability is a follow-up phase, not part of this slice

## 11. Update Tests In Layers

Do not attempt to update all tests at once. Use this order.

### Core fingerprint tests

Files:

- `packages/core/src/override/__tests__/...`
- `packages/data/src/utils/__tests__/transaction-id-utils.test.ts`

Add tests for:

- blockchain fingerprint from tx hash
- exchange fingerprint from sorted component event IDs
- order independence of event ID lists
- rejection of missing blockchain hash
- rejection of missing exchange event IDs

### Repository tests

Files:

- `packages/data/src/repositories/__tests__/transaction-repository.test.ts`
- `packages/data/src/repositories/__tests__/helpers.ts`

Add/update tests for:

- duplicate detection by `tx_fingerprint`
- conflict errors when blockchain hash mismatches an existing fingerprint
- no `external_id` persistence

### Ingestion tests

Files:

- exchange processor tests
- blockchain processor tests
- KuCoin importer tests

Add/update tests for:

- exchange processed transactions carry grouped component event IDs
- blockchain processed transactions omit `externalId`
- stable KuCoin CSV `event_id` generation

### Accounting / CLI tests

Update snapshots and assertions to expect `txFingerprint` instead of `externalId`.

## 12. Delete Dead Code Last

Only after all callers are updated:

- remove `externalId` from core transaction schemas
- remove `generateDeterministicTransactionHash()`
- remove `materializeTransactionIdentity()`
- remove `external_id` DB column
- remove tests/helpers whose only purpose was seeding `externalId`

Do not delete the old helpers before the repository write path and downstream compiler errors are already green.

## Suggested Step-By-Step Execution Order

This order is deliberate. Follow it to reduce churn.

1. Add `accountFingerprint` helper.
2. Introduce the core identity module and change `computeTxFingerprint()` to the new hash-based contract.
3. Split core transaction data from persisted transaction shape.
4. Introduce the ingestion processed-transaction envelope with transient identity material.
5. Update exchange interpretation/materialization to pass grouped event IDs instead of `externalId`.
6. Remove `externalId` from blockchain processor outputs.
7. Replace repository identity derivation and transaction inserts.
8. Remove `external_id` from schema and row mappers.
9. Update downstream CLI/accounting/reporting code to use `txFingerprint`.
10. Delete dead code and old tests.
11. Optional follow-up: canonicalize exchange `event_id` semantics for duplicate-insensitive rebuilds.

## Safety Checklist

The refactor is safe to merge only when all of the following are true:

- no production code references `transaction.externalId`
- no production code recomputes `txFingerprint` from `source + accountId + externalId`
- blockchain writes fail if `blockchain.transaction_hash` is missing
- exchange writes fail if grouped component event IDs are missing
- exchange fingerprint derivation hashes the full grouped event ID set and does not choose a representative event ID
- cost-basis export includes `txFingerprint`
- transaction CLI views can locate and display transactions using `txFingerprint`
- repository duplicate detection uses the new `txFingerprint` formula only
- `overrides.db` has been wiped (old fingerprints are incompatible with the new formula)
- no `node:crypto` imports in `@exitbook/core` — fingerprint hashing uses Web Crypto API

## Decisions Captured By This Plan

- `txFingerprint` is the only processed transaction identifier
- `raw_transactions.event_id` is reused as the exchange raw-event identity input
- no new `raw_transactions` identity column is added
- no content-hash fallback remains in the final design
- no `externalId` replacement field is introduced
- exported cost-basis references use `txFingerprint`
- account scope is derived from `accountType + sourceName + identifier`
- v1 `txFingerprint` values are unprefixed SHA-256 hex strings
- fingerprint helpers/types move out of `overrides` and into a core identity module
- exchange v1 fingerprints use the grouped raw `event_id` set exactly as imported
- duplicate-insensitive exchange raw-event canonicalization is deferred to a follow-up phase
- `overrides.db` must be wiped when this change ships (old fingerprints are incompatible)
- SHA-256 hashing uses Web Crypto API (`globalThis.crypto.subtle`), not `node:crypto`, to keep `@exitbook/core` runtime-agnostic

## Naming Notes

Names that should improve during this refactor:

- `externalId` should be deleted, not renamed
- `generateDeterministicTransactionHash()` should be deleted rather than preserved under a misleading name
- `providerEventIds` is acceptable for the current exchange interpretation layer, but if it becomes a broader cross-provider concept, `componentEventIds` is a clearer name for the grouped raw-event set that defines an exchange transaction
- fingerprint values themselves should be opaque hashes, not long human-readable composite strings
