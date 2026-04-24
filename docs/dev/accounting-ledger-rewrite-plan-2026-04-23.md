---
last_verified: 2026-04-23
status: active
---

# Accounting Ledger Rewrite Plan

## Goal

Rewrite the transaction/accounting base around processor-authored accounting
journals and postings.

The current `transactions` plus `transaction_movements` model is a useful
source-normalized activity shape, but it is too generic to be the primary
processor contract. Processors know chain- and exchange-specific accounting
cues that are later reconstructed through `movementRole`, diagnostics,
annotations, same-hash preparation, transfer links, and semantic mirrors.

The target model removes that lossy middle layer:

```text
raw_transactions -> source_activities -> accounting_journals -> accounting_postings
                                      -> accounting_journal_relationships
                                      -> accounting_overrides
```

Processors emit accounting journal drafts directly. Accounting validates,
canonicalizes, persists, and applies user accounting-judgment overrides.
Consumers read journals/postings, not generic movement rows.

## Current Direction

- Pause transaction-semantics implementation work.
- Keep the transaction-semantics documents as historical design input.
- Re-evaluate those documents after the accounting ledger rewrite lands.
- Drop existing `transaction_annotations` persistence during the rewrite. Do
  not migrate that table forward just to preserve deferred semantic work;
  re-emit any still-useful non-accounting semantics after the ledger model
  lands.
- Do not persist the current `packages/accounting/src/accounting-model` shape
  unchanged unless the processor-v2 pilot proves that it is still the cleanest
  contract.
- Use the processor-v2 path as a shadow path first. Journal/posting schema can
  exist as a disposable draft, but consumers must not read it and the processing
  pipeline must not depend on it until the draft contract survives hard
  processor pilots.
- Pull the schema draft forward before the first processor-v2 pilot. The dev DB
  is disposable, so schema churn is cheap and should be used to force the real
  persistence decisions early.
- Treat shadow `balance-v2` reconciliation as a migration gate. Do not cut
  accounting consumers over to the ledger model until a ledger-backed balance
  runner can execute in parallel against the same processed transaction scopes
  and reconcile diffs intentionally.

## Current Surfaces

Relevant write and processing files today:

- [raw-transaction-repository.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/raw-transaction-repository.ts)
- [transaction-repository.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/transaction-repository.ts)
- [transaction-persistence-support.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/transaction-persistence-support.ts)
- [transaction-materialization-support.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/transaction-materialization-support.ts)
- [database-schema.ts](/Users/joel/Dev/exitbook/packages/data/src/database-schema.ts)
- [001_initial_schema.ts](/Users/joel/Dev/exitbook/packages/data/src/migrations/001_initial_schema.ts)
- [processors.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/processors.ts)
- [process-workflow.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-workflow.ts)

Hard processor pilot candidates:

- [cardano/processor.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/cardano/processor.ts)
- [cardano/processor-utils.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/cardano/processor-utils.ts)
- [bitcoin/processor.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/bitcoin/processor.ts)
- [cosmos/processor.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/cosmos/processor.ts)
- [evm/processor.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor.ts)

Current accounting reconstruction files:

- [build-accounting-model-from-transactions.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-model/build-accounting-model-from-transactions.ts)
- [prepare-accounting-transactions.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-model/prepare-accounting-transactions.ts)
- [accounting-entry-types.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-model/accounting-entry-types.ts)
- [validated-transfer-links.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-model/validated-transfer-links.ts)

Consumers that must eventually move to journals/postings:

- cost basis standard matcher and Canada workflow
- transfer linking and link validation
- portfolio and balance projections
- price readiness and price enrichment inputs
- accounting issues and gap analysis
- CLI transaction/accounting displays

## Target Concepts

### Source Activity

`source_activity` is a non-accounting container for one processed source event
or correlated source event group.

It carries:

- account id
- source activity fingerprint derived from the same account fingerprint
- platform key and platform kind
- transaction/source fingerprint
- timestamp and datetime
- blockchain hash/block metadata when present
- source address fields when present
- raw transaction lineage

The processor-facing source activity context must pass account identity as one
grouped value, not as loose `accountId` and `accountFingerprint` parameters.
The persistence layer must source both values from the same account record when
materializing journals. A source activity fingerprint for one account must
never be stored on another account id.

It must not carry:

- operation category/type
- accounting inclusion/exclusion
- accounting role
- diagnostics JSON
- user notes JSON
- semantic meaning

