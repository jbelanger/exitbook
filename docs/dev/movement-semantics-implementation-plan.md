---
last_verified: 2026-04-12
status: active
---

# Movement Semantics Implementation Plan

Owner: Codex + Joel
Canonical spec:

- [movement-semantics-and-diagnostics.md](/Users/joel/Dev/exitbook/docs/specs/movement-semantics-and-diagnostics.md)

## Goal

Implement the movement-semantics model in clean, independent phases.

Each phase must:

1. have a narrow boundary
2. land fully
3. be verified in isolation
4. leave no active legacy path behind

We do not continue to the next phase until the current one is functionally complete and reviewed.

## Non-Negotiable Rules

1. No chain-specific accounting or linking behavior.
2. Processor-specific knowledge is allowed only upstream, and it must emit generic semantics.
3. No mixed machine/user note model survives the final refactor.
4. No long-lived compatibility shim without an explicit removal phase.
5. Every phase must end with:
   - targeted tests
   - package builds
   - at least one live integration check when the phase affects persisted data or CLI workflows

## Current State

### Completed Phase 1: Machine State Split

Status: complete
Commit:

- `7abdd0f0a` `Separate transaction diagnostics from user notes`

Delivered:

- `Transaction.diagnostics`
- `Transaction.userNotes`
- `transaction-user-note` override path
- persistence split between diagnostics and user notes
- `transaction_movements.movement_role`
- draft canonical spec

Completion check:

- code committed
- tests green
- builds green

### Phase 2: Transfer-Eligible Movement Adoption

Status: complete
Commit:

- `d79253570` `Honor movement roles in transfer analysis`

Delivered:

- generic transfer-eligibility helpers in core
- Cardano emits `movementRole='staking_reward'` for attributable staking withdrawals
- linking, same-hash scoping, cost-basis scoping, and gaps use transfer-eligible movements
- live reprocess + `links run` verified

Implementation check:

- code committed
- tests green
- builds green
- live Cardano ADA case no longer blocks linking

### Phase 2.5: Cross-Chain Movement-Role Producer Analysis

Status: complete
Goal:

- identify other processors that can emit deterministic generic `movementRole` values
- keep the producer side generic across chains before we move deeper into consumer migration

### Why This Is Still Part Of Phase 2

Phase 2 is not only “make one producer work.”

It is the phase where we define whether `movementRole` is:

- a one-off Cardano fix
- or a genuinely reusable upstream contract

If we move into broader consumer migration without checking other candidate producers, we risk:

- overfitting the model to Cardano
- migrating consumers before we know the next deterministic producer set
- discovering missing role shapes too late

So this is analysis work, but it is still foundational Phase 2 work.

### Scope

This is analysis first, not implementation first.

We should inspect processors and classify candidate uses of:

- `staking_reward`
- `protocol_overhead`
- `refund_rebate`

We should explicitly reject cases that are better represented as:

- `transactionDiagnostics`
- existing `fees[]`
- manual review only

### Required Survey Areas

#### 2.5.1 Solana

Primary files:

- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/solana/processor.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/solana/processor-utils.ts`

Questions:

- which native balance debits are deterministic `protocol_overhead` candidates?
- are ATA rent/account-creation legs strong enough for a role?
- are tiny native rebates deterministic enough for `refund_rebate`, or should they remain principal/uncategorized?

#### 2.5.2 Cosmos-family chains

Primary files:

- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/cosmos/processor.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/cosmos/processor-utils.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/injective/` if applicable through shared Cosmos logic

Questions:

- do staking reward withdrawals already appear with deterministic evidence?
- are bridge-related legs diagnostics only, or do any movements deserve non-principal roles?
- are there protocol overhead or rebate patterns that are deterministic enough for roles?

#### 2.5.3 NEAR / account-creation style chains

Primary files:

- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/processor.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/processor-utils.ts`

Questions:

- are account-creation/storage deposits better modeled as `protocol_overhead`?
- is the evidence deterministic, or does it remain too ambiguous?

#### 2.5.4 Other reward-bearing chains

Targets depend on actual processor support in the repo, but the survey must explicitly check whether any existing processor can already deterministically emit:

- staking reward withdrawals
- protocol rebates
- non-principal refund legs

### Deliverable

Produce a concrete inventory table with, for each candidate pattern:

- chain / processor
- example shape
- proposed role or rejection
- confidence level
- why it is deterministic or why it must stay out of the model
- whether it belongs in Phase 4 implementation or should be rejected entirely

### Acceptance Criteria

Phase 2 is only fully complete when:

- the cross-chain producer analysis is written down in this doc or a linked companion note
- every surveyed pattern is explicitly classified as:
  - implement as movement role
  - keep as diagnostics
  - keep as fee
  - keep as manual review
- we have a defensible shortlist for the next producer implementations
- we have explicitly rejected any pattern that would force chain-specific accounting behavior

### Phase 2.5 Inventory

| Chain / processor | Deterministic pattern                                                                   | Decision                                          | Why                                                                                                                                                                    | Next action                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Cardano           | Wallet-scoped staking withdrawal attributable to one owned input address                | `movementRole='staking_reward'`                   | Provider now exposes withdrawal amount, and the processor can attribute it safely only when ownership is unambiguous                                                   | Implemented in Phase 2                                                       |
| Solana            | Native staking reward inflow with stake-program evidence and no competing principal leg | Candidate `movementRole='staking_reward'`         | Current processor already classifies clear reward-only staking flows at the transaction level; movement role can reuse the same deterministic boundary                 | Phase 4 candidate                                                            |
| Solana            | ATA rent / account-creation funding / setup outflow                                     | Reject for now                                    | Real pattern exists, but the current evidence lives in transaction shape and program patterns that are still too easy to overfit in a generic role contract            | Keep as diagnostics / manual review until a second deterministic case exists |
| Solana            | Tiny native rebate / rent reclaim                                                       | Reject for now                                    | Small native inflows are not reliably distinguishable from dust, refund, or correlated swap residue in the current processor model                                     | Keep uncategorized or cue-only                                               |
| Cosmos-family     | Bridge deposit / bridge withdrawal                                                      | Keep as `transactionDiagnostics`                  | Shared Cosmos processor already emits deterministic `bridge_transfer`; these are transfer-adjacent semantics, not non-principal movement roles                         | Leave in diagnostics                                                         |
| Cosmos-family     | Swap / batch / uncertain contract flows                                                 | Keep as `transactionDiagnostics` or manual review | Current evidence is structural but not movement-role-shaped                                                                                                            | Leave out of role model                                                      |
| Cosmos-family     | Staking reward / refund                                                                 | Reject for now                                    | Shared processor does not currently expose a deterministic, generic movement-level signal equivalent to Cardano/NEAR/Substrate                                         | No Phase 4 work until provider evidence improves                             |
| NEAR              | Receipt balance-change cause `CONTRACT_REWARD` on inflow-only native movement           | Candidate `movementRole='staking_reward'`         | The processor already classifies these transactions as staking rewards from explicit receipt causes                                                                    | Phase 4 candidate                                                            |
| NEAR              | Receipt balance-change cause `GAS_REFUND` on inflow-only native movement                | Candidate `movementRole='refund_rebate'`          | Explicit cause exists in normalized data and is stronger than heuristic refund inference                                                                               | Phase 4 candidate after verification against real cases                      |
| NEAR              | `create_account` / storage-deposit style outflows                                       | Reject for now                                    | The chain can prove account-creation intent at the transaction level, but the specific non-principal balance leg is not yet isolated cleanly enough for a generic role | Keep as diagnostics / manual review until evidence is cleaner                |
| Substrate         | Inflow-only staking reward transactions                                                 | Candidate `movementRole='staking_reward'`         | Processor already classifies deterministic staking reward shapes from module/call plus flow direction                                                                  | Phase 4 candidate                                                            |
| Substrate         | Governance refund inflows                                                               | Candidate `movementRole='refund_rebate'`          | Governance refund is already explicit at transaction classification time and maps cleanly to a non-principal inflow role                                               | Phase 4 candidate after targeted validation                                  |
| EVM               | Beacon withdrawal `< 32 ETH`                                                            | Candidate `movementRole='staking_reward'`         | Current processor already treats these as partial withdrawals / staking rewards with explicit `consensus_withdrawal` diagnostics                                       | Phase 4 candidate                                                            |
| EVM               | Beacon withdrawal `>= 32 ETH`                                                           | Reject as role                                    | Full withdrawal can include principal return plus rewards, so a single non-principal movement role would overstate certainty                                           | Keep as principal movement plus diagnostic                                   |
| Theta             | Account-based contract interaction / transfer flows                                     | Reject for now                                    | Theta inherits the generic EVM account-based flow model but has no repo-local deterministic non-principal producer yet                                                 | No Phase 4 work                                                              |
| Bitcoin           | UTXO send / receive / change model                                                      | Reject for now                                    | Current processor only exposes net principal flow and fee, with no deterministic non-principal movement beyond existing fee handling                                   | No role work                                                                 |
| XRP               | Balance-change transfer model                                                           | Reject for now                                    | Current processor only exposes principal net movement plus fee; no deterministic non-principal movement source is modeled                                              | No role work                                                                 |

### Phase 2.5 Producer Shortlist

The next movement-role producers should stay narrow:

1. `NEAR` contract rewards as `staking_reward`
2. `Substrate` staking reward inflows as `staking_reward`
3. `EVM` partial beacon withdrawals as `staking_reward`
4. `NEAR` gas refunds as `refund_rebate`, but only after a real-case audit
5. `Substrate` governance refunds as `refund_rebate`, but only after a real-case audit

Explicit non-goals from this analysis:

- no shared Cosmos `movementRole` work yet
- no Solana `protocol_overhead` role yet
- no chain-specific downstream exceptions in accounting/linking/gaps
- no use of diagnostics as a backdoor substitute for deterministic movement roles

## Active Phase

Current active phase:

- `Phase 3: Diagnostics Consumer Migration` is complete in the current worktree
- next phase remains `Phase 4: Additional Deterministic Movement-Role Producers`

## Phase 3: Diagnostics Consumer Migration

Status: complete
Goal:

- remove remaining machine workflow dependence on legacy `notes` semantics
- make `diagnostics` the machine state surface
- keep `userNotes` user-only

### Why This Phase Comes Next

The current architecture is still split:

- some machine workflows already read `diagnostics`
- some still depend on old note-style semantics or mixed fields

Until this phase is complete, the model is still conceptually duplicated.

### Scope

Move machine consumers to `diagnostics` in these areas:

- readiness/reporting
- balance/review policy
- scam/suspicious review surfaces
- transaction rendering/export where system state is displayed

Do not broaden this phase into new movement-role producers.

### Planned Work

#### Step 3.1: Inventory every machine consumer of note-like state

Primary files to inspect and classify:

- `/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/export/tax-package-readiness-metadata.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-workflow.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/asset-review/asset-review-service.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/scam-detection/`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/links/`

