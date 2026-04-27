---
last_verified: 2026-04-27
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

Cardano and EVM are the reference baselines for the current model. Cardano is
the first completed ledger-v2 implementation and the preferred UTXO, staking,
and wallet-scope reference. EVM is the preferred account-based reference because
it has repeatable stress validation and broad token/provider coverage. Theta is
adjacent EVM-family coverage, not an equally tested reference baseline yet.

Bitcoin and Cosmos remain useful evidence, but they are not the reference
baseline. Bitcoin is a narrower UTXO check than Cardano. Cosmos reached v1
parity on the enabled corpora, but is deferred until opening-state analysis
makes full reconciliation defensible.

Kraken is the completed exchange proof. Its ledger-v2 processor reconciles
against legacy balance impact and live Kraken balances on the imported corpus
without requiring new core journal kinds, posting roles, or exchange-specific
source activity identity.

The completed pilots did not require new core journal kinds, posting roles, or
chain-specific accounting escape hatches. The remaining risks are migration,
reconciliation, exchange ergonomics, live balance category support,
opening-state analysis and acquisition, and cross-source relationship
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
  delegation-only fees, and MIR evidence. Use Cardano as the reference for
  category-aware staking and UTXO wallet-scope modeling.
- Bitcoin covers UTXO inputs/outputs, change, duplicate raw rows, fee-only
  effects, and conflicting payload rejection.
- EVM covers native value, token transfers, swaps, gas-only calls, failed
  transactions, beacon withdrawals, no-effect provider rows, token metadata
  canonicalization, and broad account-chain stress validation. Theta covers
  adjacent EVM-family native asset specifics but is not the primary reference.
  Use EVM as the reference for account-based processor structure, token metadata
  handling, and stress validation.
- Cosmos covers inbound/outbound transfers, staking reward claims, delegation,
  undelegation, redelegation, and category-aware staking postings. It reached
  v1 parity on enabled corpora, but is deferred until opening-state analysis
  makes its reconciliation story complete. Do not use Cosmos as a reference
  baseline before then.
- Kraken covers exchange provider-event grouping, exchange source activities,
  trade/transfer/refund journals, fill and fee component refs, dust sweeping,
  one-sided trade residuals, transfer reversal skips, and full imported-corpus
  v1/v2/live liquid balance parity.

Balance reconciliation groundwork:

- `packages/accounting/src/ledger-balance/ledger-balance-runner.ts` aggregates
  postings by owner account, asset, and balance category.
- `packages/accounting/src/balance-v2/balance-v2-runner.ts` remains a
  compatibility facade over ledger balance behavior.
- `apps/cli/src/features/accounts/command/account-ledger-balance-shadow-builder.ts`
  is the temporary single-account compatibility bridge until final
  reconciliation command wiring lands.
- `apps/cli/src/features/accounts/command/accounts-reconcile*.ts` is the
  ledger-native account reconciliation command boundary.
- `packages/ingestion/src/features/balance/reconciliation/**` owns pure
  account/asset/category balance row reconciliation.
- `packages/ingestion/src/features/asset-screening/**` owns reference-balance
  screening policy for live balance acquisition.
- `apps/cli/src/features/ledger/command/*ledger-stress*` owns repeatable
  ledger-v2 stress gates for EVM-family and NEAR accounts.

## Remaining Work

Work in this order unless a blocker makes the order impossible.

### 0. Asset Screening And Reconciliation Command Boundary

Status: complete for the migration gate. The command boundary, screening
policy, and category-aware reconciliation rows are implemented.

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

Implemented shape:

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
- `accounts reconcile [selector]` supports stored and live references,
  `--refresh-live`, `--json`, `--strict`, `--all`, and tolerance.
- Live token balance fetches use a tracked-token allowlist by default and skip
  token fetches entirely when no tracked token refs exist.
- Spam-diagnostic and accounting-blocked assets are suppressed from live
  reference comparisons after applying excluded-transaction balance
  adjustments.