### Accounting Journal

An accounting journal groups postings that belong to one accounting-relevant
event inside a source activity.

Draft shape:

```ts
export interface AccountingJournalDraft {
  sourceActivityFingerprint: string;
  journalStableKey: string;
  journalKind: AccountingJournalKind;
  postings: readonly AccountingPostingDraft[];
  relationships?: readonly AccountingJournalRelationshipDraft[] | undefined;
  diagnostics?: readonly AccountingDiagnosticDraft[] | undefined;
}
```

Initial journal kinds:

- `transfer`
- `trade`
- `staking_reward`
- `protocol_event`
- `refund_rebate`
- `internal_transfer`
- `expense_only`
- `unknown`

The exact vocabulary should stay small. If a kind changes accounting postings,
roles, transfer eligibility, income treatment, or basis behavior, it belongs in
the accounting journal vocabulary, not transaction semantics.

`fee` is a posting role, not a journal kind. Most fee postings live inside a
richer journal, such as a trade with an exchange-fee posting or a transfer with
a network-fee posting. Use `expense_only` only when the source activity has no
principal asset effect and the accounting event is only an expense, such as a
failed transaction that burned gas or an approval transaction with only gas.

### Accounting Posting

An accounting posting is the canonical asset effect consumers read.

Draft shape:

```ts
export interface AccountingPostingDraft {
  postingStableKey: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  role: AccountingPostingRole;
  settlement?: AccountingSettlement | undefined;
  priceAtTxTime?: PriceAtTxTime | undefined;
  sourceComponentRefs: readonly SourceComponentQuantityRef[];
}
```

Rules:

- `quantity` is signed. Positive means account balance increases; negative
  means account balance decreases.
- `quantity` must never be zero.
- `role` is not optional.
- `settlement` is required for fee-like postings and optional otherwise.
- posting reads never coerce missing roles.
- source component refs are required; no posting can exist without provenance.

Initial posting roles:

- `principal`
- `fee`
- `staking_reward`
- `protocol_overhead`
- `refund_rebate`

### Source Component Refs

`sourceComponentRef` must be typed and fingerprinted. It is not a free-form
string.

Draft shape:

```ts
export interface SourceComponentRef {
  sourceActivityFingerprint: string;
  componentKind:
    | 'raw_event'
    | 'exchange_fill'
    | 'exchange_fee'
    | 'utxo_input'
    | 'utxo_output'
    | 'account_delta'
    | 'staking_reward'
    | 'message'
    | 'network_fee';
  componentId: string;
  occurrence?: number | undefined;
  assetId?: string | undefined;
}

export interface SourceComponentQuantityRef {
  component: SourceComponentRef;
  quantity: Decimal;
}
```

`SourceComponentQuantityRef.quantity` is always positive. Posting quantity owns
the account balance direction; component kind identifies the provider-native
source shape, such as UTXO input versus UTXO output. Do not encode direction by
making source component quantities negative.

Fingerprint recipe:

- canonical JSON over `sourceActivityFingerprint`, `componentKind`,
  `componentId`, `occurrence`, and `assetId`
- no DB ids
- no role, journal kind, settlement, review state, override state, price, or
  timestamp fields

If a provider exposes no stable component id apart from timestamp-bearing raw
material, the processor must normalize that material into `componentId` before
creating the source component ref. Do not add a timestamp field to the shared
fingerprint recipe.

For UTXO chains, component refs must point at provider-native UTXO components:

- input component id: previous transaction hash plus output index
- output component id: current transaction hash plus output index
- `assetId` distinguishes assets inside multi-asset UTXOs
- `occurrence` is reserved for provider-native duplicate components that still
  collide after `componentId` and `assetId`

This is the most important contract to get right. UTXO same-hash handling,
Cardano residual attribution, exchange fill grouping, lot matching, and
override replay all depend on stable component identity.

Journal-level component refs are derived as the union of posting-level
component refs. They are not stored on the journal draft, because duplicating
them creates a second provenance surface to keep consistent.

### Journal Relationships

Relationships model accounting links between journals/postings.

Initial relationship kinds:

- `internal_transfer`
- `external_transfer`
- `same_hash_carryover`
- `bridge`
- `asset_migration`

Bridge and asset migration are accounting relationships when they affect
posting matching, transfer eligibility, cost basis, or disposal treatment.
Non-accounting product labels can be projected later, but they must not own
ledger truth.