Output of this step:

- list each consumer
- identify current source:
  - `diagnostics`
  - legacy note semantics
  - mixed/duplicated
- assign each to a concrete migration subtask

Acceptance criteria:

- no vague “we’ll catch the rest later” list
- every consumer is explicitly categorized

Inventory result:

| Surface                                    | Primary file(s)                                                                                                                                                                                         | Current source                                               | Status                          | Required action                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Tax readiness / accounting export metadata | `/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/export/tax-package-readiness-metadata.ts`                                                                                                  | `diagnostics` only                                           | Mostly migrated                 | Behavior is already correct; rename stale `noteType` / `noteMessage` DTO fields to `diagnosticCode` / `diagnosticMessage` in Step 3.2 |
| Balance exclusion / scam balance filtering | `/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-workflow.ts`                                                                                                                  | `diagnostics` via shared helper                              | Migrated                        | No remaining model work; keep spam/scam checks routed through one shared helper                                                       |
| Asset review summary building              | `/Users/joel/Dev/exitbook/packages/ingestion/src/features/asset-review/asset-review-service.ts`                                                                                                         | `diagnostics` only                                           | Migrated                        | No separate spam projection remains; asset review now derives scam evidence directly from diagnostics                                 |
| Scam detection producer/service            | `/Users/joel/Dev/exitbook/packages/ingestion/src/features/scam-detection/scam-detection-utils.ts`, `/Users/joel/Dev/exitbook/packages/ingestion/src/features/scam-detection/scam-detection-service.ts`  | `TransactionDiagnostic` production                           | Migrated behavior, stale naming | No model change needed; remove stale `note` variable/comment naming in Step 3.3                                                       |
| Transaction projection for CLI/TUI         | `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts`                                                                                                            | `diagnostics` + `userNotes`                                  | Migrated                        | No behavior work needed                                                                                                               |
| Transaction static/TUI rendering           | `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/view/transactions-static-renderer.ts`, `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/view/transactions-view-components.tsx` | `diagnostics` + `userNotes`                                  | Migrated                        | No behavior work needed                                                                                                               |
| Transaction export                         | `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/command/transactions-export-utils.ts`                                                                                                      | `diagnostics` + `userNotes` explicit in JSON and CSV outputs | Migrated                        | Keep diagnostics and user notes explicit in export contracts                                                                          |
| Links feature                              | `/Users/joel/Dev/exitbook/apps/cli/src/features/links/`                                                                                                                                                 | No note-like machine consumer found                          | Clean                           | No Phase 3 migration work required here                                                                                               |

