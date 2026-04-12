# Linking Pattern Investigation Plan

Status: active dev plan
Owner: Codex + Joel
Origin surface: `exitbook links gaps`
Priority rule: investigate safe linking before adding or keeping gap cues

## Goal

Track recurring unresolved-gap patterns as separate investigations.

Each pattern must answer one question first:

- can this be turned into a safe, auditable linking strategy?

If the answer is no, the fallback is:

- existing upstream classification -> gap cue
- new narrow gap cue
- manual review with no new behavior

This plan replaces the shipped cue-only tracker. The current shipped cue behavior already lives in:

- [links-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-view-spec.md)
- [override-event-store-and-replay.md](/Users/joel/Dev/exitbook/docs/specs/override-event-store-and-replay.md)

## Non-Negotiable Rules

1. Do not merge unrelated patterns into one generic heuristic.
2. A linking strategy must be deterministic and auditable.
3. Cross-asset correlation is not a transfer link.
4. If the evidence is only timing/proximity, default to cue or manual review, not linking.
5. Prefer existing hard evidence over new inference:
   - shared blockchain transaction hash
   - exact amount conservation
   - explicit upstream note such as `bridge_transfer`
   - known bridge/deposit address semantics
6. Every new strategy or cue needs both positive and negative regressions from real cases in this backlog.

## Decision Ladder

Apply this in order for every pattern:

1. **Safe linking**
   - Can we express it as a real `transaction_link` strategy without weakening transfer semantics?
2. **Existing classification**
   - Is there already a stored note or transaction flag we should consume in `links gaps`?
3. **Narrow cue**
   - Can we add an honest cue without suppressing the row?
4. **Manual review**
   - If none of the above is strong enough, leave the gap visible and let the user resolve it explicitly.

## Cross-Cutting Questions

These questions apply to every pattern:

- Is the issue caused by ingestion shape, linking strategy, or gap presentation?
- Is there a single hard signal, or are we combining weak signals?
- Would the behavior belong in `accounting/linking`, in a processor, or only in the gaps lens?
- If linking is possible, is it 1:1, 1:N, N:1, or N:N?
- If linking is not possible, is the right fallback a cue or upstream suppression/classification?

## Track 0: Movement Semantics and Diagnostics Foundation

Status: implementation mostly complete; remaining follow-up is data-validation and replay hardening
Expected value: very high
Likely destination: cross-cutting core/persistence/processing refactor

Canonical spec draft:

- [movement-semantics-and-diagnostics.md](/Users/joel/Dev/exitbook/docs/specs/movement-semantics-and-diagnostics.md)

Execution tracker:

- [movement-semantics-implementation-plan.md](/Users/joel/Dev/exitbook/docs/dev/movement-semantics-implementation-plan.md)

### Why This Comes First

The ADA staking-withdrawal case exposed the real architectural gap:

- processors can know that a movement is **not** transfer principal
- downstream linking/cost-basis/gaps only see raw inflows/outflows
- `Transaction.notes` are currently doing machine work they are not strong enough to own

If we keep solving these cases with downstream heuristics, we will accumulate:

- chain-specific transfer exceptions in `accounting`
- more note-type parsing across unrelated packages
- more gap-only behavior that does not improve the underlying model

The right fix is a shared semantic layer:

- first-class `movementRole` on every inflow/outflow
- typed `transactionDiagnostics` for machine-authored review signals
- `userNotes` reserved for human-authored notes only

Identity rule from the draft spec:

- semantic refactors must not churn `movementFingerprint`
- Track 0 therefore includes replay/override compatibility validation where movement semantics matter

### Benefit Scan Across the Codebase

#### 1. Linking and Same-Hash Scoping

Current consumers:

- `packages/accounting/src/linking/pre-linking/build-linkable-movements.ts`
- `packages/accounting/src/linking/pre-linking/group-same-hash-transactions.ts`
- `packages/accounting/src/cost-basis/standard/matching/build-cost-basis-scoped-transactions.ts`

Benefit:

- transfer logic can consume **transfer-eligible** movements instead of raw inflow/outflow presence
- ADA staking-withdrawal cases stop looking like mixed transfer participants
- future protocol-overhead movements do not require chain-specific exceptions in linking

#### 2. Gap Analysis

Current consumer:

- `packages/accounting/src/linking/gaps/gap-analysis.ts`

Benefit:

- deterministic non-transfer movements stop appearing as unmatched transfer gaps
- gap cues can combine typed diagnostics with movement roles instead of ad hoc note parsing
- fewer suppression heuristics in the gaps lens

