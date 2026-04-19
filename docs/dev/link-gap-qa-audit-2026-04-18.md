# Link Gap QA Audit

Date: 2026-04-18

Scope:

- Live pass over `pnpm -s run dev links gaps --json` for the default profile
- Transaction-by-transaction review with `pnpm -s run dev transactions view <TX_REF> --source-data --json`
- Goal: explain why each current gap exists, estimate certainty, and decide whether the right fix is processing, linking, cueing, or no system action

Current open gap count: `52`

Bucket summary:

- `7` are processing/classification bugs
- `12` have an exact or near-exact counterpart in another profile
- `4` look safe enough for deterministic bridge/migration linking once we emit the right diagnostics
- `8` look like cue/UX work, not link work
- `4` look like spam/airdrop suppression misses
- `17` still look like real manual-review gaps where the system does not have enough proof

## Raw Source Data That Changed The Diagnosis

- Coinbase raw `type` values are highly actionable:
  - `fiat_withdrawal`
  - `subscription`
  - `retail_simple_dust`
- Kraken raw `subtype=spotfromfutures` is an internal ledger move, not an external transfer.
- Ethereum -> Injective bridge source data is explicit:
  - Ethereum outflow `61e2a3c89b` calls `sendToInjective(...)`
  - Injective inflow `581a427bd6` is `MsgDepositClaim`
- Ethereum -> Solana RENDER migration source data is stronger than the current cue alone:
  - Ethereum outflow `e96a8b7baa` calls `transferTokensWithPayload(...)` to `0x3ee18b2214aff97000d974cf647e7c347e8fa585`
  - Solana inflow `b7c08af224` logs `Instruction: ReceiveRenderV2`
- Three small Solana `RENDER` inflows are explicit reward claims:
  - `Instruction: DistributeUpgradeRewardsV1`
  - log text includes `claiming ... RNDR upgrade rewards`
- Arbitrum source data currently includes duplicate zero-amount alias token rows for some stablecoin transfers. This did not create the open gaps directly, but it makes debugging noisier.

## 1. Processing / Classification Bugs

These should stop surfacing as transfer gaps after processor work.

| Gap          | Tx           | Summary                                     | Reason                                                                                                                                | Certainty | Best Action                                                                               |
| ------------ | ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `522131f6b1` | `34dcac0db7` | 2024-08-15, Kraken, `RNDR 64.98757287` out  | Raw Kraken payload is `type=transfer`, `subtype=spotfromfutures`; this is an internal exchange ledger move, not an external transfer. | `99%`     | Processing fix: classify as internal exchange transfer and suppress from gaps.            |
| `f970829881` | `fb92e95464` | 2024-05-21, Coinbase, `CAD 500` out         | Raw Coinbase payload is `type=fiat_withdrawal`; this is bank cash movement, not transfer-link work.                                   | `99%`     | Processing fix: classify as fiat withdrawal / cash movement and keep out of `links gaps`. |
| `7a775a699f` | `437f8cc344` | 2024-05-29, Coinbase, `CAD 14.99` out       | Raw Coinbase payload is `type=subscription`; this is a subscription charge, not a transfer.                                           | `99%`     | Processing fix: classify as expense / subscription and suppress from gaps.                |
| `58f6ec82e0` | `1b1bea64d1` | 2024-12-22, Coinbase, `RLC 0.005213665` out | Raw Coinbase payload is `type=retail_simple_dust`; this is dust conversion behavior, not a transfer.                                  | `99%`     | Processing fix: map to trade/dust conversion, not transfer.                               |
| `f8b31828f1` | `bb11d6c818` | 2024-08-26, Solana, `RENDER 0.08480349` in  | Raw Helius logs say `DistributeUpgradeRewardsV1` and `claiming ... RNDR upgrade rewards`; this is reward income, not transfer.        | `99%`     | Processing fix: classify as `reward` and/or reward movement role.                         |
| `ad9afadace` | `10b6b9a25c` | 2024-09-30, Solana, `RENDER 0.07708537` in  | Same explicit reward-distribution pattern as above.                                                                                   | `99%`     | Processing fix: classify as `reward` and/or reward movement role.                         |
| `95d2fc96a3` | `88ad10c953` | 2024-10-31, Solana, `RENDER 0.07375641` in  | Same explicit reward-distribution pattern as above.                                                                                   | `99%`     | Processing fix: classify as `reward` and/or reward movement role.                         |