Step 3.1 conclusion:

- there is no active machine workflow still branching on legacy `Transaction.notes`
- the remaining work is mostly:
  - stale machine terminology (`note*` names for diagnostics)
  - transaction export/product decision on whether diagnostics and user notes should be exported explicitly

First migration slice after inventory:

1. Step 3.2 should start with accounting/reporting naming cleanup in `tax-package-readiness-metadata.ts`
2. Step 3.3 should then clean ingestion/review naming and spam-contract boundaries
3. Step 3.4 should finish the operator-facing export/render decision

#### Step 3.2: Migrate accounting/reporting consumers

Initial targets:

- `/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/export/tax-package-readiness-metadata.ts`

Expected change:

- readiness metadata reads typed diagnostic codes instead of note strings

Acceptance criteria:

- no machine branching on legacy note content in accounting export/readiness paths
- regression coverage for migrated diagnostic codes

Current status:

- completed for the readiness/reporting slice
- stale export/readiness DTO fields now use `diagnosticCode` / `diagnosticMessage`
- review-gate messaging now refers to diagnostics, not import notes

#### Step 3.3: Migrate ingestion/balance/review consumers

Primary targets:

- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-workflow.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/asset-review/asset-review-service.ts`
- relevant scam-detection outputs under `/Users/joel/Dev/exitbook/packages/ingestion/src/features/scam-detection/`

Expected change:

- policy and review flows consume `diagnostics`, not note parsing

Acceptance criteria:

- balance/review behavior is derived from diagnostics
- no machine consumer uses the free-form user-note surface

Current status:

- completed
- live ingestion/review code now uses diagnostic terminology internally instead of note terminology
- scam/spam checks now resolve from diagnostics only through shared helpers for balance/gaps/views
- downstream runtime consumers now interpret scam-like diagnostics through shared assessment helpers instead of branching on `SCAM_TOKEN` / `SUSPICIOUS_AIRDROP` ad hoc
- persisted asset-review evidence vocabulary has been renamed away from `*-note` to `*-diagnostic`
- the derived `spam-flag` asset-review evidence was removed because it duplicated `SCAM_TOKEN` diagnostics

#### Step 3.4: Migrate CLI/view/export surfaces

Primary targets:

- `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/view/transactions-static-renderer.ts`
- transaction export helpers under `/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/command/`

Expected change:

- system-authored state renders from `diagnostics`
- user-authored state renders from `userNotes`
- no ambiguous shared “notes” surface in active code paths

Acceptance criteria:

- UI clearly separates system diagnostics from user notes
- export format is explicit about which field is which

Current status:

- transaction projection and render surfaces were already clean
- export is now explicit:
  - JSON includes `diagnostics` and `userNotes`
  - simple CSV includes flattened diagnostic/user-note columns
  - normalized CSV includes dedicated diagnostics and user-notes files
- stored `isSpam` has been removed from the transaction model and persistence
- asset review no longer synthesizes a duplicate `spam-flag` evidence kind from `SCAM_TOKEN` diagnostics

#### Step 3.5: Remove remaining machine-note legacy

This is the removal step and must be explicit.

Targets depend on what Step 3.1 finds, but final state must be:

- no active machine workflow depends on `Transaction.notes`
- no machine-authored processor output is written as a user note
- no active CLI/render/export code conflates diagnostics and user notes

Acceptance criteria:

- repository search confirms machine consumers no longer branch on legacy note semantics
- any compatibility bridge introduced during Phase 3 is removed before phase completion

Current status:

- completed
- final cleanup removed the last transactions-view spam shim and now routes flag rendering through shared diagnostic helpers
- stale note-era wording was removed from the remaining processor comments, docs, and diagnostics-oriented tests touched by Phase 3

### Verification

Required before Phase 3 is marked complete:

- targeted tests for each migrated consumer
- `pnpm --filter @exitbook/accounting build`
- `pnpm --filter @exitbook/ingestion build`
- `pnpm --filter ./apps/cli build`
- one live command verification for at least:
  - `pnpm run dev links gaps --json`
  - a transaction/render surface affected by the migration

Verification completed in the current worktree:

- targeted test slices across core, accounting, data, ingestion, assets, and transactions are green
- `pnpm --filter @exitbook/core build`
- `pnpm --filter @exitbook/data build`
- `pnpm --filter @exitbook/ingestion build`
- `pnpm --filter @exitbook/accounting build`
- `pnpm --filter ./apps/cli build`
- `pnpm run dev links gaps --json`
- `pnpm run dev transactions view e9cf3d8fb7 --json`

## Future Phases

These are intentionally blocked until Phase 3 is complete.

## Phase 4: Additional Deterministic Movement-Role Producers

Status: active
Goal:

- add new upstream producers only where evidence is deterministic

### Why Phase 4 Starts With EVM Beacon Withdrawals

Phase 4 must continue in the narrowest possible slices.

Current audit finding:

- `EVM` partial beacon withdrawals are the strongest next producer
- `NEAR` contract rewards are also promising, but the movement extraction and receipt correlation surface is broader
- `Substrate` staking rewards are straightforward, but the current processor shape is less isolated than the dedicated EVM beacon-withdrawal path
- `refund_rebate` candidates (`NEAR` gas refunds, `Substrate` governance refunds) remain Phase 4 follow-ups, not the opening slice

Reason:

- EVM beacon withdrawals already arrive as a dedicated normalized transaction type (`beacon_withdrawal`)
- the processor already emits deterministic `consensus_withdrawal` diagnostics
- the existing 32 ETH threshold already splits partial reward-like withdrawals from full principal-return-like withdrawals
- this lets us add one deterministic `staking_reward` producer without widening the movement-role boundary or inventing new heuristics

### Findings Surfaced During Phase 4 Audit

- `EVM` partial beacon withdrawals are more isolated than expected because they already have:
  - a dedicated normalized transaction type
  - a dedicated diagnostic (`consensus_withdrawal`)
  - a pre-existing principal-vs-reward threshold boundary
- `NEAR` remains a good producer candidate, but the implementation surface is broader than the initial shortlist implied because movement extraction, receipt correlation, and operation classification are split across multiple modules.
- `Substrate` staking rewards are deterministic, but movement-role assignment is currently coupled to generic movement construction more tightly than in the EVM beacon-withdrawal path.
- `refund_rebate` candidates still need real-case validation. The processor classification signals look promising, but they are not yet enough to justify immediate producer work.
- the shared correlated-transaction processor needed optional `movementRole` support, and EVM consolidation needed to become role-aware so future correlated producers do not silently merge `principal` and non-principal movements of the same asset.
- the current dev dataset has no imported beacon-withdrawal examples, so live verification for Phase 4.1 must rely on pipeline safety checks plus targeted regression coverage rather than a real local transaction replay.

### Phase 4 Slice Order

#### Phase 4.1: EVM Partial Beacon Withdrawals

Status: complete

Scope:

- assign `movementRole='staking_reward'` to inflow movements for beacon-withdrawal groups where:
  - a `beacon_withdrawal` normalized transaction is present
  - the processed classification remains `staking/reward`
  - the withdrawal amount is `< 32 ETH`
- keep `>= 32 ETH` full-withdrawal cases as principal movements with diagnostics only

Primary files:

- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor-utils.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/__tests__/processor.test.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/__tests__/processor-utils.test.ts`