#### 3. Cost Basis and Transfer Scoping

Current consumers:

- `packages/accounting/src/cost-basis/standard/matching/build-cost-basis-scoped-transactions.ts`
- `packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts`

Benefit:

- mixed-intent transactions stop forcing false transfer ambiguity
- transfer-source accounting can stay generic while processors remain chain-aware
- non-principal reward or overhead legs remain in accounting without pretending to be transfer legs

#### 4. Balance and Portfolio

Current consumers:

- `packages/ingestion/src/features/balance/balance-workflow.ts`
- `packages/accounting/src/portfolio/portfolio-handler.ts`

Benefit:

- balance math still counts all movements, but the semantic distinction becomes explicit
- spam/policy decisions remain separate from movement semantics
- protocol-overhead handling becomes explainable without changing balance-impact math

#### 5. Tax Readiness and Reporting

Current consumer:

- `packages/accounting/src/cost-basis/export/tax-package-readiness-metadata.ts`

Current smell:

- readiness metadata currently scans note types such as `allocation_uncertain` and `classification_uncertain`

Benefit:

- reporting can consume typed diagnostics instead of note strings
- readiness output becomes more stable and easier to evolve

#### 6. Asset Review and Scam Detection

Current consumers:

- `packages/ingestion/src/features/asset-review/asset-review-service.ts`
- `packages/ingestion/src/features/scam-detection/`

Current smell:

- scam and suspicious-airdrop state can still be missing upstream even though diagnostics are now the only machine signal

Benefit:

- scam/suspicious state can stay in typed diagnostics
- review workflows stop depending on free-form note arrays or duplicate spam flags

#### 7. Persistence and Override Model

Current consumers:

- `packages/data/src/repositories/transaction-materialization-support.ts`
- `packages/data/src/overrides/transaction-user-note-replay.ts`
- `packages/core/src/override/override.ts`

Current smell:

- user-note overrides currently need a dedicated `user_notes_json` projection separate from processor-authored diagnostics

Benefit:

- machine-authored state and user-authored notes stop sharing a field
- override scope becomes user-note-only instead of mutating machine state

#### 8. Transaction UX and Export

Current consumers:

- `apps/cli/src/features/transactions/transaction-view-projection.ts`
- `apps/cli/src/features/transactions/view/transactions-static-renderer.ts`
- `apps/cli/src/features/transactions/command/transactions-export-utils.ts`

Benefit:

- UI can present user notes separately from system diagnostics
- exports can carry typed diagnostics explicitly instead of flattening note strings
- operators no longer have to guess whether a note is human-authored or machine-authored

#### 9. Price Enrichment and Price Derivation

Current consumers:

- `packages/accounting/src/price-enrichment/enrichment/price-inference-rules.ts`
- `packages/accounting/src/price-enrichment/enrichment/price-normalization-utils.ts`

Benefit:

- transaction-level price inference can reason over principal movements without accidentally treating protocol-overhead or reward legs as trade legs
- link-propagated and ratio-derived pricing becomes easier to constrain to economically meaningful movements
- price enrichment stays generic instead of learning chain-specific exclusions

### Delivery Rule

Track 0 is no longer “investigate while doing other things.”

It is now a gated implementation track with explicit phases:

1. finish the active phase in the implementation plan
2. verify it fully
3. only then resume downstream pattern-specific work

No pattern track below should start new implementation work that depends on unresolved Track 0 semantics.

### Current Foundation State

- Phase 1 complete: machine-authored diagnostics and user notes are separated
- Phase 2 complete: transfer-oriented consumers now use transfer-eligible movements
- Phase 2.5 complete: cross-chain producer audit is written in the implementation plan
- Phase 3 complete: diagnostics migration is done and legacy note-era machine state is removed
- Phase 4.1 complete: `EVM` partial beacon withdrawals emit `movementRole='staking_reward'`
- Phase 4.2 complete: `NEAR` receipt-backed `CONTRACT_REWARD` emits `movementRole='staking_reward'`
- Phase 4.3 complete: `Substrate` inflow-only `staking/reward` emits `movementRole='staking_reward'`

Current producer shortlist from that audit:

- `NEAR` gas refunds -> possible `refund_rebate`
- `Substrate` governance refunds -> possible `refund_rebate`

Explicit rejections from the audit:

- no shared Cosmos `movementRole` work yet
- no Solana `protocol_overhead` role yet
- no Bitcoin / XRP / Theta role work at this stage

Remaining foundation follow-up from the implementation plan:

- Phase 4.4: `refund_rebate` candidates need real-case validation before implementation
- Phase 5: replay / compatibility validation hardening

Supporting issue for the remaining live-data / validation cases:

- [GitHub issue #308](https://github.com/jbelanger/exitbook/issues/308)

### What Track 0 Already Unlocked For This Plan

#### Track 1: Shared-hash batched deposit

- The original ADA case is no longer evidence for a new linking strategy.
- Upstream processing now distinguishes staking-reward inflows from transfer-principal movements, so Track 1 can focus on genuine post-foundation N:1 deposit cases.
- This is the clearest example of why Track 0 came first: it removed a false linking problem instead of teaching linking about Cardano.

#### Track 2: Cross-chain migration / bridge-like move

- Existing machine-authored bridge-style semantics now live in typed diagnostics rather than overloaded notes.
- That makes Track 2 cleaner: if we pursue a safe strategy here, it should consume explicit diagnostics or hard bridge evidence first, not stringly note parsing or timing heuristics.

#### Track 3: Same-account service-swap cluster

- This track is still cue-only, but it now lives on top of a cleaner base:
  - gap analysis already consumes transfer-eligible movements
  - diagnostics are first-class
- Track 0 did **not** solve the service-swap cue, but it removed pressure to solve unrelated reward/overhead cases with gap heuristics.

#### Track 4: Promo memo dust / airdrop spam misses

- This is now explicitly an upstream diagnostics problem.
- Once detection improves, gaps policy can consume the diagnostics directly without any special note parsing or duplicate spam flags.

#### Track 5: Protocol overhead / rent / account setup

- This is now a real candidate for a future generic movement-role producer, not just an intuition.
- The foundation means we have a place to put it cleanly if and only if we can prove a deterministic upstream boundary.
- It is still blocked on real evidence and should not be solved with downstream chain-specific logic.

### Consequence For Track 1 (ADA)

The Cardano staking-withdrawal case is no longer just a Track 1 linking investigation.

New sequencing:

1. provider / processor correctness
2. movement semantics foundation
3. rerun the corrected ADA case
4. only then decide whether any linking strategy is still needed

Track 1 should not grow a Cardano-specific linking exception. The original Cardano ambiguity is already resolved by Track 0.

## Pattern Tracks

### Track 1: Shared-Hash Batched Exchange Deposit

Status: investigate first
Expected value: high
Likely destination: linking strategy if safe, otherwise cue

#### Evidence

Confirmed Cardano case:

- blockchain outflows:
  - `68d63d32d3` / tx `78a82e8482` / `ADA 1021.211168`
  - `03e4501552` / tx `d0c794045d` / `ADA 974.843208`
  - `f1c590251b` / tx `712ee1e81a` / `ADA 672.756869`
- exchange inflow:
  - `c6787f8ae9` / tx `38adc7a548` / `ADA 2679.718442`
- shared blockchain hash for all four:
  - `0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf`

The blockchain outflow amounts sum exactly to the exchange inflow amount.

The same database scan also found similar shared-hash multi-row shapes on Bitcoin:

- `2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96`
- `45ec1d9a069424a0c969507f82300f9ef4102ebb0f1921d89b2d50390862c131`
- `12d5b8376d09edf240f39ce7118cb7ed3e1aa6bb13d8cb1b94611b2df1675ff0`
- `0c3ab1cab70b585ee3d64cdfed8fd8b031b303a733e9b8ec441f9ae7d26e3940`
- `c700f28764ab1e7c3c614ee4e2e9535791fcc27b38a68605fc99fa8a0db37f85`

#### Hypothesis

The chain-side provider materializes one transfer row per funded source/account slice, while the exchange import materializes one deposit row for the aggregate on-chain transaction.

This is not a cue-first problem. It looks like a possible N:1 linking strategy.

#### Current Finding

The original Cardano case is still open in `links gaps`, but it is now a cleaner and more auditable Track 1 case than it was before the movement-semantics work.

What happened:

- provider normalization now preserves Blockfrost withdrawals
- Cardano processing now emits `movementRole='staking_reward'` for attributable staking withdrawals
- transfer-oriented consumers now ignore non-principal movements
- the projected blockchain outflows now reconcile cleanly with the exchange inflow once staking withdrawal + fee handling are accounted for

What did **not** happen:

- no links were created for the July 25, 2024 Cardano cluster
- the case still appears as four open ADA gaps in `links gaps`
- the gaps surface still does not reconcile or group the four related rows into one operator action

Result:

- the old semantic ambiguity no longer blocks investigation
- this is now a stronger generic Track 1 example because the residual problem is genuinely about aggregated linking, not missing staking semantics

So this track should now:

- continue to reject any Cardano-specific linking exception
- keep the original Cardano case as a positive shared-hash aggregated-deposit example
- pair it with the Bitcoin shared-hash cases to test whether one generic N:1 strategy can handle both

#### Investigation Questions

1. Are all rows on the same asset id, not just the same symbol?
2. Is the exchange deposit destination the same on-chain address used by the blockchain rows?
3. Is the shared blockchain hash stable across providers and chains?
4. Is the amount conservation exact, or do we need fee-aware tolerance?
5. Is this really linking, or should ingestion collapse these rows upstream?
6. Can one generic strategy explain both the Cardano wallet-scoped case and the Bitcoin shared-hash cases without introducing chain-specific rules in `accounting/linking`?

#### Current UX Limitation

The movement-semantics work improved the underlying data, and `links gaps` now surfaces the key context:

- the Cardano ADA gaps show `staking withdrawal in same tx`
- gap detail shows the full wallet-scoped staking-withdrawal explanation

What the operator still does **not** get is higher-level reconciliation:

Today the user still sees:

- three Cardano ADA outflow gaps
- one exchange ADA inflow gap

What the user still does **not** see as a first-class object:

- that those four rows form one shared-hash aggregated-deposit candidate
- that the blockchain-side rows reconcile cleanly to the exchange inflow once staking withdrawal + fees are accounted for
- a single grouped review action instead of four independent gap rows

This means Track 1 remains a real linking / review-surface problem even though the operator now gets materially better context.

#### Candidate Outcome

Current Cardano case:

- resolved semantically enough to investigate safely
- still unresolved as a linking / review-surface problem

Preferred long-term order:

1. validate the original Cardano case and at least one Bitcoin case after foundation work
2. prove exact amount conservation on both, including fee-aware treatment where needed
3. decide whether one generic shared-hash aggregated-deposit strategy can cover both shapes
4. only if that fails, split the investigation by chain-specific ingestion shape

#### Required Tests

- positive: the original July 25, 2024 Cardano case
- positive: at least one Bitcoin case from the shared-hash scan
- negative: same hash but mismatched asset
- negative: same hash but amount totals do not reconcile
- negative: same asset/time without shared hash

### Track 2: Cross-Chain Migration / Bridge-Like Same-Asset Move

Status: investigate second
Expected value: high
Likely destination: linking strategy only if hard proof exists, otherwise cue

#### Evidence

Current suspect:

- Ethereum outflow:
  - `2e2cb3aa5e` / tx `e96a8b7baa` / `RENDER 80.61` / `2024-07-30T22:36:47Z`
- Solana inflow:
  - `e1aea84485` / tx `b7c08af224` / `RENDER 80.61` / `2024-07-30T22:53:40Z`

Same amount, same symbol, different chains, about 17 minutes apart.

Existing upstream bridge semantics already exist on other chains:

- `9243c822aa` / tx `581a427bd6` carries diagnostic code `bridge_transfer`

#### Hypothesis

There may be two sub-cases here:

1. deterministic bridge/migration flows with explicit upstream evidence
2. migration-like flows with only amount/time evidence

Only the first sub-case is a plausible linking strategy.

#### Investigation Questions

1. Can a note-backed bridge case become a safe cross-chain link strategy?
2. Do we need bridge-specific evidence such as:
   - `bridge_transfer` note
   - known bridge contract/to-address
   - exact same-asset conservation
3. Should plain exact-amount, cross-chain moves without explicit bridge evidence remain cue-only?
4. Do token migrations need different handling from bridges?

#### Candidate Outcome

Preferred:

- link strategy for deterministic **note-backed bridge / migration transfers**

Fallback:

- cue `likely_cross_chain_migration`

Do not:

- create links from amount+time alone

#### Required Tests

- positive: existing explicit `bridge_transfer` transaction note case
- positive: one same-asset cross-chain migration case if and only if evidence is strong enough
- negative: same amount on different chains without bridge evidence
- negative: same symbol but different asset identity semantics

### Track 3: Same-Account Service-Swap Cluster

Status: existing cue needs refinement
Expected value: medium
Likely destination: cue only

#### Evidence

Original positive case:

- `cc617ae2ae` / `RENDER 100` out
- `f4a5cd8b50` / `SOL 0.00001` in
- `3d1c475752` / `USDT 165.169516` in
- all on Solana between `2026-03-13T00:02:01Z` and `2026-03-13T00:03:31Z`

Current likely false-positive / over-broad cue:

- `793a42977e` / `SOL 0.023281532` in / `2024-05-24T04:03:55Z`
- `6085410398` / `SOL 0.00203928` out / `2024-05-24T04:05:03Z`
- `83518ebf08` / `USDC 150` out / same transaction as above

The current cue in [gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts) is likely too permissive.

#### Hypothesis

This should probably never be a transfer-link strategy.

The likely correct endpoint is:

- tighten `likely_correlated_service_swap`
- keep it cue-only

#### Investigation Questions

1. Can transfer linking ever be semantically correct for cross-asset, multi-transaction service swaps?
2. Should tiny native legs be treated only as auxiliary evidence?
3. What constraints remove the May 24 false-positive without losing the March 13 positive?
4. Do we require at least one material non-native inflow and one material non-native outflow?

#### Candidate Outcome

Preferred:

- tighten the existing cue

Do not:

- create links
- move this into ingestion

#### Required Tests

- positive: March 13 Solana trio
- negative: May 24 Solana funding/setup cluster
- negative: one-sided same-account funding
- negative: same-asset-only nearby activity

### Track 4: Promo Memo Dust / Airdrop Spam Misses

Status: upstream detection gap
Expected value: high
Likely destination: ingestion scam detection, not linking

#### Evidence

Open gaps:

- `94d76d1e0a` / tx `5449664035` / Injective / `INJ 1e-18` in
- `510e8b973f` / tx `cb533f67fd` / Injective / `INJ 1e-18` in
- `3e10a6ce7f` / tx `5b5ff59cf9` / Akash / `AKT 1e-6` in

Raw normalized data for at least two of these contains explicit promo/airdrop memo text, but the stored transactions still have:

- `diagnostics: []`
- `excludedFromAccounting: false`

#### Hypothesis

These should be caught by upstream scam/airdrop detection and then disappear from `links gaps` under the existing policy.

This is not a cue-first problem and not a linking problem.

#### Investigation Questions

1. Which processors expose promo memo text in normalized data today?
2. Can scam detection consume those memos generically across Cosmos-family chains?
3. Should these become `SUSPICIOUS_AIRDROP` or `SCAM_TOKEN`?
4. Do we want `excludedFromAccounting` for these once detected?

#### Candidate Outcome

Preferred:

- improve scam/airdrop detection on memo-bearing Cosmos-family transactions

Fallback:

- none in gaps; if upstream cannot classify them safely, leave manual review

#### Required Tests

- positive: Injective promo memo example
- positive: Akash promo memo example
- negative: benign memo-bearing transfer

### Track 5: Protocol Overhead / Rent / Account Setup

Status: defer until linking-first work is done
Expected value: medium
Likely destination: movement model or processor normalization, not linking

#### Evidence

Current open rows:

- `6867898c4a` / tx `ec36390543` / `SOL 0.00203928` out
- `d54f0602f5` / tx `3a2664f861` / `SOL 0.00203928` out
- `d2601e4fab` / tx `920c244f01` / `SOL 0.00203928` out

These still look like ATA/rent/account-setup side effects rather than principal transfers.

#### Hypothesis

This is a movement-model problem, not a linking strategy.

#### Candidate Outcome

- future movement diagnostic or processor normalization
- possibly a future cue only if we can identify it safely

Do not:

- add a transfer link strategy

## Work Order

1. Track 1: shared-hash batched deposit
2. Track 4: promo memo spam detection
3. Track 2: cross-chain migration / bridge-like move
4. Track 3: tighten service-swap cue
5. Track 5: protocol overhead / rent

Rationale for this order:

- Track 1 is now narrower and more actionable because Track 0 removed the original ADA false-positive.
- Track 4 should move earlier because the semantics/diagnostics foundation is now in place, so an upstream detection fix has immediate effect in gaps with little additional architecture work.
- Track 2 comes next because diagnostics are now first-class and can support a safer bridge-first investigation boundary.
- Track 3 remains valuable, but it is still heuristic cue work and should not outrun harder-signal investigations.
- Track 5 remains last because it still depends on stronger evidence and possibly additional movement-role follow-up (`refund_rebate` / replay hardening) before we should widen the model again.

## Exit Criteria

This plan is complete when every tracked pattern lands in one of these buckets:

- shipped linking strategy
- shipped upstream classification
- shipped cue
- explicitly kept as manual review with documented reasoning

No pattern should remain in a half-state where we have a heuristic in code but no named owner, no regression examples, and no decision on whether it belongs to linking, ingestion, or the gaps lens.
