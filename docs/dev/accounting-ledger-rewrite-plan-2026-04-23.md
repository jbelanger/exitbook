---
last_verified: 2026-04-30
status: active
---

# Accounting Ledger Rewrite Plan

This is a temporary execution tracker. Keep it alive only until the ledger
rewrite is complete, then move stable behavior into canonical architecture docs
and delete or archive this file.

## Goal

Build the ledger-native accounting model we would choose greenfield, using the
old movement model only as evidence of real-world cases. Current local data and
legacy compatibility are allowed to break when the replacement model is simpler
and more honest.

Move accounting truth from generic processed transactions and movements to
processor-authored ledger artifacts:

```text
raw_transactions -> source_activities -> accounting_journals -> accounting_postings
                                      -> accounting_journal_relationships
                                      -> accounting_overrides
```

Consumers must read journals/postings/relationships directly, not
`transaction_movements`, semantic annotations, reconstructed movement roles, or
adapters that preserve the old accounting model shape.

## Current Verdict

The core ledger vocabulary and identity contracts are mature enough for
greenfield ledger-native work.

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
chain-specific accounting escape hatches. The remaining risks are
reconciliation, exchange ergonomics, live balance category support,
opening-state analysis and acquisition, cross-source relationship
materialization, and replacing consumers that still read the old accounting
model.

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
- Cardano, Bitcoin, EVM, Theta, Cosmos, NEAR, Substrate, Solana, and XRP
  register ledger-v2 processors.
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
- Substrate covers native transfer flows, fee-only failed transactions, staking
  rewards, Polkadot staking lifecycle transitions across liquid, staked, and
  unbonding categories, and Bittensor TAO native rao normalization. Imported
  corpus validation passed for the user's Bittensor account: 5 raw rows, 5
  legacy transactions, 5 ledger source activities, 5 journals, 5 postings, zero
  v1-v2 balance diffs, and zero v2-live diffs against `5.59792811` TAO.
  Imported corpus validation also passed for the user's Polkadot account: 2 raw
  rows, 2 legacy transactions, 2 ledger source activities, 2 journals, 3
  postings, zero v1-v2 balance diffs, and zero v2-live diffs against `0` DOT.
  The current v2 port is native-asset-only and fails fast on non-native assets
  until providers expose stable token identity for Asset Hub and parachain
  assets.
- Solana covers representative SOL and SPL-token account-delta flows, outgoing
  SOL fee separation, fee-only activities, Jupiter-style swaps, associated token
  account rent as `protocol_overhead`, staking reward inflows, and simple
  staking custody movements across liquid and staked categories. It tracks
  native stake-account principal across imported transactions so stake-account
  closes split returned principal from accrued liquid staking rewards. Imported
  corpus validation passed for the user's four Solana accounts: 87 raw rows, 74
  legacy transactions, 74 ledger source activities, 74 journals, 99 postings,
  zero v1-v2 category-aware balance diffs, and zero live/stored diffs. Solana
  live balance verification is category-aware: current stake-account provider
  rows are modeled as `staked` or `unbonding` when present, stored snapshots key
  by asset plus balance category, and all four refreshed Solana wallets match
  live balances.
- XRP covers native XRP account-delta flows from XRPL `AccountRoot` balance
  changes, incoming transfers, outgoing transfers with balance-settled network
  fees, failed fee-only transactions, no-wallet-impact skips, v1/v2 balance
  parity fixtures, and a repeatable `ledger stress xrp` gate for imported
  corpora. The current port is native-XRP-only; issued currencies and DEX/trust
  line activity need provider identity and accounting fixtures before they are
  treated as complete ledger facts.
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
  ledger-v2 stress gates for EVM-family, NEAR, and Solana accounts.

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