Acceptance criteria:

- partial beacon withdrawals persist `movementRole='staking_reward'` on inflows
- full withdrawals do not get a non-principal role
- no accounting/linking/gaps special-casing is added
- targeted tests and package builds pass

Completion notes:

- implemented in the current worktree
- the shared correlated-transaction processor now preserves optional `movementRole`
- EVM movement consolidation is role-aware, so non-principal inflows will not be silently merged back into principal movements of the same asset
- targeted tests passed
- `pnpm --filter @exitbook/core build`
- `pnpm --filter @exitbook/ingestion build`
- `pnpm --filter @exitbook/accounting build`
- `pnpm run dev reprocess`
- `pnpm run dev links run --json`

#### Phase 4.2: NEAR Contract Rewards

Status: completed

Scope:

- assign `movementRole='staking_reward'` only for native inflow movements derived from receipt balance-change cause `CONTRACT_REWARD`
- do not widen to `GAS_REFUND` in the same slice

Primary files:

- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/near-fund-flow-extraction.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/near-operation-classification.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/processor.ts`

Open finding from audit:

- NEAR file layout is split across correlation, flow extraction, and operation classification. This is still a good candidate, but it is a broader edit surface than EVM beacon withdrawals.

Acceptance criteria:

- receipt-backed native `CONTRACT_REWARD` inflows persist `movementRole='staking_reward'`
- synthetic transaction-level fallback does not get a non-principal role
- no accounting/linking/gaps special-casing is added
- targeted tests and package builds pass

Completion notes:

- implemented in the current worktree
- NEAR movement consolidation is now role-aware, so future same-asset non-principal inflows will not be silently merged into principal inflows
- `receipt.isSynthetic` is the load-bearing boundary for safe producer behavior in this slice; receipt-backed reward evidence is deterministic enough, synthetic fallback is not
- NEAR transaction-level operation classification remains intentionally broader than movement-role assignment in this slice; `staking/reward` can still be inferred from reward-like causes even when no movement role is assigned
- targeted tests passed
- `pnpm --filter @exitbook/core build`
- `pnpm --filter @exitbook/ingestion build`
- `pnpm --filter @exitbook/accounting build`
- `pnpm run dev reprocess`
- `pnpm run dev links run --json`

Findings worth revisiting:

- the rebuilt local workspace still has `0` processed NEAR `staking/reward` transactions and `0` raw `CONTRACT_REWARD` examples, so this slice is validated by regression coverage and pipeline safety checks rather than live local data
- `GAS_REFUND` should stay out of scope until we have real examples; the current cause vocabulary is not enough on its own to justify `refund_rebate`
- NEAR's split across correlation, flow extraction, and operation classification remains a real edit-surface smell, but the current seam is acceptable because the role assignment stays isolated to flow extraction and processor output

#### Phase 4.3: Substrate Staking Rewards

Status: completed

Scope:

- assign `movementRole='staking_reward'` only for inflow-only native staking reward transactions already classified as `staking/reward`

Primary files:

- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/substrate/processor-utils.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/substrate/processor.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/substrate/__tests__/processor.test.ts`

