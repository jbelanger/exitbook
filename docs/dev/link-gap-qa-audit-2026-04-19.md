# Link Gap QA Audit

Date: 2026-04-19

## Scope

- Reproduced the current `links gaps` behavior from the repo root.
- Re-ran the live gap list against the active app dataset in `apps/cli/data`.
- Reviewed every current open gap with `transactions view <TX_REF> --source-data --json`.
- Cross-checked nearby transactions in `transactions.db` when the raw provider payload alone was not enough.
- Goal: explain why each current gap exists, estimate certainty, and decide whether the right fix is processing, linking, cueing, or no system action.

## Current State

- Repo-root `links gaps --json` is currently broken on the default `./data` dataset.
  - Error: `no such column: accounts.account_fingerprint`
  - Reason: `apps/cli/src/features/shared/data-dir.ts` defaults to `process.cwd()/data`, and the repo-root `data/transactions.db` is on an older schema than `apps/cli/data/transactions.db`.
  - Certainty: `99%`
  - Best action: make the default data-dir behavior less footgun-prone and emit a targeted error that explains which data directory is being used and why it is incompatible.
- Live app dataset audit used `EXITBOOK_DATA_DIR=apps/cli/data`.
- Current open gap count in the live app dataset: `9`
- Current hidden resolved gap count: `53`

## Bucket Summary

- `1` active processor/classification bug
- `4` look like cue / review-context opportunities
- `1` is a borderline cue candidate, but I would not auto-hide it yet
- `3` still look like real manual-review gaps
- `0` current rows look like new deterministic link-matching opportunities

## 1. CLI / UX Blocker

| Issue                    | Summary                                              | Reason                                                                                                                                                                                                                                                              | Certainty | Best Action                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo-root data-dir crash | `links gaps --json` fails before gap analysis starts | `getDataDir()` uses `process.cwd()/data`; from the repo root that hits stale `data/transactions.db`, while the live dataset is in `apps/cli/data/transactions.db`. The current failure leaks a raw SQLite column error instead of explaining the data-dir mismatch. | `99%`     | CLI UX fix in `apps/cli/src/features/shared/data-dir.ts` and startup/readiness handling. Either pick a project-aware default or fail with an explicit “wrong data dir / schema drift” message. |

## 2. Processing / Classification Bug

| Gap          | Tx           | Summary                                 | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Certainty | Best Action                                                                                                                                                                                                                      |
| ------------ | ------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `66714ed0b2` | `656a9f894b` | 2024-08-23, Kraken, `FET 0.00000488` in | Raw Kraken payload is `type=trade`, `subtype=tradespot`, but the processed transaction materialized as `transfer/deposit` and surfaced in `links gaps`. A same-second Kraken swap also exists (`46496517a9`), which confirms this row belongs to exchange trade semantics, not transfer-link review. The likely source is the broad fallback in `packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts` that treats one-sided inflow groups as transfer deposits even when the provider type is `trade`. | `99%`     | Processing fix: Kraken `trade` rows should never become transfer-gap candidates just because the correlated group is one-sided. Either classify them as trade residual/dust/rebate or keep them out of transfer review entirely. |

## 3. Cue / UX Opportunities

These do not look safe enough for new deterministic linking, but the current generic gap framing hides useful context.

| Gap          | Tx           | Summary                                 | Reason                                                                                                                                                                                                                                                                                                                                       | Certainty | Best Action                                                                                                                                                                                    |
| ------------ | ------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `54a0e9e6be` | `f36bc96196` | 2024-06-08, Kraken, `ADA 575.436238` in | Raw Kraken payload is a plain `type=deposit`, so this is not a processor bug. But the exact same amount is sold on Kraken `7m17s` later in trade `06a14042a6`. That makes this look much more like exchange funding for an immediate trade than a mysterious unmatched transfer.                                                             | `92%`     | Add a cue or detail hint for “exact amount traded shortly after receipt on the same exchange.” This is not a link, but it is very useful review context.                                       |
| `39a17bb96c` | `f796b68d7a` | 2024-12-10, Solana, `SOL 0.00001` in    | Raw Helius payload is a pure system-program transfer with no token changes. The wallet also receives five other micro-SOL deposits in the same 7-second window, immediately after a `SOL 1.25` withdrawal (`e8e03e862b`). This strongly smells like residual settlement dust / service fallout, but the current evidence is still heuristic. | `72%`     | Soft cue candidate only. A processor diagnostic for “tiny follow-on native receipts clustered around an owned outbound transfer” would let this surface as a hint without auto-suppressing it. |
| `c53468c384` | `42e9faa432` | 2024-12-17, Ethereum, `ETH 0.001` out   | Raw payload is just a native transfer, but the same external address `0xcf5804...` receives another small ETH send later that day from a second owned wallet (`010b09ebb0`). This repeated-recipient pattern looks like external service funding, not a hidden internal transfer target.                                                     | `78%`     | New cue candidate: `likely_external_service_funding`. Keep it informational only.                                                                                                              |
| `c0d386fa15` | `010b09ebb0` | 2024-12-17, Ethereum, `ETH 0.0041` out  | Same reasoning as above: second owned wallet, same day, same external recipient, same small native-only send shape.                                                                                                                                                                                                                          | `78%`     | Same as above: informational cue, not auto-linking.                                                                                                                                            |