### Accounting Overrides

Move accounting-judgment overrides onto journals/postings.

Override categories:

- journal kind override
- posting role override
- posting settlement override
- posting split/merge override, only after the identity contract can support it
- participation include/exclude, either as accounting participation decisions
  or review-owned decisions that project into accounting

Data-correctness fixes are separate. Bad source timestamps, malformed asset ids,
or provider parse bugs should be fixed by reimport, raw data correction, or
processor fixes, not by accounting judgment overrides.

Override identity rule:

- journal/posting fingerprints must exclude overridable fields
- overrides target stable journal/posting fingerprints plus an explicit patch
- reprocess rebuilds journals/postings from source, then reapplies accounting
  overrides
- if a target no longer exists after reprocess, the override becomes stale and
  visible for review; it must not silently apply to a different posting

## Hard Invariants

- One canonical accounting read model: journals/postings.
- `transaction_movements` does not survive as a second canonical per-leg model.
- Source activity rows carry no accounting meaning.
- Accounting roles are never optional in canonical accounting reads.
- Semantic facts must not duplicate accounting roles or journal kinds.
- Any kind that affects postings, roles, transfer eligibility, income treatment,
  or cost basis is accounting-owned.
- Bridge and asset migration truth that affects accounting is represented as
  accounting journal relationships, not semantic facts.
- Diagnostics record uncertainty or processor problems; consumers do not read
  diagnostics for accounting meaning.
- Consumer cutover is blocked until `balance-v2` reconciles ledger-backed
  balances against representative processed-transaction scopes.
- No silent defaults for unexpected accounting state. Use `Result<T, Error>`
  and log recoverable inconsistencies with `logger.warn()`.

## Migration Constraint

The migration must remain shadow-verifiable.

Rules:

- Do not cut accounting consumers directly from legacy processed-transaction
  reads to ledger-backed reads without a parallel balance check.
- Build and run a side `balance-v2` over the new ledger model before consumer
  migration starts.
- Run `balance-v2` against the same processed transaction scopes used by the
  current balance/portfolio path.
- Treat every non-zero diff as one of:
  - ledger model bug
  - legacy behavior bug
  - intentional accounting behavior change that must be approved explicitly
- Do not remove legacy accounting reconstruction until `balance-v2` is green on
  the pilot processors and representative imported datasets.

## Phase Plan

Execution order note:

- After Phase 1 contract work, execute the schema draft before Cardano
  `processor-v2`.
- Cardano remains the first hard processor kill-test, but it should target a
  draft schema that already exists.

### Phase 0: Freeze Semantics And Align The Plan

Status: complete.

Steps:

1. Mark the transaction-semantics doc set as deferred pending this ledger
   rewrite.
2. Keep the semantics pass documents as reference-only input.
3. Stop adding semantic facts, claim/support tables, reconcilers, or review
   namespace implementation for now.
4. Use this document as the execution tracker until a canonical spec replaces
   it.

Acceptance criteria:

- semantics README clearly says implementation is paused
- ledger rewrite plan exists and names the target model
- no semantic implementation work is started in parallel

### Phase 1: Draft Contracts

Status: complete.

New files:

- `packages/ledger/src/journals/journal-draft.ts`
- `packages/ledger/src/source-components/source-component-ref.ts`
- `packages/ledger/src/journals/journal-fingerprint.ts`
- `packages/ledger/src/journals/journal-validation.ts`
- `packages/ledger/src/journals/__tests__/journal-fingerprint.test.ts`
- `packages/ledger/src/journals/__tests__/journal-validation.test.ts`

Steps:

1. Define `AccountingJournalDraft`, `AccountingPostingDraft`,
   `SourceComponentRef`, `SourceComponentQuantityRef`, and relationship draft
   types.
2. Define canonical fingerprint material builders:
   - `buildSourceComponentFingerprintMaterial(ref)`
   - `buildAccountingJournalFingerprintMaterial(draft)`
   - `buildAccountingPostingFingerprintMaterial(journalFingerprint, draft)`
3. Explicitly exclude overridable fields from stable fingerprints:
   - journal fingerprints exclude `journalKind`
   - posting fingerprints exclude `role`, `settlement`, review state, override
     state, and price state
4. Add validation for:
   - non-empty stable keys
   - non-zero signed quantities
   - role/sign compatibility
   - settlement presence for `fee` role postings
   - at least one source component per posting
   - no duplicate posting stable key inside one journal