Status: complete for Kraken, Coinbase, and KuCoin. Kraken ledger-v2 is the
exchange proof; Coinbase and KuCoin now use the same shared exchange ledger
processor and assembler.
Focused Kraken, Coinbase, KuCoin, raw-lineage, and workflow tests cover source
activities, journals, postings, source components, provider-specific source
evidence, and representative v1/v2 liquid balance parity. Imported-corpus
validation passed against the user's Kraken account: 677 raw rows, 381 legacy
transactions, 381 ledger drafts, 44 v1/v2 balance rows, zero v1-v2 diffs, zero
v1-live diffs, and zero v2-live diffs. Imported-corpus validation also passed
against the user's Coinbase account for v1/v2 parity: 300 raw rows, 165 legacy
transactions, 165 ledger drafts, 23 balance rows, and zero v1-v2 diffs. Live
Coinbase comparison had two sub-micro-unit API precision diffs (`AXL` and
`USDC`). Imported-corpus validation passed against the user's KuCoin CSV account
for v1/v2 parity: 721 raw rows, 162 legacy transactions, 162 ledger drafts, 22
balance rows, and zero v1-v2 diffs. KuCoin account-history `Spot`, `Deposit`,
and `Withdraw` rows were checked against the dedicated spot-order and transfer
CSV sections: when account-history `Amount` is treated as the net balance delta
and `Fee` as evidence only, those skipped rows exactly duplicate the materialized
CSV rows. The live KuCoin comparison still has a `USDT` mismatch because the
latest imported raw row is from 2026-02-05 while live KuCoin trade balance on
2026-04-27 reports `0.05580679` USDT; that is an export freshness/coverage gap,
not evidence that skipped account-history rows should be materialized. The small
`BTC`, `LYX`, and `USDC` live diffs are API display precision dust. A persisted
real-corpus stress command has not been promoted because the corpora and live
credentials are local/private.

Goal: prove exchange imports fit the same source activity, journal, posting,
and component identity model before migrating consumers.

Exchange migration order:

1. Kraken as the simpler deterministic CSV/API proof.
2. Coinbase as the broader API-ledger ergonomics proof.
3. KuCoin as the CSV proof for one-row trade fills and positive-amount
   withdrawal rows.

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
- `packages/ingestion/src/sources/exchanges/kucoin/processor-v2.ts`
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
- KuCoin representative fixtures reconcile against legacy liquid balance impact
  with no unexpected diffs, including one-row spot fills and positive-amount
  withdrawal rows.
- Coinbase and KuCoin imported raw corpora reconcile v1/v2 liquid balance impact
  with no diffs.
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

### 7. Ledger Linking V2 / Cross-Source Relationships

Status: in progress. The ledger-native relationship model is now usable for v2
linking comparison work. Durable relationship persistence uses
header-plus-allocation rows, matching reads source activities, journals, and
postings directly, and the deterministic recognizer pipeline is quantity-aware.
Exact-hash, strict same-hash grouped, narrow same-hash residual, and strict
counterparty roundtrip recognizers materialize accepted relationships without
depending on legacy movement linking.

The `links-v2` command is the user-facing parallel workflow. It can preview,
run, list, view, diagnose, and review ledger relationships while leaving legacy
`links` untouched. Asset identity decisions and reviewed link proposal decisions
are event-first overrides:

- asset identity accepts append `ledger-linking-asset-identity-accept` events
  and replay into the SQL assertion projection
- reviewed link proposal accepts append `ledger-linking-relationship-accept`
  events and replay into deterministic reviewed relationship drafts before other
  recognizers run

Unresolved ledger-linking-v2 candidates now project into the profile Issues
queue as posting-keyed transfer gaps. Diagnostics remain evidence and triage
state only; they do not become relationship truth. Non-link-work classifications
such as fiat cash movements, obvious spam/airdrops, and tiny native dust are
kept visible in diagnostics but omitted from the operator issue queue.

Goal: build ledger-native linking that persists relationship truth spanning
source activities before consumers depend on ledger relationships for transfer,
bridge, or migration behavior.

Boundary rules:

- Do not mechanically port old `linking` utilities or movement-based matching.
- Do not make legacy `transaction_movements` the input shape for new linking.
- New linking reads source activities, accounting journals, accounting postings,
  and stable posting fingerprints.
- New linking writes accounting-owned journal/posting relationships.
- Keep legacy linking available as migration evidence only; do not make it a
  dependency of the new relationship materialization path.
- If linking-v2 exposes a missing, unstable, or ambiguous processor-v2 ledger
  fact, stop linking work and fix the processor-v2 source artifact first.
- Do not paper over processor gaps with linking heuristics, symbol guesses, or
  one-off fallback matching. In-memory blocker counts may surface the stop
  condition, but must not become accepted relationship truth.
- Asset identity suggestions are review inputs only. Accepted pairwise
  assertions remain the durable truth that unlocks relationship materialization.
