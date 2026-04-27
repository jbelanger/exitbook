---
last_verified: 2026-04-26
status: active
---

# Accounting Ledger Rewrite Plan

This is a temporary migration tracker. Keep it alive only until the ledger
rewrite is complete, then move stable behavior into canonical architecture docs
and delete or archive this file.

## Goal

Move accounting truth from generic processed transactions and movements to
processor-authored ledger artifacts:

```text
raw_transactions -> source_activities -> accounting_journals -> accounting_postings
                                      -> accounting_journal_relationships
                                      -> accounting_overrides
```

Consumers must eventually read journals/postings, not
`transaction_movements`, semantic annotations, or reconstructed movement roles.

## Current Verdict

The core ledger vocabulary and identity contracts are mature enough for
migration work.

The completed Cardano, Bitcoin, EVM/Theta, and Cosmos pilots challenged the
model across UTXO, account-based, staking, protocol-custody, failed-transaction,
token-transfer, and wallet-scope cases. They did not require new core journal
kinds, posting roles, or chain-specific accounting escape hatches.

Do not start another account-based chain just to prove the model. The remaining
risks are migration, reconciliation, exchange ergonomics, live balance
category support, opening-state acquisition, and cross-source relationship
materialization.

## Settled Contracts

### Source Activity

`source_activity` is a non-accounting container for one processed source event
or correlated source event group.

Required identity:

- `ownerAccountId`
- owner account fingerprint sourced from the same account record
- `platformKind`
- `platformKey`
- `sourceActivityOrigin`
- `sourceActivityStableKey`

The source activity fingerprint is derived from owner account fingerprint,
platform identity, origin, and stable key. Blockchain transaction hash is
optional blockchain metadata, not the generic identity field.

Allowed origins:

- `provider_event`
- `balance_snapshot`
- `manual_accounting_entry`

Rules:

- Source activities carry no accounting meaning.
- Source activities must not carry operation category, operation type,
  accounting role, accounting inclusion, diagnostics JSON, semantic meaning, or
  user notes JSON.
- The stable key is required for every origin.
- Non-provider activities must not fake blockchain hashes.
- Balance snapshots may have no raw transaction lineage; that absence must be
  visible in provenance.