5. Export the draft contracts only inside accounting until the first pilot
   needs ingestion visibility.

Pseudo-code:

```ts
export function validateAccountingJournalDraft(draft: AccountingJournalDraft): Result<AccountingJournalDraft, Error> {
  return resultDo(function* () {
    yield* validateJournalIdentity(draft);
    yield* validateJournalKind(draft.journalKind);
    for (const posting of draft.postings) {
      yield* validatePostingDraft(posting);
    }
    yield* validateJournalHasPostingSourceComponents(draft.postings);
    yield* validatePostingStableKeyUniqueness(draft.postings);
    return draft;
  });
}
```

Acceptance criteria:

- focused accounting journal tests pass
- contracts do not import ingestion or data
- contract code has no runtime dependency on persistence

### Phase 2: Cardano Shadow Processor Pilot

Status: in progress.

Completed in this phase:

- `processor-v2.ts` and `journal-assembler.ts` exist and emit
  `sourceActivity + journals` in memory.
- Cardano v2 account identity is grouped as one context value and represents
  the wallet/accounting owner, not the derived child address that happened to
  import a raw row.
- Cardano v2 takes a wallet address scope and assembles one ledger activity per
  unique on-chain transaction hash, de-duplicating repeated child-address raw
  rows before journal construction.
- Cardano v2 principal source component refs are built from raw UTXO
  input/output identity, not consolidated movement identity.
- Cardano v2 staking reward source component refs are built from raw withdrawal
  components.
- Cardano v2 no longer derives journal drafts from legacy Cardano
  `CardanoMovement` values; wallet-scope UTXO totals are extracted directly
  from provider-normalized inputs, outputs, fees, and withdrawals.
- Cardano v2 validates every emitted journal draft before returning shadow
  output.
- Cardano v2 emits normal network fees as `fee` postings inside the richer
  transfer or staking reward journal; `expense_only` is reserved for fee-only
  activity.
- Cardano v2 treats reward-funded external sends as a principal transfer plus
  a `staking_reward` posting. This intentionally corrects the old
  address-scoped behavior where a wallet-scoped staking withdrawal became a
  diagnostic component.
- The legacy Cardano processor remains untouched.
- `processor-v2.shadow.test.ts` now runs v1 and v2 against the same Cardano
  fixtures for ordinary UTXO cases and documents the intentional staking
  withdrawal divergence from legacy address-scope accounting.
- `processor-v2.balance-shadow.test.ts` requires balance parity for ordinary
  UTXO cases and asserts explicit corrected ledger balances for wallet-scoped
  staking reward spends.
- The shadow harness currently covers:
  - incoming transfers
  - transfers with change
  - distinct same-asset UTXO input/output provenance
  - reward-funded external sends
  - claim-to-self staking rewards
  - same-hash multi-source external sends with wallet-scope withdrawals

Remaining in this phase:

- move same-hash reduction out of downstream accounting and into the Cardano
  v2 path
- prove source component refs survive Cardano same-hash/internal-transfer
  cases without escape hatches
- expand the shadow reconciliation coverage from external same-hash groups to
  internal/carryover same-hash groups
- design the wallet-scope persistence flow that maps child-address raw
  transaction rows to one parent-account source activity without duplicating
  journals/postings

New files:

- `packages/ingestion/src/sources/blockchains/cardano/processor-v2.ts`
- `packages/ingestion/src/sources/blockchains/cardano/journal-assembler.ts`
- `packages/ingestion/src/sources/blockchains/cardano/__tests__/processor-v2.shadow.test.ts`
- `packages/accounting/src/ledger-shadow/shadow-reconciliation.ts`
- `packages/accounting/src/ledger-shadow/__tests__/shadow-reconciliation.test.ts`

Steps:

1. Implement a Cardano-only in-memory journal assembler.
2. Keep the existing Cardano processor untouched.
3. Run v1 and v2 over the same raw/provider events inside tests.
4. Convert v2 journals into an aggregate comparison shape:
   - asset id
   - signed quantity
   - posting role
   - source activity fingerprint
   - component fingerprints
5. Compare v2 aggregate output to v1 `buildAccountingModelFromTransactions()`
   output for known Cardano same-hash and staking scenarios.
6. Record any mismatch as either:
   - v2 contract bug
   - v1 behavior bug
   - intentional model change requiring approval