- Reviewed link proposals become durable truth only after a user action appends
  an override event. The event must store stable source/target activity,
  journal, posting, asset, and quantity evidence; candidate ids and symbols alone
  are never replay identity.

Files:

- `packages/data/src/repositories/accounting-ledger-repository.ts`
- `packages/ingestion/src/features/process/process-workflow.ts`
- new ledger-native files under `packages/accounting/src/linking/ledger/**`
  or `packages/accounting/src/ledger-linking/**`
- legacy `packages/accounting/src/linking/**` only as behavior/reference
  evidence during migration
- `packages/accounting/src/ledger-shadow/shadow-reconciliation.ts`
- `apps/cli/src/features/links-v2/**`

Implementation shape:

1. Keep same-source relationships inside `replaceForSourceActivity()`.
2. Add a separate ledger-native materialization path for relationships
   discovered after multiple source activities exist.
3. Treat `accounting_journal_relationships` as relationship headers, not
   pairwise endpoints.
4. Store posting-level source/target allocation rows under each relationship.
   Allocation rows carry stable source activity, journal, and posting
   fingerprints, current nullable endpoint ids, positive allocation quantity,
   and the asset identity observed at materialization time.
5. Keep processor-authored relationship drafts allocation-based too, using
   source activity fingerprints plus journal/posting stable keys before
   persistence resolves them to durable fingerprints.
6. Target journals/postings by stable fingerprints.
7. Make stale relationship allocations visible after reprocess.
8. Do not use diagnostics as relationship truth.
9. Keep matching candidates and persisted relationship materialization in
   separate new modules so consumers can depend on the persisted ledger
   relationship model without inheriting legacy proposal internals.

Completed checkpoints:

- durable relationship headers plus posting allocation rows
- processor-authored relationship drafts materialized into the same allocation
  model
- ledger-native candidate construction, read ports, runner orchestration, and
  deterministic recognizer pipeline
- exact-hash, strict same-hash grouped, quantity-aware same-hash residual, and
  strict counterparty roundtrip recognizers
- fee-adjusted exact-hash recognizer for one-to-one exchange withdrawals where
  the source amount is larger than the target amount, the hash matches, timing
  is source-before-target within 24 hours, and an accepted asset identity
  assertion exists. It materializes only the arrived amount and leaves the
  source-side residual unresolved for later fee/residual classification.
- strict exchange amount/time recognizer for cross-platform pairs with an
  exchange side, source-before-target ordering, exact symbol equality, accepted
  asset identity assertion, a one-hour materialization window, and broader
  amount/time uniqueness across the review window; amount matching accepts
  exact equality or display-precision truncation to at least six decimal places
  with explicit provenance
- recognition provenance split from accounting relationship kind
- asset identity assertions, suggestions, review view, and event-first accept
  path
- reviewed amount/time link proposals accepted only through durable override
  events, not automatic matching
- reviewed relationship accepts are allocation-native override events; they
  store source/target allocation rows with stable posting identity, current
  asset identity, and per-side quantities instead of the old amount/time
  source-target payload shape
- asset identity, reviewed relationship, and gap-resolution override replay now
  understands accept and revoke events in append order. CLI revoke commands are
  wired; durable dismissals for pending review items remain undecided.
- `links-v2 review revoke relationship <relationship-stable-key>`,
  `links-v2 review revoke gap-resolution <posting-fingerprint>`, and
  `links-v2 asset-identity revoke` now append revoke override events through
  the same replay path as accepts
- `links-v2 review create relationship` now creates manual allocation-native
  reviewed relationship overrides from source/target posting fingerprints. It
  requires a human reason, supports internal transfer, external transfer,
  same-hash carryover, bridge, and asset migration relationship kinds, and
  materializes through the same reviewed-relationship recognizer as proposal
  accepts.
- bridge-diagnostic amount/time review proposals now keep the amount/time
  evidence but materialize as `bridge` relationships with proposal kind
  `bridge_amount_time` instead of overloading `internal_transfer`.
- `links-v2 review` now creates allocation-native asset-migration link
  proposals for high-confidence RNDR/RENDER cases: same-hash
  KuCoin-to-Ethereum symbol migration and processor-marked Kraken migration
  context with separate source/target quantities.
- `links-v2 review` now surfaces warning-grade gap resolutions for
  related-profile transfer evidence and external-transfer evidence with no
  owned counterparty, keeping those decisions in the same override-backed review
  queue instead of stranding them in Issues.