## 2. Exact Other-Profile Counterparts

These do not look like same-profile matching failures. They look like profile-boundary UX misses.

| Gap          | Tx           | Summary                                              | Reason                                                                                             | Certainty | Best Action                                                              |
| ------------ | ------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `8b5c6d2266` | `886205bbd1` | 2024-05-19, Kraken, `USDC 99` out                    | Exact amount has cross-profile Solana candidate within 15s.                                        | `95%`     | UX cue: surface `exact_other_profile_counterpart`, not generic gap copy. |
| `c298c7c8ef` | `0b2d959364` | 2024-05-19, Kraken, `USDC 99` out                    | Exact amount has cross-profile Solana candidate within 21s.                                        | `95%`     | UX cue: surface `exact_other_profile_counterpart`.                       |
| `4338fb1149` | `ee34813d68` | 2024-05-19, Solana, `SOL 0.058799318` out            | Exact same-second same-amount cross-profile counterpart.                                           | `99%`     | UX cue: cross-profile counterpart.                                       |
| `9b40262dcc` | `fae1453de3` | 2024-05-19, Solana, `SOL 0.058983131` out            | Exact same-second same-amount cross-profile counterpart.                                           | `99%`     | UX cue: cross-profile counterpart.                                       |
| `793a42977e` | `3f129c222d` | 2024-05-24, Solana, `SOL 0.023281532` in             | Exact same-second same-amount cross-profile counterpart.                                           | `99%`     | UX cue: cross-profile counterpart.                                       |
| `07705cbba6` | `1eba3dd30a` | 2024-05-24, Ethereum, `ETH 0.038236795629335232` out | Exact same-second same-amount cross-profile counterpart.                                           | `99%`     | UX cue: cross-profile counterpart.                                       |
| `8b6dac6fde` | `337882d7de` | 2024-05-24, Solana, `SOL 0.021222979` out            | Exact same-second same-amount cross-profile counterpart.                                           | `99%`     | UX cue: cross-profile counterpart.                                       |
| `7919fee300` | `22183130e4` | 2024-06-08, Ethereum, `LINK 3.16055625790139` out    | Exact same-second same-amount cross-profile counterpart.                                           | `99%`     | UX cue: cross-profile counterpart.                                       |
| `b1f7f73d49` | `07a10ce60f` | 2024-06-29, Coinbase, `SOL 1.020049737` out          | Cross-profile counterpart exists 7s later; Coinbase source data already gives destination address. | `97%`     | UX cue: cross-profile counterpart.                                       |
| `4bb8382377` | `92f46ecd12` | 2024-06-29, Coinbase, `LINK 15.36467484` out         | Cross-profile counterpart exists 99s later.                                                        | `96%`     | UX cue: cross-profile counterpart.                                       |
| `cc14af778b` | `d16ffd5d51` | 2024-07-21, Coinbase, `UNI 17.42` out                | Cross-profile counterpart exists 40s later.                                                        | `97%`     | UX cue: cross-profile counterpart.                                       |
| `0ad42c9fe6` | `593bb4cb50` | 2024-07-22, Coinbase, `INJ 6.03961192` out           | Cross-profile counterpart exists 82s later.                                                        | `97%`     | UX cue: cross-profile counterpart.                                       |

## 3. Deterministic Linking Opportunities

These are stronger than generic cues. Raw provider data already exposes structured bridge/migration evidence.