- Non-liquid ledger categories remain visible as `category_unsupported` when
  the selected live/stored reference source only exposes liquid balances.

Acceptance:

- Live token balance fetches can be scoped to screened reference assets.
- Known spam/accounting-blocked assets are not enriched or compared by default.
- Reconciliation rows are keyed by account, asset, and balance category.
- Final command source location is settled before command implementation.
- `createLedgerProcessor` receives a detector-free factory context.
- Workflow tests guard that the legacy scam detector is not passed to
  processor-v2 wiring.

Remaining follow-up:

- A discover-all live reference mode exists in the screening policy but is not
  exposed as a CLI mode yet. Keep default reconciliation on tracked/reference
  assets until there is a concrete operator workflow for discovery.

### 1. Promote EVM-Family Stress Validation

Status: complete. `ledger stress evm-family` is implemented as a read-only CLI
gate over persisted raw rows and legacy processed transactions.

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

Implemented shape:

1. Extract the current local stress logic into a reusable test or command
   helper that loads persisted raw rows for selected EVM-family accounts.
2. Run the ledger-v2 processor against the same raw scope used by legacy
   processing.
3. Convert ledger postings into `LedgerBalancePostingInput`.
4. Compare against persisted legacy balance impact by asset.
5. Fail on unexpected non-zero diffs.
6. Record intentional diffs as explicit fixture expectations, not console
   notes.
7. Fail stale expected-diff fixtures when the documented diff is no longer
   observed.

Acceptance:

- `ledger stress evm-family` reruns Arbitrum, Avalanche, Ethereum, and Theta
  stress coverage from persisted raw rows when matching accounts exist.
- Live EVM-family workflow tests can call the stress command after
  import/reprocess for configured real-data accounts.
- Token metadata resolver is part of the repeatable path.
- Zero-diff status is machine-enforced.

### 2. Port NEAR Ledger-V2

Status: complete for v1 parity on the available complete NearBlocks corpus.

Goal: validate the ledger model against a complex non-EVM account chain with a
strong provider before returning to weaker Cosmos support. Do not spend more
NearBlocks quota on blind large-account discovery for this phase.

Reference baseline:

- Use EVM as the account-based implementation base for processor-v2 wiring,
  token metadata resolution, and stress comparison.
- Use Cardano as the reference for the completed ledger-v2 quality bar:
  source activity identity, component refs, category-aware postings, and
  processor-owned accounting facts.
- Do not use Cosmos as a reference while opening-state support is incomplete.

Source files:

- `packages/ingestion/src/sources/blockchains/near/importer.ts`
- `packages/ingestion/src/sources/blockchains/near/processor.ts`
- `packages/ingestion/src/sources/blockchains/near/processor-v2.ts`
- `packages/ingestion/src/sources/blockchains/near/journal-assembler*.ts`
- `packages/ingestion/src/sources/blockchains/near/near-transaction-correlation.ts`
- `packages/ingestion/src/sources/blockchains/near/near-fund-flow-extraction.ts`
- `packages/ingestion/src/sources/blockchains/near/register.ts`
- `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/nearblocks.api-client.ts`
- `docs/specs/near-v2-implementation-guide.md`

Implemented shape:

- `processor-v2.ts` validates NearBlocks transaction, receipt,
  balance-change, and token-transfer stream rows before assembly.
- Journal assembler modules emit source activities, journals, postings, and
  component refs from correlated NEAR transaction groups.
- Native balance changes, token transfers, receipt fees, and balance-change fee
  fallbacks use signed ledger postings without new journal kinds or posting
  roles.
- Token metadata enrichment uses the provider runtime, matching EVM stress
  ergonomics.
- Legacy scam detection is not part of the `createLedgerProcessor` path.
- `createLedgerProcessor` is registered beside the existing legacy processor.
- `ledger stress near` compares ledger-v2 balances against persisted legacy
  balance impact and fails on unexpected diffs.

Verification:

- `near-wallet` complete corpus: 45 raw rows, 10 legacy transactions, 10
  ledger source activities, 10 journals, 18 postings.
- `ledger stress near --json` passes with zero unexpected diffs and no expected
  diff fixtures.
- Focused NEAR/process tests pass, including native transfers, fee-only calls,
  action-deposit transfer fees, token swaps with metadata, and contract reward
  inflows.
- A larger `watcher03.ref-watchdog.near` probe was intentionally stopped after
  2,250 transaction-stream rows to protect NearBlocks quota. It was not a
  complete corpus because receipts, balance changes, and token transfers had
  not been imported.
- The partial watchdog probe still showed a useful future fixture shape:
  high-frequency `update_token_rate` calls from `watcher03.ref-watchdog.near`
  to `v2.ref-finance.near`, mostly zero deposit, success status, and fee-only
  economic impact.

Remaining:

- Leave NEAR alone for migration progress unless a complete imported corpus
  later exposes a real v1/v2 diff.
- Add expected-diff fixtures only for intentional, documented legacy-vs-ledger
  projection differences.
- Before trying more large NEAR accounts, add provider import budget/preflight
  tooling so candidate discovery does not consume monthly credits blindly.
- Expand NEAR fixtures only if real complete data exposes storage staking,
  account creation, or receipt trees not covered by the current unit cases.

Acceptance:

- NEAR ledger-v2 processing handles transaction, receipt, balance-change, and
  token-transfer streams without new core journal kinds or posting roles.
- Gas/fee burn is represented as fee or protocol overhead postings with stable
  component refs.
- Token metadata resolution follows the same provider-runtime path as EVM.
- A repeatable NEAR stress path fails on unexpected diffs.

### 3. Defer Cosmos After V1 Parity

Status: v1 parity reached on enabled Cosmos corpora. Further Cosmos migration
work is deferred until opening-state analysis is complete.

Goal: keep Cosmos coverage green without making it a reference baseline or
advancing consumer reconciliation work on incomplete opening-state assumptions.

Current rule:

- Enabled real-data corpora: Injective, Akash, Fetch.
- Cosmos Hub remains disabled for user-facing import.
- Cosmos Hub can remain available for parser/processor fixtures.
- Do not spend migration time on new Cosmos account coverage until opening
  balance design decisions are resolved.

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
- Cosmos is not a reference baseline for new chain ports until opening-state
  analysis and support are complete.

### 4. Analyze Cosmos Opening Balances

Status: skipped for the current migration slice. Do not implement this as a
straight provider-read task until the questions below are answered.

Goal: decide how to create ledger-native opening balance source activities when
earlier Cosmos history is missing or economically impractical to backfill.

Candidate provider reads for Cosmos SDK chains:

- liquid bank balances:
  `/cosmos/bank/v1beta1/balances/{address}`
- staked delegations:
  `/cosmos/staking/v1beta1/delegations/{delegator_address}`
- unbonding delegations:
  `/cosmos/staking/v1beta1/delegators/{delegator_address}/unbonding_delegations`
- reward receivables:
  `/cosmos/distribution/v1beta1/delegators/{delegator_address}/rewards`

Analysis questions:

1. Which providers can serve height-pinned reads per enabled chain, and how do
   they signal unsupported historical state?
2. Can current-state-minus-deltas be proven complete for each balance category,
   or must the command require manual opening balances?
3. How should opening lots represent unknown basis without blocking unrelated
   lots?
4. What operator-facing evidence should be recorded so a future audit can
   distinguish provider-sourced, inferred, and manually-entered openings?

Candidate implementation shape after analysis:

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

### 5. Complete One Exchange Processor

Status: complete. Kraken ledger-v2 is the exchange proof, and Coinbase is the
second exchange migration using the same shared exchange ledger processor and
assembler.
Focused Kraken, Coinbase, raw-lineage, and workflow tests cover source
activities, journals, postings, source components, and representative v1/v2
liquid balance parity. Imported-corpus validation also passed against the
user's Kraken account: 677 raw rows, 381 legacy transactions, 381 ledger drafts,
44 v1/v2 balance rows, zero v1-v2 diffs, zero v1-live diffs, and zero v2-live
diffs. A persisted real-corpus stress command has not been promoted because the
corpus and live credentials are local/private.