Same-hash handling:

- keep the processor interface unified
- allow Cardano internals to batch by hash before emitting journal drafts
- do not expose a generic "pre-accounting adapter" unless a second slice proves
  it needs the same external hook

Acceptance criteria:

- Cardano same-hash internal transfer cases reconcile
- Cardano ordinary UTXO cases reconcile with legacy where the accounting model
  is intentionally unchanged
- Cardano staking reward/residual cases are represented as ledger postings and
  source component refs, with intentional legacy divergences recorded as model
  corrections
- v2 does not need semantic annotations or `staking_reward_component`
- no persistence changes yet

Kill criteria:

- the journal/posting model needs a Cardano-only escape hatch
- source component refs cannot express same-hash reduction provenance
- stable posting identity cannot survive realistic reprocess changes

### Phase 3: Second And Third Hard Pilots

Status: pending.

Candidate files:

- `packages/ingestion/src/sources/blockchains/cosmos/processor-v2.ts`
- `packages/ingestion/src/sources/blockchains/cosmos/journal-assembler.ts`
- `packages/ingestion/src/sources/blockchains/evm/processor-v2.ts`
- `packages/ingestion/src/sources/blockchains/evm/journal-assembler.ts`
- `packages/ingestion/src/sources/blockchains/bitcoin/processor-v2.ts`
- `packages/ingestion/src/sources/blockchains/bitcoin/journal-assembler.ts`

Steps:

1. Pilot Cosmos staking/undelegation reward-principal splitting.
2. Pilot EVM gas/value handling.
3. Pilot Bitcoin or another UTXO family member if Cardano-specific logic hid a
   generic UTXO requirement.
4. Extract shared helpers only after duplication is visible across two slices.

Acceptance criteria:

- at least two non-trivial processor families emit journals cleanly
- common helpers are extracted only for repeated source-component and validation
  needs
- exchange processors are sketched to confirm the common case stays ergonomic

### Phase 4: Persistence Design And Schema Rewrite

Status: draft schema started; atomic ledger materialization repository and
scoped posting reads started.

Files to update:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/data-session.ts`
- `packages/data/src/repositories/index.ts`
- `packages/data/src/repositories/transaction-repository.ts`
- `packages/data/src/repositories/transaction-persistence-support.ts`
- `packages/data/src/repositories/transaction-materialization-support.ts`

New repository files:

- `packages/data/src/repositories/accounting-ledger-repository.ts`

Do not split source activity, journal, posting, component-ref, and relationship
materialization across separate write repositories yet. The safe write unit is a
complete source activity ledger replacement: validate the source activity and
all journals, upsert the source activity, delete existing derived ledger rows
for that source activity, then insert journals, postings, posting source
components, relationships, and raw assignments in one DB transaction. Split read
ports later only when consumers need narrower query shapes.

Schema direction:

- keep `raw_transactions`
- replace accounting-bearing `transactions` with thin `source_activities`
  or rename `transactions` only if the name avoids churn without preserving old
  meaning
- drop `transaction_movements`
- add `accounting_journals`
- add `accounting_postings`
- add `accounting_posting_source_components`
- add `accounting_journal_relationships`
- move diagnostics and notes to separate tables if still needed in this slice
- do not keep `operation_category`, `operation_type`,
  `excluded_from_accounting`, `diagnostics_json`, or `user_notes_json` on the
  source activity row
- drop `transaction_annotations`; non-accounting semantics can be re-emitted
  later after the ledger rewrite

Acceptance criteria:

- draft migration creates the new model alongside legacy tables until cutover
- database schema types match the new tables
- repository tests cover round-trip persistence, deterministic replacement,
  relationship endpoints, and rejected-draft rollback
- repository reads can load ledger postings for a full account scope, including
  parent plus child accounts
- no consumer reads the new tables until Phase 6 materialization is ready

Completed in this phase:

- `raw_transaction_source_activity_assignments` treats each raw transaction row
  as assigned to one ledger source activity. This prevents the same raw input
  from being counted into two source activities.
- `AccountingLedgerRepository.replaceForSourceActivity()` validates raw
  bindings before writing:
  - every raw transaction id must exist
  - each raw row must belong to the source activity account or a direct child
    account
  - no raw row may already be assigned to a different source activity
- Repository tests cover wallet-scope UTXO lineage: one parent source activity
  assigned to multiple child-address raw rows.

### Phase 5: Accounting Overrides

Status: pending.

Files to update or replace:

- `packages/core/src/override/override.ts`
- `packages/data/src/overrides/transaction-movement-role-replay.ts`
- `packages/data/src/overrides/transaction-override-materialization.ts`
- `packages/data/src/overrides/override-store.ts`

New files:

- `packages/ledger/src/overrides/override-target.ts`
- `packages/ledger/src/overrides/override-patch.ts`
- `packages/ledger/src/overrides/override-application.ts`
- `packages/data/src/overrides/accounting-override-replay.ts`

Steps:

1. Split data-correctness fixes from accounting-judgment overrides.
2. Replace movement-role override semantics with posting-role and journal-kind
   override semantics.
3. Add stale override reporting for missing journal/posting targets after
   reprocess.
4. Keep override application deterministic and ready to run inside ledger
   materialization.

Acceptance criteria:

- user accounting corrections target journals/postings
- source activity and raw rows remain unmodified by accounting judgment
- stale overrides are visible and never silently remapped
- the pipeline cutover has an override API available before it starts writing
  journals/postings

### Phase 6: Processing Pipeline Cutover

Status: pending.

Files to update:

- `packages/ingestion/src/shared/types/processors.ts`
- `packages/ingestion/src/features/process/base-transaction-processor.ts`
- `packages/ingestion/src/features/process/process-workflow.ts`
- `packages/ingestion/src/ports/processed-transaction-sink.ts`
- `packages/data/src/ingestion/processing-ports.ts`

Steps:

1. Replace `TransactionDraft` processor output with source activity plus
   accounting journal drafts.
2. Persist source activity, raw assignments, journals, postings, posting source
   components, and relationships in one database transaction.
3. Validate all journal drafts before writing.
4. Delete and replace all journals/postings for a reprocessed source activity
   scope.
5. Reapply accounting overrides after rebuild in the same workflow transaction.

Pseudo-code:

```ts
const output = yield * processor.process(rawBatch);
yield * accountingJournalValidator.validateAll(output.journals);
yield *
  dataSession.accountingLedger.replaceForSourceActivities({
    sourceActivities: output.sourceActivities,
    journals: output.journals,
    rawAssignments: output.rawAssignments,
  });