| Gap          | Tx           | Summary                                  | Reason                                                                                                          | Certainty | Best Action                                                                                                                 |
| ------------ | ------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `36d2c977e6` | `61e2a3c89b` | 2024-12-27, Ethereum, `INJ 1` out        | Raw Ethereum call is `sendToInjective(...)`; this is bridge intent on the source side.                          | `99%`     | Processing + linking: emit source-side `bridge_transfer` diagnostic and allow deterministic bridge linking.                 |
| `9243c822aa` | `581a427bd6` | 2026-02-12, Injective, `INJ 1` in        | Raw Injective source is `MsgDepositClaim`; this is the bridge receipt side.                                     | `99%`     | Processing + linking: same bridge flow as above.                                                                            |
| `2e2cb3aa5e` | `e96a8b7baa` | 2024-07-30, Ethereum, `RENDER 80.61` out | Raw Ethereum call is `transferTokensWithPayload(...)` to the Wormhole bridge contract.                          | `95%`     | Processing first: emit migration/bridge diagnostic; then consider deterministic linking if paired Solana receipt is unique. |
| `e1aea84485` | `b7c08af224` | 2024-07-30, Solana, `RENDER 80.61` in    | Raw Solana logs include `ReceiveRenderV2`; this is a structured migration receipt, not only an amount/time cue. | `95%`     | Processing first: emit migration/bridge diagnostic; then consider deterministic linking.                                    |

## 4. Cue Candidates / Better Context

These do not look safe enough for auto-linking, but the current generic gap copy leaves useful context on the floor.

| Gap          | Tx           | Summary                                    | Reason                                                                                                                                                                   | Certainty | Best Action                                                                        |
| ------------ | ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `12c86a2e41` | `88f8edba2e` | 2024-12-10, Ethereum, `USDT 344.581546` in | Earlier review treated this as pass-through, but the heuristic is too weak without stronger service evidence; ordinary receive-then-withdraw behavior also matches.      | `75%`     | No standalone cue; only cue if stronger service-swap evidence exists.              |
| `3dcd8a6f50` | `676d5ac011` | 2024-12-10, Ethereum, `USDT 344.5815` out  | Later withdrawal is not strong evidence that the earlier receipt was pass-through; this can be a normal user withdrawal.                                                 | `80%`     | No cue. Leave as a normal gap unless stronger evidence appears.                    |
| `44e9824edf` | `50a55902e1` | 2024-12-10, Ethereum, `ETH 0.1` out        | Same wallet sends `ETH 0.1` to the exact same recipient `0xf43f...` that later receives the forwarded `USDT`; this looks like service gas-funding tied to the same flow. | `85%`     | New cue candidate: extend receive-then-forward context to linked gas-funding legs. |
| `cc617ae2ae` | `6419fdff77` | 2026-03-13, Solana, `RENDER 100` out       | Existing swap/service cluster cue still looks correct.                                                                                                                   | `90%`     | Keep cue: `likely_correlated_service_swap`.                                        |
| `f4a5cd8b50` | `d63163a5e2` | 2026-03-13, Solana, `SOL 0.00001` in       | Tiny native leg that belongs to the same service-swap cluster.                                                                                                           | `88%`     | Keep cue inheritance from the service-swap cluster.                                |
| `3d1c475752` | `777e6a6949` | 2026-03-13, Solana, `USDT 165.169516` in   | Counterpart non-native inflow in the same service-swap cluster.                                                                                                          | `90%`     | Keep cue: `likely_correlated_service_swap`.                                        |
| `c53468c384` | `42e9faa432` | 2024-12-17, Ethereum, `ETH 0.001` out      | Two owned wallets send small ETH amounts to the same external address `0xcf580...` on the same day; this looks like service/bridge gas funding.                          | `78%`     | New cue candidate: `likely_external_service_funding`.                              |
| `c0d386fa15` | `010b09ebb0` | 2024-12-17, Ethereum, `ETH 0.0041` out     | Same recipient pattern as above from a second owned wallet.                                                                                                              | `78%`     | New cue candidate: `likely_external_service_funding`.                              |

## 5. Spam / Airdrop Suppression Misses

These look like unsolicited EVM token deposits and should probably disappear upstream instead of staying in transfer review.