Open finding from audit:

- Substrate reward classification is deterministic, but the processor does not currently isolate movement-role assignment from general movement construction as cleanly as the EVM beacon-withdrawal path.

Acceptance criteria:

- inflow-only native `staking/reward` transactions persist `movementRole='staking_reward'` on inflows
- non-reward staking operations do not get a non-principal role
- no accounting/linking/gaps special-casing is added
- targeted tests and package builds pass

Completion notes:

- implemented in the current worktree
- movement-role assignment stays at the processor seam and is derived from the already-classified `staking/reward` shape rather than widening raw fund-flow analysis
- targeted tests passed, including processor fee-accounting coverage for reward payouts
- `pnpm --filter @exitbook/core build`
- `pnpm --filter @exitbook/ingestion build`
- `pnpm --filter @exitbook/accounting build`
- `pnpm run dev reprocess`
- `pnpm run dev links run --json`

Findings worth revisiting:

- the rebuilt local workspace still has `0` processed Substrate `staking/reward` transactions and `0` raw staking reward examples, even though it now contains `polkadot` and `bittensor` transactions; this slice is validated by regression coverage and pipeline safety checks rather than live local data
- Substrate was a better fit for processor-level role derivation than fund-flow-level role tagging because reward classification is already deterministic and centralized enough to reuse cleanly
- the current scope should stay native-only until Substrate multi-asset support exists; `SubstrateMovement` still lacks token identity fields for parachain assets

