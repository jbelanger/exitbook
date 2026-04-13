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
   - explicit upstream diagnostic such as `bridge_transfer`
   - known bridge/deposit address semantics
6. Every new strategy or cue needs both positive and negative regressions from real cases in this backlog.

## Decision Ladder

Apply this in order for every pattern:

1. **Safe linking**
   - Can we express it as a real `transaction_link` strategy without weakening transfer semantics?
2. **Existing classification**
   - Is there already a stored diagnostic or movement role we should consume in `links gaps`?
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

- The original ADA case is no longer evidence for a broad new linking strategy.
- Track 0 made the residual value explicit as a typed machine diagnostic instead of a note-era guess.
- That unlocked a narrow, auditable strategy enhancement: allow a same-hash partial target only when the target excess is explained exactly by typed wallet-scoped residual diagnostics.
- This also exposed a second generic finding: same-hash linking and same-hash cost-basis scoping must distinguish `deduped_shared_fee` from `per_source_allocated_fee`. A blanket max-fee-dedup rule is wrong outside duplicated-fee projections.

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

The Cardano staking-withdrawal case is no longer just a Track 1 linking investigation, and it is no longer merely a review-surface problem.

New sequencing:

1. provider / processor correctness
2. movement semantics foundation
3. same-hash partial-target linking with exact diagnostic residuals
4. rerun the corrected ADA case
5. only then decide whether any broader Track 1 work is still needed

Track 1 should still not grow a Cardano-specific linking exception. The original Cardano ambiguity is now resolved by:

- upstream Cardano withdrawal semantics
- typed residual diagnostics
- a generic same-hash explained-partial-target linking rule

## Pattern Tracks

### Track 1: Shared-Hash Batched Exchange Deposit

Status: narrow strategy enhancement shipped; no broader generic strategy justified now
Expected value: medium
Likely destination: existing same-hash linking remains the main strategy surface; future work only if a second unresolved case appears after the explained-partial-target rule

#### Evidence

Resolved live case that drove this track:

- blockchain outflows:
  - tx `4343` / `ADA 1021.402541`
  - tx `4348` / `ADA 975.034581`
  - tx `4350` / `ADA 672.948242`
- exchange inflow:
  - tx `4200` / `ADA 2679.718442`
- shared blockchain hash for all four:
  - `0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf`

Current live numbers after Track 0 and the explained-partial-target strategy:

- blockchain source gross total: `2669.385364 ADA`
- blockchain source net total: `2669.193991 ADA`
- exchange deposit inflow: `2679.718442 ADA`
- target excess over linked transfer quantity: `10.524451 ADA`
- wallet-scoped staking withdrawal on the same on-chain tx: `10.524451 ADA`
- total already-allocated on-chain fee across the three projected source rows: `0.191373 ADA`

Live links created on `2026-04-12` after reprocess + `links run`:

- link `909`: `5291 -> 5148` / `1021.329314829243639698026006 ADA`
- link `910`: `5296 -> 5148` / `974.9646790310350899938477373 ADA`
- link `911`: `5298 -> 5148` / `672.8999971397212703081262567 ADA`
- link metadata:
  - `sameHashExplainedTargetResidualAmount = 10.524451`
  - `sameHashExplainedTargetResidualRole = staking_reward`
  - `sameHashExternalFeeAccounting = per_source_allocated_fee`

This means the remaining target excess is not being linked as transfer quantity. It is carried explicitly as explained residual context on the partial target links, and downstream consumers can classify it without pretending it was transfer principal.

Live re-check on `2026-04-12`:

- current dataset has `12` same-hash cross-platform principal clusters
- `11 / 12` are already resolved by existing linking behavior
- the former Cardano outlier is now resolved by the explained-partial-target path

Previous Bitcoin hashes are no longer valid Track 1 evidence:

- `2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96`
- `45ec1d9a069424a0c969507f82300f9ef4102ebb0f1921d89b2d50390862c131`
- `12d5b8376d09edf240f39ce7118cb7ed3e1aa6bb13d8cb1b94611b2df1675ff0`
- `0c3ab1cab70b585ee3d64cdfed8fd8b031b303a733e9b8ec441f9ae7d26e3940`
- `c700f28764ab1e7c3c614ee4e2e9535791fcc27b38a68605fc99fa8a0db37f85`