- ledger-linking asset identity assertions are narrowed to the relationship
  scopes that recognizers actually resolve today: `internal_transfer`,
  `same_hash_carryover`, and `external_transfer`. `bridge` and
  `asset_migration` must be modeled as relationships, not asset identity.
- `links-v2 review` now hides target-before-source amount/time proposals and
  target-before-source amount/time asset identity suggestions; diagnostics still
  retain those clues
- ledger-linking-v2 unresolved candidates project to the existing accounting
  Issues queue as ledger-native transfer gaps, keyed by posting fingerprint and
  pointing back to `links-v2 diagnose` for review context
- profile Issues prefer v2 ledger gaps over legacy movement gaps whenever v2
  diagnostics are available, so the user queue does not double-count the same
  unresolved linking work
- ledger-linking-v2 diagnostics classify fiat cash movements, obvious
  spam/airdrops, tiny native dust, missing exchange hashes, external transfer
  evidence, and bridge/migration timing clues before projecting issues
- ledger-linking-v2 candidate reads carry processor journal diagnostic codes, so
  rows already marked as possible asset migration or internal exchange movement
  context stay visible as review warnings instead of blocked missing-hash gaps
- ledger-linking-v2 Issues omit non-link-work candidates and keep remaining
  unresolved posting candidates split between blocked evidence gaps and warning
  review gaps
- profile Issues suppress ledger-linking-v2 transfer-gap rows for assets that
  already have an open asset-review-required item, so known scam, ambiguous, or
  unmatched-reference assets stay owned by asset review first
- assets with non-blocking review evidence, such as an unmatched CoinGecko
  reference, surface as warning `asset_review_required` Issues before their
  related ledger-linking-v2 transfer gaps are shown
- related-owner wallets remain separate profiles. Ledger-linking-v2 now uses
  exact opposite-direction amount/time matches from other profiles as
  warning-grade gap evidence only; it does not materialize cross-profile
  relationships or treat those wallets as same-owner internal transfer targets
- ledger-linking materialization now reports stale allocation refs replaced
  during a run, so reprocess fallout is visible instead of hidden behind a
  hardcoded zero
- ledger-linking persistence now rejects allocation quantities that exceed the
  current posting quantity, even if an upstream recognizer or manual command
  accidentally overclaims
- ledger-linking runner tests now pin deterministic recognizer order:
  reviewed overrides, exact hash, fee-adjusted exact hash, same-hash grouped,
  counterparty roundtrip, then strict exchange amount/time
- `links-v2 list --stale` now filters accepted relationships whose allocation
  fingerprints no longer resolve to current journal/posting rows after
  reprocess
- ledger-linking runner recognizer lookup now uses one typed helper instead of
  one near-identical `findRun` helper per recognizer
- `accounting_journal_relationships.recognition_strategy` is now constrained to
  the known processor and ledger-linking strategies instead of arbitrary text
- `links-v2 diagnose` now reports how many unmatched candidate remainders are
  already covered by accepted gap-resolution decisions, so raw diagnostics do
  not read like open review work after the queue is cleared
- `links-v2` is now the only v2 linking CLI surface; the duplicate
  `ledger linking-v2` subset was removed from the ledger command namespace
- ledger-linking relationship materialization now preloads allocation endpoints
  for the replacement set instead of resolving each allocation with separate
  journal and posting queries

Active next slices:

Reviewed-link stabilization comes before more matching heuristics. The current
runner and storage model are independent, quantity-aware, allocation-native, and
reversible for accepted user decisions. The next work is model correctness and
operator clarity, not legacy parity.

Greenfield rule: do not keep old override or database shapes alive just to
preserve current local data. Breaking/rebuilding derived v2 data is acceptable
when the replacement model is simpler and more honest.

1. Decide whether pending review-item dismissals need durable override events
   now, or whether they should wait until repeated noisy proposals appear.
   Accepted asset identities, reviewed relationships, and gap resolutions are
   already reversible through revoke override events.
2. Keep transfer-gap work paused while the live review queue and profile Issues
   are empty. Do not add recognizers for raw diagnostic remainders that are
   already covered by explicit gap-resolution decisions.
3. Add more recognizers only after new unresolved work proves a
   repeatable, ledger-native evidence pattern. Do not port movement heuristics
   simply because they existed in v1.