yield * dataSession.accountingOverrides.applyEffectiveOverrides(scope);
```

Acceptance criteria:

- process workflow writes the new ledger for at least the pilot processors
- reprocess is replace-not-append
- failed validation aborts the enclosing transaction
- no best-effort partial ledger writes

### Phase 7: Shadow Balance-V2

Status: pure runner and shadow diff started; persistence/CLI integration
pending.

New files:

- `packages/accounting/src/balance-v2.ts`
- `packages/accounting/src/balance-v2/balance-v2-runner.ts`
- `packages/accounting/src/balance-v2/balance-v2-shadow.ts`
- `packages/accounting/src/balance-v2/__tests__/balance-v2-runner.test.ts`
- `packages/accounting/src/balance-v2/__tests__/balance-v2-shadow.test.ts`
- `packages/ingestion/src/sources/blockchains/cardano/__tests__/processor-v2.balance-shadow.test.ts`

Files to compare against:

- `packages/accounting/src/portfolio/portfolio-position-building.ts`
- `apps/cli/src/features/accounts/command/account-balance-detail-builder.ts`
- `apps/cli/src/features/accounts/stored-balance/stored-balance-detail-utils.ts`

Steps:

1. Build a ledger-backed `balance-v2` that aggregates signed postings by
   account and asset for a processed transaction scope.
2. Run `balance-v2` in parallel with the current balance/portfolio derivation
   over the same processed transaction inputs.
   - First harness: Cardano processor-v2 balance shadow compares previous
     processor plus balance-v1 impact against processor-v2 plus balance-v2
     postings on the same normalized fixtures for ordinary UTXO cases.
   - Cardano wallet-scoped staking cases assert corrected ledger balances
     directly because v2 intentionally accounts reward-funded sends differently
     from the legacy address-scoped transaction model.
3. Produce a shadow diff report keyed by:
   - account id
   - asset id
   - expected quantity
   - actual quantity
   - contributing source activity or posting fingerprints when available
4. Reconcile differences in:
   - fee settlement handling
   - internal transfer netting
   - same-hash carryover effects
   - staking reward attribution
   - negative balance behavior
5. Treat unresolved diffs as blockers for consumer migration.

Acceptance criteria:

- `balance-v2` runs side-by-side without replacing current balance reads or
  stored balance snapshots
- pilot processor datasets reconcile at account/asset balance level
- intentional behavior changes are documented explicitly
- consumer migration does not start until `balance-v2` is accepted

### Phase 8: Consumer Migration

Status: pending.

Primary accounting consumers:

- [standard-calculator.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/calculation/standard-calculator.ts)
- [lot-matcher.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts)
- Canada cost-basis workflow files under `packages/accounting/src/cost-basis/canada`
- linking files under `packages/accounting/src/linking`
- balance and portfolio projection files under `packages/accounting` and
  `apps/cli/src/features`

Steps:

1. Build ledger read ports owned by each consumer capability.
2. Move cost basis from `AccountingTransactionView` to journal/posting reads.
3. Move transfer validation from movement fingerprints to posting fingerprints
   and journal relationships.
4. Move price readiness/enrichment to posting-level requirements.
5. Move balance and portfolio to signed posting aggregation.
6. Move accounting issues/gaps to journal/posting references.
7. Update CLI transaction/accounting displays to show source activity plus
   journals/postings.

Acceptance criteria:

- no accounting consumer reads `transaction_movements`
- no accounting consumer reads semantic annotations for accounting meaning
- cost basis, links, portfolio, and balance run from the ledger model

### Phase 9: Remove Legacy Accounting Reconstruction

Status: pending.

Files to remove or archive:

- current `packages/accounting/src/accounting-model` files that are replaced by
  the ledger model
- transaction movement role replay paths that no longer apply
- staking reward annotation detector paths used only for accounting recovery
- semantic reconciler plans tied to accounting roles

Steps:

1. Delete old in-memory accounting reconstruction after all consumers migrate.
2. Delete `transaction_movements` schema and repository paths if not already
   removed in Phase 4.
3. Delete diagnostic-to-annotation accounting recovery paths.
4. Keep only non-accounting semantic work that still has a proven use case.

Acceptance criteria:

- one accounting read model remains
- no duplicate staking reward truth exists
- no reconcilers exist to sync ledger roles with semantics

### Phase 10: Canonical Docs

Status: pending.

Steps:

1. Move stable behavior from this `docs/dev` plan into canonical architecture
   docs.
2. Rewrite or archive the deferred transaction-semantics docs based on the
   ledger model that actually landed.
3. Document processor-v2 implementation rules per source family.
4. Document accounting override semantics and stale override behavior.

Acceptance criteria:

- `docs/dev` tracker is no longer the only source of truth
- transaction-semantics docs are either rewritten around the new ledger model or
  archived as superseded design history

## Validation Strategy

Per phase:

- run focused unit tests for touched contracts
- run `pnpm vitest run <changed-test-file>` for targeted validation
- run package build/typecheck before merging schema or processor contract work
- run e2e/local-safe flows only after persistence and consumers are wired

Shadow reconciliation must compare:

- asset-level signed quantities
- account-level asset balances
- role assignment
- fee settlement
- transfer/carryover relationships
- stable source component fingerprints
- price requirement coverage

## Open Questions

1. Should the thin source container be named `source_activities` immediately, or
   should `transactions` be kept as a transitional table name with stripped
   meaning?
2. Should participation include/exclude be accounting-owned or review-owned with
   an accounting projection?
3. Which fields can a posting split/merge override safely patch without
   invalidating stable identity?
4. Which exchange processor should be the first common-case ergonomics check
   after Cardano/Cosmos/EVM?

## Decisions And Smells

Decisions:

- Processor-v2 journal drafts are the de-risking path.
- The semantics work is paused until the ledger rewrite answers accounting
  ownership.
- The current accounting model is reference material, not a binding target.
- Accounting overrides move to journals/postings, not source rows.

Smells to watch:

- source component refs becoming a vague string escape hatch
- journal kind and semantic kind vocabularies overlapping
- keeping `transaction_movements` as a parallel per-leg truth
- designing a generic framework before Cardano and Cosmos force it
- making source activity rows carry accounting meaning again

Naming issues:

- prefer `source_activity` over accounting-heavy `transaction` when referring
  to the non-accounting container
- prefer `journal` and `posting` over `entry` when persistence becomes the
  canonical accounting model
- prefer `source_component_ref` over `provenanceInputs`
- prefer `accounting_override` over `movement_role_override`