Persistence anchor:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/accounting-ledger-repository.ts`
- Unique key:
  `(owner_account_id, platform_kind, platform_key, source_activity_origin, source_activity_stable_key)`

### Accounting Journal

An accounting journal groups postings that belong to one accounting-relevant
event inside a source activity.

Processor draft:

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

Stable journal fingerprints exclude overridable fields such as `journalKind`.

Initial journal kinds:

| Kind                | Meaning                                                                | Consumer effect                                        |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `transfer`          | External movement into or out of the account.                          | Can create or dispose lots unless linked as internal.  |
| `trade`             | Exchange of one asset for another.                                     | Disposes outgoing lots and creates incoming lots.      |
| `staking_reward`    | Processor-known staking reward income.                                 | Creates income lots; not duplicated as semantic truth. |
| `protocol_event`    | Protocol interaction that is not a trade, transfer, reward, or refund. | Posting roles define accounting behavior.              |
| `refund_rebate`     | Return of value that is not normal trade proceeds.                     | Creates refund/rebate treatment.                       |
| `internal_transfer` | Movement between owned accounts or addresses.                          | Must not create gains/losses once linked.              |
| `expense_only`      | No principal asset effect, only fee or overhead.                       | Consumes expense/fee lots only.                        |
| `opening_balance`   | Explicit cutoff position when prior history is incomplete.             | Creates opening lots with known or unknown basis.      |
| `unknown`           | Processor cannot classify the event.                                   | Blocks only affected journals/postings/assets/lots.    |

`fee` is a posting role, not a journal kind.

### Accounting Posting

An accounting posting is the canonical asset effect consumers read.

Processor draft:

```ts
export interface AccountingPostingDraft {
  postingStableKey: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  role: AccountingPostingRole;
  balanceCategory: AccountingBalanceCategory;
  settlement?: AccountingSettlement | undefined;
  priceAtTxTime?: PriceAtTxTime | undefined;
  sourceComponentRefs: readonly SourceComponentQuantityRef[];
}
```

Rules:

- `quantity` is signed.
- Positive means account balance increases.
- Negative means account balance decreases.
- `quantity` must never be zero.
- `role` is required.
- `balanceCategory` is required.
- `settlement` is required for fee-like postings and optional otherwise.
- Every posting must have source component refs.
- Stable posting fingerprints exclude overridable fields such as role,
  settlement, review state, override state, and price state.

Initial posting roles:

| Role                | Meaning                                                                 | Consumer effect                                                           |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `principal`         | Main asset movement for a transfer, trade leg, or account delta.        | Creates/disposes lots according to journal and relationships.             |
| `fee`               | Network, venue, or protocol fee paid by the account.                    | Expense/disposal treatment is jurisdiction-specific; settlement required. |
| `staking_reward`    | Reward amount earned from staking.                                      | Creates income lots.                                                      |
| `protocol_deposit`  | Asset moved into staking, escrow, wrapping, or protocol custody.        | Usually changes category/custody, not a disposal by default.              |
| `protocol_refund`   | Asset returned from protocol custody or failed/partial protocol action. | Usually restores position; relationship rules decide lot treatment.       |
| `protocol_overhead` | Non-fee value consumed by protocol mechanics.                           | Blocks only affected asset if treatment is unknown.                       |
| `refund_rebate`     | Return of value that is not normal trade proceeds.                      | Refund/rebate treatment; not staking reward.                              |
| `opening_position`  | Cutoff position because earlier history is incomplete.                  | Creates an opening lot.                                                   |

### Balance Category

Balance projections key by owner account, asset, and balance category.

Initial categories:

| Category            | Meaning                                                              | Consumer behavior                                                    |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `liquid`            | Spendable account balance.                                           | Included in normal liquid balance aggregation and lot availability.  |
| `staked`            | Delegated/staked position still owned by the account.                | Included in balance/portfolio as staking state, not spendable.       |
| `unbonding`         | Staking position in the chain's unbonding period.                    | Included in balance with completion metadata when available.         |
| `reward_receivable` | Earned staking reward visible in provider state but not yet claimed. | Included as receivable; recognition timing is jurisdiction-specific. |

Liquid, staked, unbonding, and reward-receivable positions must never collapse
into one asset total except in display layers that explicitly ask for totals.

### Source Component Refs

`sourceComponentRef` is typed and fingerprinted provenance. It is not a
free-form string.

```ts
export interface SourceComponentRef {
  sourceActivityFingerprint: string;
  componentKind:
    | 'raw_event'
    | 'exchange_fill'
    | 'exchange_fee'
    | 'utxo_input'
    | 'utxo_output'
    | 'cardano_collateral_input'
    | 'cardano_collateral_return'
    | 'cardano_stake_certificate'
    | 'cardano_delegation_certificate'
    | 'cardano_mir_certificate'
    | 'account_delta'
    | 'staking_reward'
    | 'message'
    | 'network_fee'
    | 'balance_snapshot';
  componentId: string;
  occurrence?: number | undefined;
  assetId?: string | undefined;
}