4. Rebuild consumers later against journals/postings/relationships directly.
   Cost-basis, portfolio, and price enrichment must not use `accounting-model`
   as an adapter layer for the final ledger design.

Current live corpus after the latest review pass: the persisted v2 run has
`128` accepted relationships, including reviewed asset-migration, bridge, and
amount/time overrides. The safe gap-resolution queue was cleared, then
related-profile transfer gaps were accepted as explicit non-link decisions
through override events. The remaining weak external-transfer gap resolutions
were accepted as non-link decisions after confirming the review queue had no
asset identity suggestions or link proposals. `links-v2 review` is now empty and
profile Issues are clear after excluding `19` obvious spam, suspicious-airdrop,
unmatched-reference, and conflicting stablecoin-copy assets. Cost-basis remains
an old `accounting-model` consumer, so its behavior is not a ledger-v2 readiness
gate. A refreshed 2024 CA average-cost run succeeds on the cleaned corpus
(`781` transactions, `426` lots, `235` disposals), with one non-blocking tax
readiness warning: Kraken dust-sweeping transaction `def7d6dd12` has uncertain
proceeds allocation across multiple tiny disposed assets.

1. Keep target-before-source bridge or migration timing clues as diagnostics
   unless they reappear as unresolved review work in a new corpus. They are not
   acceptable normal transfer links under the current source-before-target rule.
2. Treat currently accepted external-evidence warnings as closed non-link
   decisions. Reopen only if new asset identity, owned-wallet, or source-system
   evidence appears.
3. Add additional partial/residual strategies only when the posting allocation
   model can represent the residual honestly and the evidence is reviewable.
   Fee-adjusted exact-hash covers the safest same-hash exchange-withdrawal
   subset; the remaining residuals still need explicit classification.
4. Keep old linking behavior available only as case evidence while it remains in
   the tree. It is not a compatibility target for v2.

Gap-resolution slice:

Status: complete for the safe non-link classes. Live default-profile review
queue was cleared through `links-v2 review accept <review-id>` override events.

1. Add ledger-native gap-resolution override events keyed by posting
   fingerprint, not legacy transaction movement gap identity.
2. Add `gap_resolution` items to `links-v2 review` for safe non-link classes:
   fiat cash movement, likely spam airdrop, likely dust airdrop, and residuals
   left after accepted partial transfer relationships.
3. Accept gap resolutions through override events only.
4. Suppress accepted ledger-linking-v2 gap resolutions from profile Issues
   while keeping diagnostics available for audit context.
5. Do not resolve ambiguous external transfers, related-profile evidence, or
   processor migration context until their policy is explicit.

Acceptance:

- Linking-v2 has its own files and module boundary.
- `links-v2` is the canonical ledger-native linking workflow. Any legacy `links`
  command that still exists is reference material, not a design constraint.
- Linking-v2 does not import legacy movement-matching utilities as its core
  implementation.
- `links-v2 review` is the user-facing linking action queue; diagnostics remain
  read-only developer visibility and should not grow separate mutation commands.
- Internal transfer, bridge, same-hash carryover, and asset migration
  relationships can connect journals across source activities.
- Reprocess does not silently point a relationship at a different posting.
- Any required processor-v2 fix is handled upstream before the affected
  relationship class is accepted.
- Persisted gaps are explicit non-link decisions and remain a
  diagnostic/work-queue projection rather than relationship truth.

### 8. Rebuild Consumers On Ledger

Consumer rewrite starts only after the previous gates pass. Do not start
cost-basis or portfolio work during linking model stabilization, and do not
preserve `accounting-model` as a compatibility adapter in the final design.

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

1. Build ledger read ports owned by each consumer capability. For cost basis,
   the first slice is a raw ledger context reader:
   `ICostBasisLedgerContextReader` in
   `packages/accounting/src/ports/cost-basis-ledger-persistence.ts`,
   implemented by `packages/data/src/accounting/cost-basis-ledger-ports.ts`
   and `AccountingLedgerRepository`.
2. Move cost basis from `AccountingTransactionView` to journal/posting reads.
3. Move transfer validation from movement fingerprints to posting fingerprints
   and journal relationships.
4. Move price readiness/enrichment to posting-level requirements.
5. Move balance and portfolio to signed posting aggregation.
6. Move accounting issues/gaps to journal/posting references.
7. Update CLI accounting displays to show source activity plus
   journals/postings.

Cost-basis migration model:

- Problem: current standard and Canada cost-basis pipelines consume
  `Transaction[]`, legacy `TransactionLink[]`, `AccountingTransactionView`, and
  transaction annotations. That boundary keeps movement fingerprints and
  semantic annotations in the accounting truth path.
- Already true: ledger source activities, journals, postings, posting prices,
  source-component provenance, and accepted relationship allocations exist as
  durable rows. Linking-v2 accepts relationship and gap decisions through
  override events.
- Missing: a cost-basis-owned ledger input model, posting-fingerprint transfer
  validation, event projection from journals/postings/relationships, and
  invariant tests for disposal/acquisition/carryover behavior.
- Rejected option: build an adapter that reconstructs `AccountingTransactionView`
  from ledger rows. It would speed porting but would preserve the old movement
  model as hidden compatibility debt.
- Chosen first slice: read source activities, journals, postings,
  source-component refs, diagnostics, and accepted relationship allocations as
  ledger-native records. Do not classify tax events or change calculation
  behavior in this slice.
- Current slice: add a pure ledger event projector under
  `packages/accounting/src/cost-basis/ledger/**`. It converts posting signs,
  journal kinds, and relationship allocations into jurisdiction-neutral
  cost-basis input events plus explicit blockers. Internal transfer,
  same-hash carryover, bridge, and asset migration relationships carry basis
  rather than producing disposals. External/unlinked outflows produce disposal
  candidates. Partially allocated relationship postings must surface a residual
  blocker rather than silently treating the remainder as a disposal. Accepted
  asset exclusions are explicit projector input; excluded postings are reported
  for audit and do not emit cost-basis input events. Relationship-level
  integrity blockers catch accepted allocations that no longer point at loaded
  postings, that no longer match their loaded posting metadata, that are
  structurally invalid or overallocated, or that mix excluded and non-excluded
  postings.
- Next implementation slice after event projection: adapt standard or Canada
  calculation behind this event model only after the calculation boundary
  handles projection blockers and excluded-posting audit output deliberately.

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
pnpm vitest run packages/data/src/repositories/__tests__/balance-snapshot-repository.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/cardano/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/bitcoin/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/evm/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/theta/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/near/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/cosmos/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/solana/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/solana/__tests__/processor-v2.balance-shadow.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/solana/__tests__/importer.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/xrp/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/xrp/__tests__/processor-v2.balance-shadow.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/shared/__tests__/ledger-journal-kind-utils.test.ts
pnpm vitest run packages/ingestion/src/sources/blockchains/shared/__tests__/ledger-processor-v2-utils.test.ts
pnpm vitest run packages/ingestion/src/sources/exchanges/kraken/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/exchanges/coinbase/__tests__/processor-v2.test.ts
pnpm vitest run packages/ingestion/src/sources/exchanges/kucoin/__tests__/processor-v2.test.ts
pnpm vitest run packages/exchange-providers/src/exchanges/kucoin/__tests__/client.test.ts
pnpm vitest run packages/ingestion/src/features/asset-screening/__tests__/asset-screening-policy.test.ts
pnpm vitest run packages/ingestion/src/features/balance/reconciliation/__tests__/balance-reconciliation.test.ts
pnpm vitest run packages/ingestion/src/features/balance/reference/__tests__/reference-balance-fetching.test.ts
pnpm vitest run packages/ingestion/src/features/balance/reference/__tests__/reference-balance-verification.test.ts
pnpm vitest run packages/ingestion/src/features/balance/reference/__tests__/reference-balance-workflow.test.ts
pnpm vitest run apps/cli/src/features/accounts/command/__tests__/accounts-reconcile-runner.test.ts
pnpm vitest run apps/cli/src/features/ledger/command/__tests__/evm-family-ledger-stress-runner.test.ts
pnpm vitest run apps/cli/src/features/ledger/command/__tests__/near-ledger-stress-runner.test.ts
pnpm vitest run apps/cli/src/features/ledger/command/__tests__/ledger-command.test.ts
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
- Linking-v2 is a separate branch/slice with its own ledger-native files. It
  must leverage source activities, journals, postings, and stable fingerprints
  directly instead of porting legacy movement-linking utilities.
- Processor-v2 ledger facts are upstream dependencies for linking-v2. If a
  relationship cannot be expressed without heuristics because a processor fact
  is missing or ambiguous, stop linking work and fix the processor-v2 artifact
  first.