## 4. Borderline Cue Candidate

| Gap          | Tx           | Summary                            | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                     | Certainty | Best Action                                                                                                                                               |
| ------------ | ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8dc03cba05` | `66cdd4c7a7` | 2024-12-27, NEAR, `NEAR 0.0001` in | This tiny NEAR receipt lands `35s` after a Coinbase withdrawal to the same owned NEAR address (`8f922d0bb2` -> on-chain receipt `7007da3013`). The tiny receipt comes from a different signer account and does not reconcile cleanly to the Coinbase amount, so it looks like follow-on settlement dust or a wallet-level artifact rather than a missing internal transfer. Still, the proof is weaker than the Solana micro-cluster case. | `65%`     | No suppression today. If we add a generic “tiny follow-on native receipt after a confirmed owned deposit” diagnostic later, this could become a soft cue. |

## 5. Likely Real Manual Gaps

These still look like gaps the product cannot safely solve from current evidence.

| Gap          | Tx           | Summary                                    | Reason                                                                                                                                                                                                                                                                  | Certainty | Best Action                                                                                                                                                                                 |
| ------------ | ------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e3b624180f` | `2db908537a` | 2024-05-19, Ethereum, `ETH 0.01416652` out | Raw Routescan payload is a plain native transfer with empty calldata to a unique external address `0x3ab071...`. No same-dataset counterpart, no structured bridge/migration diagnostics, no repeated-recipient pattern.                                                | `60%`     | No link or cue. Leave as manual review.                                                                                                                                                     |
| `b179f1f9e2` | `3da7307c45` | 2024-05-24, Arbitrum, `ETH 0.0954` out     | Raw Etherscan payload is a plain native transfer with empty calldata to a unique external address `0x082937...`. Same shape as above: no deterministic evidence beyond “user sent ETH somewhere.”                                                                       | `70%`     | No link or cue. Leave as manual review.                                                                                                                                                     |
| `4f80ee86bc` | `c987a0937c` | 2024-07-11, Coinbase, `NEAR 43.770085` out | Raw Coinbase payload already tells us this is a `send` on network `near` to address `7a400d...`, but there is no matching imported on-chain receipt anywhere in this dataset. This looks like a genuine user-known external destination, not a same-owner linking miss. | `95%`     | No link work. UX improvement only: surface provider network and destination address in `links gaps view` so this is easier to review without dropping to `transactions view --source-data`. |

## Recommended Work Order

1. Fix the repo-root data-dir footgun.
   - The current failure blocks the QA workflow before any gap reasoning starts.
   - The error should explain the active data dir and why the schema is incompatible.
2. Fix the Kraken trade leak.
   - `66714ed0b2` is the clearest remaining processor bug.
   - The likely starting point is `packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts`.
3. Add exchange-side cue/context support in `links gaps view`.
   - Short raw-provider facts would have shortened this audit materially:
     - Kraken `type` / `subtype` / `refid`
     - Coinbase `type`, `network.network_name`, `to.address`
4. Add one or two soft cues, not new auto-links.
   - `likely_exchange_funding_for_trade`
   - `likely_external_service_funding`
5. Be conservative on tiny native follow-on receipts.
   - `39a17bb96c` and `8dc03cba05` look suspiciously non-user-driven, but the evidence is still heuristic.
   - If these get a cue, it should be informational only unless the processor can emit a much stronger diagnostic.

## Decisions & Smells

- I treated the repo-root `data/` failure as a product bug, not an environment mistake. From a user perspective, `pnpm run dev links gaps` from the repo root should not blow up with a raw SQLite column error.
- I treated `66714ed0b2` as a processor bug, not a cue problem. The raw provider row is explicitly `trade`, so it should never reach transfer-gap review.
- I treated the Kraken ADA deposit as a cue problem, not a linking problem. The system still cannot prove the source wallet, but it can explain that the exact amount was immediately consumed by a same-exchange trade.
- I kept the tiny SOL / NEAR follow-on receipts out of “fix immediately” territory. They smell like residual settlement dust, but auto-suppressing tiny native receipts remains risky without stronger processor diagnostics.
- Repeated-recipient service-funding patterns are still under-modeled. The current gap surface knows enough to show the repetition, but not enough to phrase it helpfully.

## Naming Issues

Suggested cue names that would make the current surface clearer:

- `likely_exchange_funding_for_trade`
  - Better than showing a generic deposit gap when the exact amount is traded shortly after receipt on the same exchange.
- `likely_external_service_funding`
  - Fits small native sends from owned wallets into the same external recipient without pretending they are transfer-link candidates.
- `likely_follow_on_settlement_dust`
  - Better than a silent generic gap for tiny native receipts that arrive immediately after a larger owned transfer/deposit flow.