| Gap          | Tx           | Summary                                     | Reason                                                                                                     | Certainty | Best Action                                                |
| ------------ | ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| `7c99932835` | `62b1ea7e93` | 2025-10-28, Ethereum, `UNDG 0.000291936` in | Unsolicited token transfer from an unknown address into an owned wallet, no local counterpart, tiny value. | `97%`     | Scam/airdrop detection for unsolicited EVM token deposits. |
| `eaed17a590` | `75f0033590` | 2025-10-29, Ethereum, `SP 1` in             | Unsolicited token transfer; token contract equals sender address, which is a strong spam smell.            | `99%`     | Scam/airdrop detection for unsolicited EVM token deposits. |
| `64faf062a7` | `f72bb1630e` | 2025-11-22, Ethereum, `NOODLE 174.31523` in | Unsolicited token transfer from unknown sender, no pairing evidence.                                       | `97%`     | Scam/airdrop detection for unsolicited EVM token deposits. |
| `39fa03d6d2` | `6e0c0c49a6` | 2026-03-29, Ethereum, `FAM 0.000000003` in  | Extreme tiny unsolicited token deposit; classic dust shape.                                                | `99%`     | Scam/airdrop detection for unsolicited EVM token deposits. |

## 6. Likely Real Manual Gaps

These still look like gaps the product cannot safely solve from current evidence. The best improvement here is better context in the review surface, not auto-linking.

| Gap          | Tx           | Summary                                     | Reason                                                                                                                                                      | Certainty | Best Action                                                                                        |
| ------------ | ------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `e3b624180f` | `2db908537a` | 2024-05-19, Ethereum, `ETH 0.01416652` out  | Plain outbound ETH transfer to an untracked external address; raw source data only says `type=transfer`.                                                    | `60%`     | No auto-link. Show more external-address context in the gap UI.                                    |
| `7b2c4cdced` | `0d4605ab97` | 2024-05-20, Arbitrum, `ETH 0.00221` in      | Plain inbound ETH from unknown source; likely manual top-up or bridge receipt from an untracked source.                                                     | `55%`     | No auto-link. Show counterparty address and nearby same-day activity.                              |
| `24d9c575eb` | `7c97b89a0b` | 2024-05-21, Arbitrum, `USDC 665.1598` out   | Real stablecoin transfer to an untracked address. Source data also shows a duplicate zero-amount alias event, but the underlying send still looks real.     | `75%`     | No auto-link. Improve address/network context.                                                     |
| `b179f1f9e2` | `3da7307c45` | 2024-05-24, Arbitrum, `ETH 0.0954` out      | Plain outbound ETH to an untracked external address.                                                                                                        | `70%`     | No auto-link. Better destination-address context only.                                             |
| `0c21dabd0a` | `5cb06b70ed` | 2024-05-30, Arbitrum, `USDC 1` out          | Small stablecoin send to an untracked address; likely service test/top-up, but not provable.                                                                | `70%`     | No auto-link.                                                                                      |
| `d9746f9110` | `baa6a04ab0` | 2024-05-30, Arbitrum, `USDC 20` out         | Same shape as above: stablecoin send to an untracked address with no deterministic counterpart.                                                             | `70%`     | No auto-link.                                                                                      |
| `b9120666e4` | `3c0e0a5234` | 2024-05-30, Arbitrum, `USDT 18` out         | Stablecoin send to repeated recipient `0x3b2c...`; probably a service deposit, but still not enough to link.                                                | `75%`     | No auto-link. Better repeated-recipient context could help.                                        |
| `ca9771c1f5` | `079b26908d` | 2024-05-30, Arbitrum, `USDT 200.061708` out | Same repeated-recipient pattern as above.                                                                                                                   | `80%`     | No auto-link. Better repeated-recipient context could help.                                        |
| `4f80ee86bc` | `c987a0937c` | 2024-07-11, Coinbase, `NEAR 43.77` out      | Coinbase withdrawal to a NEAR address that is not imported anywhere in this data set.                                                                       | `95%`     | Probably manual/user-known external destination. Surface destination address/network more clearly. |
| `e472cb7962` | `3cb5ab1b24` | 2024-12-10, KuCoin, `RAY 68.9027` in        | KuCoin deposit from a Solana address not imported anywhere in this data set.                                                                                | `90%`     | Probably manual/user-known external source. Surface deposit network/address more clearly.          |
| `8dc03cba05` | `66cdd4c7a7` | 2024-12-27, NEAR, `NEAR 0.0001` in          | Tiny inbound NEAR with no usable sender context in normalized data. Could be dust, refund, or benign micro-transfer.                                        | `35%`     | No automatic action. Leave as manual review unless a NEAR-specific refund cue appears.             |
| `65e2da44fb` | `c8cbc2c15c` | 2026-02-13, Bitcoin, `BTC 0.00319759` in    | Normal inbound BTC transfer from an unknown source address into an owned address.                                                                           | `80%`     | No auto-link. User knowledge or missing source wallet import.                                      |
| `6494ed776a` | `3ab863db2a` | 2026-03-21, Bitcoin, `BTC 0.00176784` in    | Normal inbound BTC transfer from an unknown source address into an owned address.                                                                           | `80%`     | No auto-link.                                                                                      |
| `8431e48c50` | `5997082341` | 2026-04-03, Bitcoin, `BTC 0.00210348` in    | Normal inbound BTC transfer from an unknown source address into an owned address.                                                                           | `80%`     | No auto-link.                                                                                      |
| `39a17bb96c` | `f796b68d7a` | 2024-12-10, Solana, `SOL 0.00001` in        | Tiny inbound SOL arrives 9 seconds after a `SOL 1.25` withdrawal from the same wallet. Smells like a rebate/rent/service artifact, but proof is still weak. | `70%`     | Maybe cue later, but not enough for auto-suppression today.                                        |
| `6933a246e8` | `e298227375` | 2026-04-13, Solana, `SOL 0.00001` in        | Pure system transfer of a tiny SOL amount from an unknown address. Could be dust or service residue.                                                        | `45%`     | No automatic action.                                                                               |
| `6084d35254` | `1592eb2dd5` | 2026-04-13, Solana, `SOL 0.000010001` in    | Same tiny-system-transfer shape as above, from a different unknown address.                                                                                 | `45%`     | No automatic action.                                                                               |

