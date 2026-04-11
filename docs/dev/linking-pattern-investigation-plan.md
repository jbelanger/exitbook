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

## Pattern Tracks

### Track 1: Shared-Hash Batched Exchange Deposit

Status: investigate first
Expected value: high
Likely destination: linking strategy if safe

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

#### Investigation Questions

1. Are all rows on the same asset id, not just the same symbol?
2. Is the exchange deposit destination the same on-chain address used by the blockchain rows?
3. Is the shared blockchain hash stable across providers and chains?
4. Is the amount conservation exact, or do we need fee-aware tolerance?
5. Is this really linking, or should ingestion collapse these rows upstream?

#### Candidate Outcome

Preferred:

- new linking strategy in `accounting/linking` for **shared-hash aggregated deposits**

Fallbacks:

- upstream normalization fix if the chain-side transaction should never split this way
- gap cue `likely_batched_exchange_deposit` only if linking is not safe

#### Required Tests

- positive: Cardano case above
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

- `9243c822aa` / tx `581a427bd6` carries note type `bridge_transfer`

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

- `notes: []`
- `isSpam: false`

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
2. Track 2: cross-chain migration / bridge-like move
3. Track 3: tighten service-swap cue
4. Track 4: promo memo spam detection
5. Track 5: protocol overhead / rent

## Exit Criteria

This plan is complete when every tracked pattern lands in one of these buckets:

- shipped linking strategy
- shipped upstream classification
- shipped cue
- explicitly kept as manual review with documented reasoning

No pattern should remain in a half-state where we have a heuristic in code but no named owner, no regression examples, and no decision on whether it belongs to linking, ingestion, or the gaps lens.