Goal: prove exchange imports fit the same source activity, journal, posting,
and component identity model before migrating consumers.

Exchange migration order:

1. Kraken as the simpler deterministic CSV/API proof.
2. Coinbase as the broader API-ledger ergonomics proof.

Files to inspect first:

- `apps/cli/src/__tests__/kraken-workflow.e2e.test.ts`
- `apps/cli/src/__tests__/kucoin-workflow.e2e.test.ts`
- `packages/exchange-providers/src/exchanges/kraken/client.ts`
- `packages/exchange-providers/src/exchanges/coinbase/client.ts`
- `packages/ingestion/src/sources/exchanges/**`
- `packages/ledger/src/source-components/source-component-ref.ts`
- `docs/dev/kraken-ledger-v2-plan-2026-04-27.md`

Exchange implementation landing:

- `packages/ingestion/src/sources/exchanges/shared/exchange-ledger-assembler.ts`
- `packages/ingestion/src/sources/exchanges/shared/exchange-ledger-processor.ts`
- `packages/ingestion/src/sources/exchanges/kraken/processor-v2.ts`
- `packages/ingestion/src/sources/exchanges/coinbase/processor-v2.ts`
- `packages/ingestion/src/features/process/raw-transaction-lineage.ts`
- `packages/ingestion/src/features/process/process-workflow.ts`

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
- Kraken representative fixtures reconcile against legacy liquid balance impact
  with no unexpected diffs.
- Kraken imported-corpus balances reconcile across v1, v2, and live Kraken
  BalanceEx snapshots with no diffs.
- Coinbase representative fixtures reconcile against legacy liquid balance
  impact with no unexpected diffs.
- Exchange on-chain fees stay out of separate liquid balance postings when the
  provider-reported principal movement already carries the balance impact, and
  remain visible as balance-neutral journal diagnostics.

### 6. Harden Balance Reconciliation

Status: implemented for the current migration gate. Ledger-native aggregation,
diff provenance, the `accounts reconcile` CLI, balance-row summary wording, and
forward-compatible category-aware live reference handling are implemented. Live
providers still only emit liquid references until a provider can supply
non-liquid balances directly.

Goal: make ledger balance diffs actionable enough to gate consumer cutover.

Files:

- `packages/accounting/src/ledger-balance/ledger-balance-runner.ts`
- `packages/accounting/src/ledger-balance/__tests__/ledger-balance-runner.test.ts`
- `packages/accounting/src/balance-v2/balance-v2-shadow.ts`
- `apps/cli/src/features/accounts/command/account-ledger-balance-shadow-builder.ts`
- `apps/cli/src/features/accounts/command/accounts-refresh-types.ts`
- `packages/ingestion/src/features/balance/calculation/balance-calculation.ts`
- `packages/ingestion/src/features/balance/reference/reference-balance-verification.ts`

Implemented shape:

1. Keep `ledger-balance` keyed by owner account, asset, and balance category.
2. Include contributing source activity, journal, and posting fingerprints in
   diff output.
3. Introduce ledger-native reconciliation rows with expected/reference refs,
   category-unsupported status, missing-reference status, unexpected-reference
   status, and quantity-mismatch status.
4. Expose the command through `accounts reconcile` with text/JSON output and
   strict exit-code behavior.

Remaining shape:

1. Extend live reference providers when they can source non-liquid categories
   directly. The reconciliation DTO path already accepts those rows and will not
   mark a represented category as unsupported.
2. Treat every non-zero diff as one of:
   - ledger model bug
   - legacy behavior bug
   - intentional accounting behavior change approved explicitly

Acceptance:

- Pilot datasets reconcile at account/asset/category level.
- Non-liquid ledger rows remain visible in CLI output even when legacy/live
  balance verification has no category-aware counterpart.