export interface SourceComponentQuantityRef {
  component: SourceComponentRef;
  quantity: Decimal;
}
```

Rules:

- `SourceComponentQuantityRef.quantity` is always positive.
- Posting quantity owns account balance direction.
- Fingerprints include source activity fingerprint, component kind,
  component id, occurrence, and asset id.
- Fingerprints exclude DB ids, roles, journal kind, settlement, review state,
  override state, price, and timestamp.
- Opening balances use `balance_snapshot` component refs.

### Journal Relationships

Relationship kinds:

- `internal_transfer`
- `external_transfer`
- `same_hash_carryover`
- `bridge`
- `asset_migration`

Bridge, wrap/unwrap, and asset migration truth is accounting-owned when it
affects posting matching, transfer eligibility, cost basis, or disposal
treatment. Diagnostics may carry candidate evidence, but diagnostics do not own
accounting truth.

### Accounting Overrides

Accounting-judgment overrides target journals/postings, not source activities
or raw rows.

Override categories:

- journal kind override
- posting role override
- posting settlement override
- future posting split/merge override after identity supports it
- participation include/exclude if accounting owns the final decision

Rules:

- Data-correctness fixes are not accounting overrides.
- Reprocess rebuilds journals/postings from source, then reapplies overrides.
- Missing targets become stale and visible for review.
- Stale overrides must never silently remap to another journal/posting.

## Hard Invariants

- One canonical accounting read model: journals/postings.
- `transaction_movements` does not survive as a second canonical per-leg model.
- Source activity rows carry no accounting meaning.
- Accounting roles are never optional in canonical accounting reads.
- Balance categories are never optional in canonical accounting postings.
- Ledger enum values require documentation before being added to code.
- Semantic facts must not duplicate accounting roles or journal kinds.
- Diagnostics record uncertainty or processor evidence; consumers do not read
  diagnostics for accounting meaning.
- Incomplete history and unknown classification are scoped to affected
  journals, postings, assets, and lots.
- Unknown basis on one opening lot must not block unrelated assets or unrelated
  known lots of the same asset.
- Consumer cutover is blocked until `ledger-balance` reconciliation is accepted.
- No silent defaults for unexpected accounting state. Use `Result<T, Error>`
  and log recoverable inconsistencies with `logger.warn()`.

## Current Implementation State

Ledger contracts:

- `packages/ledger/src/source-activities/source-activity-draft.ts`
- `packages/ledger/src/source-activities/source-activity-fingerprint.ts`
- `packages/ledger/src/journals/journal-draft.ts`
- `packages/ledger/src/journals/journal-fingerprint.ts`
- `packages/ledger/src/journals/journal-validation.ts`
- `packages/ledger/src/postings/posting-draft.ts`

Persistence:

- `source_activities.source_activity_stable_key` is persisted.
- `accounting_postings.balance_category` is persisted and required.
- `AccountingLedgerRepository.replaceForSourceActivity()` writes a complete
  source activity replacement in one transaction.
- Raw transaction source activity assignments prevent one raw row from being
  counted into two source activities.

Parallel ledger processing:

- `ProcessingWorkflow` can run legacy processors and ledger-v2 processors in
  parallel.
- Cardano, Bitcoin, EVM, Theta, and Cosmos register ledger-v2 processors.
- Ledger-v2 failures fail the batch for v2-enabled chains.
- Consumers still read legacy processed transactions.

Processor evidence:

- Cardano covers wallet-scoped UTXO, staking withdrawals, deposits/refunds,
  delegation-only fees, and MIR evidence.
- Bitcoin covers UTXO inputs/outputs, change, duplicate raw rows, fee-only
  effects, and conflicting payload rejection.
- EVM/Theta cover native value, token transfers, swaps, gas-only calls, failed
  transactions, beacon withdrawals, no-effect provider rows, token metadata
  canonicalization, and Theta native asset specifics.
- Cosmos covers inbound/outbound transfers, staking reward claims, delegation,
  undelegation, redelegation, and category-aware staking postings.

Balance reconciliation groundwork:

- `packages/accounting/src/ledger-balance/ledger-balance-runner.ts` aggregates
  postings by owner account, asset, and balance category.
- `packages/accounting/src/balance-v2/balance-v2-runner.ts` remains a
  compatibility facade over ledger balance behavior.
- `apps/cli/src/features/accounts/command/account-ledger-balance-shadow-builder.ts`
  is the temporary single-account compatibility bridge until final
  reconciliation command wiring lands.

## Remaining Work

Work in this order unless a blocker makes the order impossible.

### 0. Asset Screening And Reconciliation Command Boundary

Goal: make live reference-balance acquisition screenable and performant before
the final reconciliation command lands.

Source landing:

- `packages/ingestion/src/features/asset-screening/**`
- `packages/ingestion/src/features/balance/reconciliation/**`
- `apps/cli/src/features/accounts/command/accounts-reconcile.ts`
- `apps/cli/src/features/accounts/command/accounts-reconcile-*`

Command shape:

```sh
exitbook accounts reconcile [selector]
exitbook accounts reconcile --json
exitbook accounts reconcile --refresh-live
exitbook accounts reconcile --reference live
exitbook accounts reconcile --reference stored
exitbook accounts reconcile --strict
```

Implementation notes:

- `asset-screening` owns machine screening policy for reference balances.
- `balance/reconciliation` owns pure reconciliation result construction.
- `balance/reference` owns reference balance refresh and verification.
- `balance/calculation` owns local transaction-derived balance calculation.
- The CLI command owns selection, orchestration, text/JSON presentation, and
  exit-code mapping only.
- Default reconciliation should verify tracked/reference assets. Discovery of
  unknown live tokens should be an explicit mode, not the default hot path.
- Processor-v2 factories must not receive the legacy scam detector. V2
  processors emit accounting ledger facts only; asset screening and review
  policy run after processing as ingestion projections.
- Legacy `TransactionDraft` processors may keep their existing diagnostic path
  until they are retired or migrated behind the projection boundary.

Acceptance:

- Live token balance fetches can be scoped to screened reference assets.
- Known spam/accounting-blocked assets are not enriched or compared by default.
- Reconciliation rows are keyed by account, asset, and balance category.
- Final command source location is settled before command implementation.
- `createLedgerProcessor` receives a detector-free factory context.
- Workflow tests guard that the legacy scam detector is not passed to
  processor-v2 wiring.

### 1. Promote EVM-Family Stress Validation

Goal: make the local EVM-family stress runner repeatable from CLI or e2e
tooling before any pipeline cutover.

Command spec:

- `docs/dev/evm-family-ledger-stress-command-spec-2026-04-26.md`

Files to inspect first:

- `packages/ingestion/src/sources/blockchains/evm/processor-v2.ts`
- `packages/ingestion/src/sources/blockchains/evm/journal-assembler.ts`
- `packages/ingestion/src/sources/blockchains/theta/processor-v2.ts`
- `packages/ingestion/src/features/process/process-workflow.ts`
- `apps/cli/src/features/import/command/run-import.ts`
- `apps/cli/src/__tests__/ethereum-workflow.e2e.test.ts`

Implementation shape:

1. Extract the current local stress logic into a reusable test or command
   helper that loads persisted raw rows for selected EVM-family accounts.
2. Run the ledger-v2 processor against the same raw scope used by legacy
   processing.
3. Convert ledger postings into `LedgerBalancePostingInput`.
4. Compare against persisted legacy balance impact by asset.
5. Fail on unexpected non-zero diffs.
6. Record intentional diffs as explicit fixture expectations, not console
   notes.

Acceptance:

- `ledger stress evm-family` reruns Arbitrum, Avalanche, Ethereum, and Theta
  stress coverage from persisted raw rows when matching accounts exist.
- Live EVM-family workflow tests can call the stress command after
  import/reprocess for configured real-data accounts.
- Token metadata resolver is part of the repeatable path.
- Zero-diff status is machine-enforced.

### 2. Keep Cosmos Acceptance Narrow

Goal: accept only the Cosmos chains with defensible account-history providers
until opening-state snapshots exist.

Current rule:

- Enabled real-data corpora: Injective, Akash, Fetch.
- Cosmos Hub remains disabled for user-facing import.
- Cosmos Hub can remain available for parser/processor fixtures.

Files:

- `docs/specs/cosmos-sdk-processing.md`
- `packages/ingestion/src/sources/blockchains/cosmos/register.ts`
- `packages/ingestion/src/sources/blockchains/cosmos/processor-v2.ts`
- `packages/ingestion/src/sources/blockchains/cosmos/journal-assembler.ts`
- `packages/blockchain-providers/src/blockchains/cosmos/**`

Acceptance:

- INJ/AKASH/FETCH real-data corpora continue to pass ledger-v2 processing.
- Cosmos Hub is not exposed as supported live import until full-history
  backfill or opening snapshots make reconciliation defensible.
- Delegation must produce liquid outflow plus staked inflow, not zero net asset
  total.

### 3. Implement Cosmos Opening Balances

Goal: create ledger-native opening balance source activities when earlier
Cosmos history is missing or economically impractical to backfill.

Provider reads for Cosmos SDK chains:

- liquid bank balances:
  `/cosmos/bank/v1beta1/balances/{address}`
- staked delegations:
  `/cosmos/staking/v1beta1/delegations/{delegator_address}`
- unbonding delegations:
  `/cosmos/staking/v1beta1/delegators/{delegator_address}/unbonding_delegations`
- reward receivables:
  `/cosmos/distribution/v1beta1/delegators/{delegator_address}/rewards`

Implementation shape:

1. Add provider ports for bank, delegation, unbonding, and reward state reads.
2. Prefer height-pinned reads using `x-cosmos-block-height` when supported.
3. If a provider cannot serve the target height, do not silently fall back to
   current state.
4. Use inferred current-state-minus-deltas only when every post-cutoff ledger
   delta is known.
5. Otherwise require manual opening balances.
6. Emit `sourceActivityOrigin: 'balance_snapshot'`.
7. Emit `journalKind: 'opening_balance'`.
8. Emit `role: 'opening_position'`.
9. Emit category-specific postings for `liquid`, `staked`, `unbonding`, and
   `reward_receivable`.
10. Use `balance_snapshot` component refs with stable component ids containing
    account fingerprint, cutoff, asset id, and balance category.

Acceptance:

- Opening balances never impersonate provider transactions.
- Unknown basis is attached to opening lots and blocks only affected lots.
- Opening snapshots are persisted through the same ledger repository path as
  provider events.

### 4. Sketch One Exchange Processor

Goal: prove exchange imports fit the same source activity, journal, posting,
and component identity model before migrating consumers.

Preferred order:

1. Kraken if we want a simpler deterministic CSV/API shape.
2. Coinbase if we want the broadest ergonomic challenge first.

Files to inspect first:

- `apps/cli/src/__tests__/kraken-workflow.e2e.test.ts`
- `apps/cli/src/__tests__/kucoin-workflow.e2e.test.ts`
- `packages/exchange-providers/src/exchanges/kraken/client.ts`
- `packages/exchange-providers/src/exchanges/coinbase/client.ts`
- `packages/ingestion/src/sources/exchanges/**`
- `packages/ledger/src/source-components/source-component-ref.ts`

Implementation shape:

1. Group exchange fills, fees, deposits, withdrawals, and adjustments into
   source activities using exchange-native stable keys.
2. Use `exchange_fill` and `exchange_fee` source component refs where the
   exchange provides fill-level identity.
3. Do not fake blockchain transaction identity for exchange-only events.
4. Emit trades, transfers, fees, refunds/rebates, and unknown journals using
   the settled journal/posting vocabulary.
5. Compare against legacy exchange balance impact with `ledger-balance`.

Acceptance:

- No new core journal kind or posting role unless the exchange has an
  accounting reason the current vocabulary cannot express.
- Source activity stable key works for exchange event groups.
- Fill and fee component refs are stable enough for override replay.

### 5. Harden Balance Reconciliation

Goal: make ledger balance diffs actionable enough to gate consumer cutover.

Files:

- `packages/accounting/src/ledger-balance/ledger-balance-runner.ts`
- `packages/accounting/src/ledger-balance/__tests__/ledger-balance-runner.test.ts`
- `packages/accounting/src/balance-v2/balance-v2-shadow.ts`
- `apps/cli/src/features/accounts/command/account-ledger-balance-shadow-builder.ts`
- `apps/cli/src/features/accounts/command/accounts-refresh-types.ts`
- `packages/ingestion/src/features/balance/calculation/balance-calculation.ts`
- `packages/ingestion/src/features/balance/reference/reference-balance-verification.ts`

Implementation shape:

1. Keep `ledger-balance` keyed by owner account, asset, and balance category.
2. Include contributing source activity, journal, and posting fingerprints in
   diff output.
3. Rename CLI reconciliation summary fields that still imply currencies only,
   such as `totalCurrencies`, to category-aware names.
4. Extend `BalanceComparison` or introduce a ledger-native verification row so
   live balance checks can represent non-liquid categories.
5. Treat every non-zero diff as one of:
   - ledger model bug
   - legacy behavior bug
   - intentional accounting behavior change approved explicitly

Acceptance:

- Pilot datasets reconcile at account/asset/category level.
- Non-liquid ledger rows remain visible in CLI output even when legacy/live
  balance verification has no category-aware counterpart.
- Consumer migration does not start until unresolved diffs are gone or
  explicitly accepted.

### 6. Materialize Cross-Source Relationships

Goal: persist relationship truth that spans source activities before consumers
depend on ledger relationships for transfer, bridge, or migration behavior.

Files:

- `packages/data/src/repositories/accounting-ledger-repository.ts`
- `packages/ingestion/src/features/process/process-workflow.ts`
- `packages/accounting/src/linking/**`
- `packages/accounting/src/ledger-shadow/shadow-reconciliation.ts`

Implementation shape:

1. Keep same-source relationships inside `replaceForSourceActivity()`.
2. Add a separate materialization path for relationships discovered after
   multiple source activities exist.
3. Target journals/postings by stable fingerprints.
4. Make stale relationship endpoints visible after reprocess.
5. Do not use diagnostics as relationship truth.

Acceptance:

- Internal transfer, bridge, same-hash carryover, and asset migration
  relationships can connect journals across source activities.
- Reprocess does not silently point a relationship at a different posting.

### 7. Migrate Consumers

Consumer migration starts only after the previous gates pass.

Primary consumers:

- `packages/accounting/src/cost-basis/standard/calculation/standard-calculator.ts`
- `packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts`
- `packages/accounting/src/cost-basis/canada/**`
- `packages/accounting/src/linking/**`
- `packages/accounting/src/portfolio/**`
- `apps/cli/src/features/accounts/**`
- `apps/cli/src/features/cost-basis/**`
- price readiness and enrichment paths under `apps/cli/src/runtime/**` and
  `apps/cli/src/features/prices/**`

Steps:

1. Build ledger read ports owned by each consumer capability.
2. Move cost basis from `AccountingTransactionView` to journal/posting reads.
3. Move transfer validation from movement fingerprints to posting fingerprints
   and journal relationships.
4. Move price readiness/enrichment to posting-level requirements.
5. Move balance and portfolio to signed posting aggregation.
6. Move accounting issues/gaps to journal/posting references.
7. Update CLI accounting displays to show source activity plus
   journals/postings.

Acceptance:

- No accounting consumer reads `transaction_movements`.
- No accounting consumer reads semantic annotations for accounting meaning.
- Cost basis, links, portfolio, and balance run from the ledger model.
- Unknown opening basis blocks only calculations that consume affected lots.

### 8. Remove Legacy Accounting Reconstruction

Do this only after consumers are migrated.

Remove or archive:

- `packages/accounting/src/accounting-model/**`
- movement-role override replay paths that no longer apply
- staking reward annotation detectors used only for accounting recovery
- semantic reconciler plans tied to accounting roles
- `transaction_movements` schema/repository paths if still present

Acceptance:

- One accounting read model remains.
- No duplicate staking reward truth exists.
- No reconcilers exist to sync ledger roles with semantics.

### 9. Canonicalize Documentation

Do this last.

Steps:

1. Move stable model behavior from this tracker into canonical architecture
   docs.
2. Rewrite or archive deferred transaction-semantics docs based on the ledger
   model that actually landed.
3. Document processor-v2 implementation rules per source family.
4. Document accounting override semantics and stale override behavior.
5. Delete or archive this temporary tracker.

Acceptance:

- `docs/dev` is no longer the only source of truth.
- Transaction-semantics docs are rewritten around the ledger model or archived
  as superseded design history.

## Migration Gates

Consumer cutover is blocked until all gates are true:

- EVM-family stress validation is repeatable and green.
- Cosmos acceptance remains limited to chains with defensible account history,
  or opening snapshots exist for unsupported history.
- One exchange v2 processor sketch proves exchange event grouping and fill/fee
  provenance without changing the core model.
- `ledger-balance` reconciles representative datasets at account/asset/category
  level.
- Cross-source relationships have a persistence path.
- Accounting overrides can target journals/postings and report stale targets.
- Every intentional legacy divergence is documented as approved behavior.

## Validation Commands

Use focused validation for touched areas, then run the broader gates before
cutover work:

```sh
pnpm vitest run packages/ledger/src/source-activities/__tests__/source-activity-fingerprint.test.ts
pnpm vitest run packages/accounting/src/ledger-balance/__tests__/ledger-balance-runner.test.ts
pnpm vitest run packages/data/src/repositories/__tests__/accounting-ledger-repository.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/cardano/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/bitcoin/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/evm/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/theta/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/cosmos/__tests__/processor-v2.test.ts
pnpm build
pnpm lint --fix
```

If `pnpm lint --fix` is not supported by the script, run the repo's closest
fix-capable lint command first, then run `pnpm lint`.

## Decisions And Smells

Decisions:

- The ledger model is mature enough for migration work.
- Do not add another account-based chain before moving forward.
- Source activity identity is generic stable key plus origin; blockchain hash
  is source metadata.
- Balance identity is owner account plus asset plus balance category.
- Cosmos Hub stays disabled for user-facing import until full-history backfill
  or opening snapshots exist.

Smells to watch:

- `BalanceComparison` and live provider balance verification still assume
  liquid asset totals.
- `balance-v2` is now a compatibility facade over `ledger-balance`; remove or
  rename it before the migration is considered complete.
- Cross-source relationships need a dedicated materialization path before
  consumer cutover.
- `tokenType: "native"` is too vague for arbitrary Cosmos SDK bank denoms;
  prefer a future `bank_denom` or `sdk_denom` classification when token
  metadata is revisited.
- CLI summary names such as `totalCurrencies` are no longer precise once one
  asset can produce multiple balance-category rows.