Those Bitcoin cases are already handled by the existing same-hash machinery:

- ordinary `blockchain_internal` links for tracked change outputs
- existing `SameHashExternalOutflowStrategy` for exact-conservation multi-source external sends

#### Hypothesis

The generic N:1 exact-conservation problem was already solved.

What remained was narrower:

- the chain-side provider materializes one transfer row per funded source/account slice
- the exchange import materializes one deposit row for the aggregate on-chain transaction
- the wallet also contributed extra same-asset value on the same hash
- that extra value can be handled safely only when it is surfaced as a typed diagnostic and reconciles exactly

So the real missing capability was not "we need a generic N:1 linker."
It was "the same-hash strategy and same-hash scoping need a safe way to recognize exact, non-transfer target excess and a fee model that does not assume duplicated shared fees."

#### Current Finding

The original Cardano case is no longer unresolved.

What happened:

- provider normalization now preserves Blockfrost withdrawals
- Cardano processing now emits `movementRole='staking_reward'` for attributable staking withdrawals
- Cardano processing also emits a typed `unattributed_staking_reward_component` diagnostic when wallet-scoped reward value cannot be assigned to one projected address row
- transfer-oriented consumers now ignore non-principal movements
- `SameHashExternalOutflowStrategy` now allows a partial target only when target excess equals the summed typed residual exactly
- same-hash cost-basis scoping now distinguishes:
  - `deduped_shared_fee`
  - `per_source_allocated_fee`
- the projected blockchain outflows now reconcile operationally with the exchange inflow once staking withdrawal + fee handling are accounted for

Result:

- the old semantic ambiguity no longer blocks linking
- the Cardano case is now linked safely without a Cardano-specific accounting rule
- `links gaps` no longer shows an open gap for the exchange-side ADA residual because it is now fully explained and not user-actionable transfer review
- Canada tax projection now keeps the residual as an acquisition event but marks it with `incomeCategory='staking_reward'`, so it is no longer a generic unexplained acquisition
- this is still not evidence for a broad new linking strategy; it is evidence for a narrower generic rule:
  - shared hash
  - exact target excess
  - exact typed residual explanation
  - fee-accounting-aware same-hash capacity planning

So this track should now:

- continue to reject any Cardano-specific linking exception
- stop using the old Bitcoin hashes as open evidence
- keep the explained-partial-target rule narrow and audited
- wait for a second unresolved case before broadening the track again

#### Investigation Questions

1. Do we have any second unresolved live case after the explained-partial-target rule, or was Cardano the only one?
2. Are there any other typed residual explanations besides wallet-scoped staking reward that meet the same exactness bar?
3. Should the exact residual explanation be modeled only in metadata, or should we add a first-class helper/type guard for it in link review surfaces?
4. Should ingestion ever collapse these rows upstream, or does that still conflict with account-scoped provenance?
5. If a second unresolved case appears later, is the missing signal:
   - typed residual diagnostics
   - fee-accounting mode
   - or something else entirely?

#### Candidate Outcome

Current Cardano case:

- linked safely
- reconciled for cost-basis scoping
- still additive only: the residual is explained, not silently converted into transfer quantity

Preferred long-term order:

1. keep the current generic same-hash external linking strategy plus the explained-partial-target extension
2. wait for either:
   - a second unresolved live same-hash aggregated-deposit case, or
   - a new typed residual explanation that meets the same exactness bar
3. if neither appears soon, do not broaden the rule further

#### Required Tests

- positive: existing `SameHashExternalOutflowStrategy` exact-conservation case remains covered
- positive: the original July 25, 2024 Cardano case links through explained partial target residuals
- positive: same-hash cost-basis scoping preserves per-source allocated fees instead of deduping them again
- negative: same hash but mismatched asset
- negative: same hash but target excess is not explained exactly by typed residual diagnostics
- negative: same asset/time without shared hash

### Track 2: Cross-Chain Migration / Bridge-Like Same-Asset Move

Status: cue implemented, linking deferred
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

#### Findings