- The provider-v2 queue is complete for the current native-asset chain scope.
- Substrate ledger-v2 is complete for the current migration gate with Polkadot
  as the native staking proof and Bittensor as the TAO decimal/provider proof.
  Keep the processor generic across Substrate chains, not Polkadot-only.
- Solana ledger-v2 is complete for the current migration gate with
  representative SOL, SPL-token, swap, fee, associated-token-account rent,
  staking shapes, imported-corpus v1/v2 category-aware parity, live/stored
  balance parity, category-aware live/stored snapshot rows, and a repeatable
  `ledger stress solana` gate with zero expected diffs.
- XRP ledger-v2 is complete for the current migration gate with native XRP
  account-delta transfers, balance-settled fees, failed fee-only rows, v1/v2
  balance parity fixtures, and a repeatable `ledger stress xrp` gate. Issued
  currencies and XRPL DEX/trust-line accounting remain out of scope until
  provider normalization exposes stable ledger facts for those assets.
- Exchange asset ids stay exchange-scoped when provider APIs do not supply
  chain-native asset identity; do not guess chain identity from symbols alone.
- Linking-v2 may break current local v2 data and override event payloads when
  the model is wrong. Preserve learned evidence, not compatibility with a shape
  we would not choose greenfield.
- Exchange amount and fee tests use strict `> 0` checks; `Decimal.isPositive()`
  treats zero as positive and must not drive materialization.
- KuCoin live reference balances are currently liquid-only and intentionally
  aggregate only main and trade account scopes. Margin and isolated balances
  need category-aware live reference rows before they can be included.
- KuCoin account-history `Amount` is the net balance delta for `Spot`,
  `Deposit`, and `Withdraw` rows; account-history `Fee` is evidence for
  accounting analysis, not an additional liquid balance delta.
- The account reconciliation command boundary and asset-screening policy are
  already implemented.
- EVM-family stress validation is already implemented as a repeatable CLI gate.
- Source activity identity is generic stable key plus origin; blockchain hash
  is source metadata.
- Balance identity is owner account plus asset plus balance category.
- Cosmos Hub stays disabled for user-facing import until full-history backfill
  or opening snapshots exist.

Smells to watch:

- Some live providers and exchange scopes still emit liquid reference rows only.
  Solana now emits category-aware staking reference rows when current stake
  accounts are discoverable, but historical staking openings still require
  explicit audit evidence.
- Exchange APIs may report on-chain fees without chain-native asset identity;
  those fees are retained as balance-neutral diagnostics until linking or
  on-chain evidence can attach richer identity.
- KuCoin account-history `Spot`, `Deposit`, and `Withdraw` rows are still
  skipped when dedicated CSV sections are present because they duplicate the
  materialized rows. A future fallback for account-history-only imports needs
  explicit duplicate detection and must not subtract account-history fees twice.
- `balance-v2` is now a compatibility facade over `ledger-balance`; remove or
  rename it before the migration is considered complete.
- Cross-source relationships now have a dedicated materialization path, but
  persisted gaps and reviewed-override revoke/dismiss flows still need to land
  before the user-facing workflow is complete.
- Reviewed relationship overrides are now allocation-native and reversible, but
  pending review-item dismissals still need a stable identity policy before
  becoming durable.
- Bridge and asset-migration relationship kinds are valid relationship truth.
  Manual and reviewed proposal paths exist; auto-materialization still needs
  strict evidence before it should be allowed.
- `unresolvedAllocationCount` and `confidence_score` are populated
  end-to-end. Future relationship read-model fields should get the same
  persistence and CLI coverage before being advertised.
- The canonical v2 linking command is `links-v2`; do not reintroduce a second
  `ledger linking-v2` surface unless the command owns meaningfully different
  ledger operations.
- The old linking package contains useful behavior evidence, but reusing its
  movement-oriented utilities directly would keep the legacy model alive inside
  the ledger rewrite.
- Substrate ledger-v2 currently materializes native assets only. Asset Hub,
  parachain tokens, and richer batch/proxy/multisig decomposition need provider
  token/event identity before they should be treated as complete accounting
  facts.
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
- Solana native stake-account reward splitting currently handles imported
  create/close lifecycles. More complex split, merge, partial withdrawal, or
  pre-history stake-account cases still need dedicated fixtures before consumer
  cutover.