## Recommended Work Order

1. Fix processor classification for the `7` non-transfer or reward gaps.
2. Add a first-class `exact_other_profile_counterpart` cue to stop treating those `12` rows like generic same-profile misses.
3. Emit structured bridge/migration diagnostics from raw provider data:
   - Ethereum `sendToInjective(...)`
   - Ethereum Wormhole `transferTokensWithPayload(...)`
   - Solana `ReceiveRenderV2`
4. Reuse raw source data in gap cues:
   - same-recipient gas-funding around receive-then-forward flows
   - repeated external service-funding recipient patterns
5. Add unsolicited EVM token spam suppression so the `4` obvious spam deposits disappear before link review.

## Decisions & Smells

- I treated exact other-profile matches as a UX/cue problem, not a linking-strategy problem. The live data already distinguishes them; the current pain is how they are presented.
- I treated the three small Solana `RENDER` inflows as processor misclassification, not a cue problem. The raw logs are explicit enough that they should never reach transfer review.
- I treated Ethereum -> Injective and Ethereum -> Solana RENDER as “processing first, then linking.” The raw provider data is strong, but it is still trapped inside source payloads instead of normalized diagnostics.
- Arbitrum Etherscan source data currently carries duplicate zero-amount alias token rows for some stablecoin transactions. That is not the direct cause of the open gaps, but it adds debug noise and increases the chance of future misreads.
- Tiny native-asset inflows remain high-risk for automatic suppression. There is not enough evidence yet to hide them safely.

## Naming Issues

Suggested cue/diagnostic names that would make this surface clearer:

- `exact_other_profile_counterpart`
  - clearer than leaving this as a generic gap with hidden cross-profile candidates
- `likely_external_service_funding`
  - clearer for small ETH top-ups into the same external address used by later service flows
- `bridge_transfer_source`
  - useful if we want to distinguish source-side bridge intent from destination-side bridge receipt before a full end-to-end linking strategy exists
- `reward_distribution`
  - better fit for the Solana `RENDER` upgrade reward cases than any transfer-oriented hint