- Live `bridge_transfer` diagnostics are currently one-sided:
  - `9243c822aa` / tx `581a427bd6` on Injective has bridge context but no imported Ethereum counterpart
  - `7223ab2ab2` on Akash has bridge context but no imported Osmosis counterpart
- This is enough for deterministic gap context, but not enough for a safe link strategy.
- The RENDER Ethereum -> Solana pair remains a good cue candidate:
  - `2e2cb3aa5e` / tx `e96a8b7baa` / Ethereum / `RENDER 80.61` out / `2024-07-30T22:36:47Z`
  - `e1aea84485` / tx `b7c08af224` / Solana / `RENDER 80.61` in / `2024-07-30T22:53:40Z`
  - same profile, exact amount, different chains, about 17 minutes apart
- Track 2 now ships `likely_cross_chain_migration` as a gaps cue only.
- No Track 2 linking strategy is justified until we have at least one deterministic two-sided bridge case in imported data.

#### Hypothesis

There may be two sub-cases here:

1. deterministic bridge/migration flows with explicit upstream evidence
2. migration-like flows with only amount/time evidence

Only the first sub-case is a plausible linking strategy.

#### Investigation Questions

1. Can a diagnostic-backed bridge case become a safe cross-chain link strategy?
2. Do we need bridge-specific evidence such as:
   - `bridge_transfer` diagnostic
   - known bridge contract/to-address
   - exact same-asset conservation
3. Should plain exact-amount, cross-chain moves without explicit bridge evidence remain cue-only?
4. Do token migrations need different handling from bridges?

#### Candidate Outcome

Preferred if stronger evidence appears later:

- link strategy for deterministic diagnostic-backed bridge / migration transfers

Fallback:

- cue `likely_cross_chain_migration`

Do not:

- create links from amount+time alone

#### Required Tests

- positive: exact-amount same-profile cross-chain pair cues as `likely_cross_chain_migration`
- negative: different-profile same-amount pair does not cue
- negative: ambiguous many-to-one same-amount cluster does not cue
- negative: same symbol but different amounts does not cue

### Track 3: Same-Account Service-Swap Cluster

Status: cue tightened and live-verified
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

#### Findings

- The original cue was too permissive: any same-account, same-chain window with opposite directions and two assets could qualify.
- The real distinguishing boundary is not a generic amount threshold. It is asset role inside the cluster:
  - the March 13 positive has a non-native outflow (`RENDER`) and a non-native inflow (`USDT`)
  - the May 24 false-positive has only native inflow (`SOL`) plus non-native outflow (`USDC`)
- Native legs work better as auxiliary evidence than as the primary cue trigger.
- Live re-check after the refinement:
  - March 13 refs `cc617ae2ae`, `f4a5cd8b50`, and `3d1c475752` still carry `likely_correlated_service_swap`
  - May 24 refs `793a42977e`, `6085410398`, and `83518ebf08` no longer carry the cue

The refined cue in [gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts) now requires:

- one non-native inflow
- one non-native outflow
- at least two distinct non-native asset ids

Native legs may still inherit the cue when the surrounding non-native pattern qualifies.

#### Hypothesis

This should probably never be a transfer-link strategy.

The likely correct endpoint is:

- tighten `likely_correlated_service_swap`
- keep it cue-only

#### Investigation Questions

1. Can transfer linking ever be semantically correct for cross-asset, multi-transaction service swaps?
2. Should tiny native legs be treated only as auxiliary evidence?
3. What constraints remove the May 24 false-positive without losing the March 13 positive?
4. Do we require at least one non-native inflow and one non-native outflow?

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

Status: upstream Cosmos-family detection implemented and live-verified
Expected value: high
Likely destination: ingestion scam detection, not linking

#### Evidence

Open gaps:

- `94d76d1e0a` / tx `5449664035` / Injective / `INJ 1e-18` in
- `510e8b973f` / tx `cb533f67fd` / Injective / `INJ 1e-18` in
- `3e10a6ce7f` / tx `5b5ff59cf9` / Akash / `AKT 1e-6` in

Raw normalized data contains explicit promo/airdrop memo text, for example:

- Injective:
  - `✅ Account is listed in Mantra AIRDROP ... https://mantra-dex.app`
  - `✅ This wallet is listed in the Osmosis Retrodrop snapshot ... https://osmosis-zone.ink`
- Akash:
  - `🟢 This address was included in the Astrovault AIRDROP snapshot ... https://astro-vault.io`

Before the fix, the stored transactions still had:

- `diagnostics: []`
- `excludedFromAccounting: false`

Live re-check on `2026-04-12` after `reprocess`:

- transaction refs `5449664035`, `cb533f67fd`, and `5b5ff59cf9` now each carry `SUSPICIOUS_AIRDROP`
- none of those refs appear in `links gaps --json`
- this confirms the promo-memo path is now effective in live data, not just in regression coverage

#### Hypothesis

These should be caught by upstream scam/airdrop detection and then disappear from `links gaps` under the existing policy.

This is not a cue-first problem and not a linking problem.

#### Findings

- `injective-explorer`, `akash-console`, and `cosmos-rest` already preserve `memo` in normalized Cosmos-family transactions.
- The old miss was architectural, not provider-side:
  - current scam detection only batch-checks token movements that carry a denom/contract key
  - native `INJ` / `AKT` promo dust never entered that path
- The fix is transaction-level and Cosmos-generic:
  - detect promo memo spam on inbound-only receives
  - emit `SUSPICIOUS_AIRDROP`
  - mark it as transaction-scoped, not asset-scoped
- We intentionally did **not** auto-set `excludedFromAccounting` in this slice.
  - rationale: the diagnostic is strong enough to suppress gaps
  - but auto-excluding balance-affecting native dust should remain a separate product/accounting decision
- Asset review needed an explicit guard:
  - transaction-scoped suspicious-airdrop diagnostics must not smear onto native assets like `INJ` or `AKT`

#### Investigation Questions

1. Which processors expose promo memo text in normalized data today?
2. Can scam detection consume those memos generically across Cosmos-family chains?
3. Should these become `SUSPICIOUS_AIRDROP` or `SCAM_TOKEN`?
4. Do we want `excludedFromAccounting` for these once detected?

#### Candidate Outcome

Preferred:

- improve scam/airdrop detection on memo-bearing Cosmos-family transactions
- keep it transaction-scoped and diagnostic-only unless we later decide to auto-exclude this class

Current decision:

- done for the known Injective and Akash promo-memo cases
- no transaction-level spam flag should be reintroduced here; diagnostics are now the canonical machine signal

Fallback:

- none in gaps; if upstream cannot classify them safely, leave manual review

#### Required Tests

- positive: Injective promo memo example
- positive: Akash promo memo example
- negative: benign memo-bearing transfer

### Track 5: Protocol Overhead / Rent / Account Setup

Status: partially implemented for deterministic Solana ATA-create rent
Expected value: medium
Likely destination: movement model or processor normalization, not linking

#### Evidence

Resolved rows after upstream movement-role work:

- `6867898c4a` / tx `ec36390543` / `SOL 0.00203928` out
- `d54f0602f5` / tx `3a2664f861` / `SOL 0.00203928` out
- `d2601e4fab` / tx `920c244f01` / `SOL 0.00203928` out

These are now emitted upstream as `movementRole='protocol_overhead'` and no longer surface as open gap refs after a clean reprocess.

Additional live finding:

- the May 24, 2024 funding/setup/send cluster (`793a42977e`, former ATA-rent leg `6085410398`, former token-send leg `83518ebf08`) no longer behaves like a mixed swap-like gap cluster
- the funding deposit still stays visible as an open principal gap
- the ATA rent leg is removed from transfer matching through movement semantics instead of a gaps heuristic

#### Hypothesis

This is a movement-model problem, not a linking strategy.

#### Candidate Outcome

- use upstream `movementRole='protocol_overhead'` where the setup/rent evidence is deterministic
- otherwise fall back to manual review or, at most, a cue

Do not:

- add a transfer link strategy

Current boundary:

- shipped: deterministic Solana ATA-create rent
- still deferred: broader non-ATA setup/account-creation patterns and any rent-reclaim / rebate-like native inflows

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