#### Phase 4.4: Refund / Rebate Candidates

Status: blocked

Candidates:

- `NEAR` `GAS_REFUND` inflows -> possible `refund_rebate`
- `Substrate` governance refund inflows -> possible `refund_rebate`

Required gate before implementation:

- real-case audit showing these are balance-affecting but non-principal inflows with stable evidence

### Explicit Phase 4 Non-Goals

- no Solana `protocol_overhead` role in this phase
- no cue work in `links gaps`
- no chain-specific downstream branching in accounting, linking, or gap analysis
- no `refund_rebate` producer without a real-case audit and isolated test coverage

Likely candidates after the opening slice:

- protocol overhead cases with strong evidence
- refund/rebate cases with strong evidence

This phase must not begin until diagnostics migration is complete, otherwise we will widen the model faster than the consumers can use it cleanly.

## Phase 5: Replay and Compatibility Validation Hardening

Status: blocked
Goal:

- validate semantic compatibility for replayed or persisted transfer-related state

Likely targets:

- link replay and confirmation
- any movement-referenced override path that depends on transfer eligibility

Note:

- the design rule is already in the spec
- this phase is about exhaustive implementation and validation

## Cross-Cutting Finding: Exact Explained Residuals Need Downstream Completion

Live Cardano verification on hash `0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf` surfaced an important boundary:

- transfer linking can already be correct once same-hash partial targets accept one exact typed residual
- that is not sufficient on its own unless downstream consumers also treat the exact residual as explained

Completion slice landed on `2026-04-12`:

- exact same-hash residual metadata now has a shared core helper instead of ad hoc metadata reads
- Canada tax projection now classifies an exact explained staking residual acquisition as `incomeCategory='staking_reward'`
- `links gaps` now suppresses fully explained exact staking residuals from the open transfer-review surface

Why this matters:

- we do not need fake source transactions or wallet-scope processing exceptions to finish this class of case
- we also do not need user action for fully explained residuals that are exact and deterministic
- future residual categories must meet the same bar:
  - exact amount
  - typed role
  - no heuristic inference

Open caution:

- this pattern is intentionally narrow
- unexplained residuals must still remain visible and reviewable
- future residual-role expansion should reuse the same exactness contract rather than growing chain-specific exceptions

## Phase 6: Broader Consumer Adoption Outside Transfer Workflows

Status: blocked
Goal:

- adopt movement semantics and diagnostics in non-transfer domains that materially benefit

Possible targets:

- price enrichment
- portfolio presentation
- transaction export/reporting refinements

This phase is optional until there is a concrete problem to solve.

## Relationship To Pattern Investigation

Pattern work is tracked separately in:

- [linking-pattern-investigation-plan.md](/Users/joel/Dev/exitbook/docs/dev/linking-pattern-investigation-plan.md)

Rule:

- no new pattern-specific strategy or cue work should outrun the foundation phases here
- if a pattern requires semantics the model cannot yet express cleanly, the foundation phase takes priority