- Consumer migration does not start until unresolved diffs are gone or
  explicitly accepted.

### 7. Materialize Cross-Source Relationships

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

### 8. Migrate Consumers

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

### 9. Remove Legacy Accounting Reconstruction

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

### 10. Canonicalize Documentation

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

- Cardano and EVM remain the reference baselines for chain processor behavior.
- EVM-family stress validation is repeatable and green.
- NEAR ledger-v2 stress validation is repeatable and green, proving a complex
  non-EVM account-chain port against the reference baselines.
- Cosmos stays deferred after v1 parity until opening-state analysis and
  support make unsupported history reconcilable; Cosmos is not used as a
  reference baseline before that.
- Kraken proves exchange event grouping and fill/fee provenance without
  changing the core model.
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
pnpm vitest run packages/ingestion/src/sources/blockchains/near/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/cosmos/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/exchanges/kraken/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/exchanges/coinbase/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/features/asset-screening/__tests__/asset-screening-policy.test.ts
pnpm vitest run packages/ingestion/src/features/balance/reconciliation/__tests__/balance-reconciliation.test.ts
pnpm vitest run apps/cli/src/features/accounts/command/__tests__/accounts-reconcile-runner.test.ts
pnpm vitest run apps/cli/src/features/ledger/command/__tests__/evm-family-ledger-stress-runner.test.ts
pnpm build
pnpm lint --fix
```

If `pnpm lint --fix` is not supported by the script, run the repo's closest
fix-capable lint command first, then run `pnpm lint`.

## Decisions And Smells

Decisions:

- The ledger model is mature enough for migration work.
- Cardano and EVM are the chain reference baselines.
- NEAR reached v1 parity on the available complete corpus; leave NEAR alone
  unless a complete imported corpus exposes a real v1/v2 diff.
- Cosmos reached v1 parity on enabled corpora, but is deferred until
  opening-state analysis and support make full reconciliation defensible.
- Kraken is the completed exchange proof; its imported corpus reconciles across
  v1, v2, and live Kraken balances with no diffs.
- Continue source/provider v2 migrations before linking v2; run them as shadow
  evidence and keep consumer cutover gated on cross-source relationship
  materialization.
- The remaining provider-v2 queue starts with KuCoin, then Solana, Substrate,
  and XRP.
- Exchange asset ids stay exchange-scoped when provider APIs do not supply
  chain-native asset identity; do not guess chain identity from symbols alone.
- The account reconciliation command boundary and asset-screening policy are
  already implemented.
- EVM-family stress validation is already implemented as a repeatable CLI gate.
- Source activity identity is generic stable key plus origin; blockchain hash
  is source metadata.
- Balance identity is owner account plus asset plus balance category.
- Cosmos Hub stays disabled for user-facing import until full-history backfill
  or opening snapshots exist.

Smells to watch:

- Current live providers still emit liquid reference rows only; category-aware
  rows are accepted by reconciliation once a provider can supply them.
- Exchange APIs may report on-chain fees without chain-native asset identity;
  those fees are retained as balance-neutral diagnostics until linking or
  on-chain evidence can attach richer identity.
- `balance-v2` is now a compatibility facade over `ledger-balance`; remove or
  rename it before the migration is considered complete.
- Cross-source relationships need a dedicated materialization path before
  consumer cutover.
- `tokenType: "native"` is too vague for arbitrary Cosmos SDK bank denoms;
  prefer a future `bank_denom` or `sdk_denom` classification when token
  metadata is revisited.
- NEAR large-account discovery currently requires starting expensive real
  imports; add provider import budget/preflight tooling before probing more
  NearBlocks accounts.
- Cosmos opening balances are not just provider reads; the design still needs
  provider height semantics, inference rules, manual-entry boundaries, and audit
  evidence before implementation.
- Full Kraken v1/v2/live balance validation is currently manual because it
  depends on private local imports and API credentials.
