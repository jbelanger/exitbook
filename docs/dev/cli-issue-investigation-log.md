---
last_verified: 2026-04-16
status: active
---

# CLI Issue Investigation Log

Owner: Codex + Joel

Purpose:

- record what it is like to investigate and solve real accounting issues using
  only the shipped CLI surface
- capture repeatable workflows that may later become a user-facing skill
- surface command friction, missing affordances, ambiguous wording, and places
  where the CLI leaks implementation knowledge

Scope rules:

- use only `pnpm run dev ...` command flows
- do not inspect SQLite directly
- do not patch state outside the command surface
- if a workflow requires internal access to succeed, record that as a surface
  gap instead of working around it silently

What belongs here:

- issue family investigated
- exact CLI commands used
- whether the workflow was discoverable without guessing
- whether the command output was sufficient to continue
- any missing or misleading command examples
- any point where the user would reasonably get stuck
- any fix we ship because of what the CLI investigation revealed

What does not belong here:

- canonical behavioral rules that should live in specs
- long-term execution tracking that belongs in a feature implementation plan
- temporary shell transcripts without conclusions

## Pass 1: Baseline Live Validation

Date: 2026-04-16

Goal:

- verify that the `issues` queue, `links gaps`, and a real reporting command
  behave coherently through the CLI alone
- verify that a real profile-owned corrective action updates the persisted issue
  projection immediately without any manual rebuild step

Commands used:

```bash
pnpm run dev issues --json
pnpm run dev links gaps --json
pnpm run dev cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --json
pnpm run dev links gaps resolve --help
pnpm run dev links gaps reopen --help
pnpm run dev issues view 0bc2408d69 --json
pnpm run dev links gaps resolve 65e2da44fb --reason "CLI-only refresh validation" --json
pnpm run dev issues view 0bc2408d69 --json
pnpm run dev links gaps reopen 65e2da44fb --reason "CLI-only refresh validation cleanup" --json
pnpm run dev issues view 0bc2408d69 --json
```

Findings:

- `issues` and `links gaps` are now coherent:
  - `issues` surfaced `73` blocking issues
  - `links gaps` surfaced `65` transfer gaps
  - the transfer-gap burden shown in `issues` matches the specialized gap lens
- `cost-basis` failed cleanly and routed to the exact scoped
  `issues cost-basis ...` command instead of leaving the user at a dead end
- resolving gap `65e2da44fb` through `links gaps resolve` made issue
  `0bc2408d69` disappear immediately on the next `issues view`, without any
  manual rebuild command
- reopening the same gap through `links gaps reopen` restored the issue
  immediately, confirming that profile-owned issue projection refresh now works
  through the shipped CLI surface

Command-surface assessment:

- `links gaps resolve/reopen --help` is discoverable enough for a reversible
  validation workflow
- `issues view` for transfer-gap issues gives enough routing information to find
  the owning workflow without guessing
- the scoped `cost-basis` failure path is now strong enough for user recovery

Open observations:

- the next CLI-only investigation should target a real unresolved issue, not
  just surface coherence
- the current live workspace still has two main burdens:
  - many `asset_review_blocker` issues
  - many `transfer_gap` issues
- the failed scoped cost-basis lens is the best candidate for later CLI-only
  investigation of cross-command reporting workflows

## Pass 2: First Real Asset-Issue Investigation

Date: 2026-04-16

Goal:

- solve one real `asset_review_blocker` using only the CLI
- note where the command surface is strong enough to act and where it still
  leaves too much guesswork

Issues investigated:

1. `d9233f5e30`
   - asset: `blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8`
   - status: not solved yet
2. `cf1c74f683`
   - asset: `blockchain:arbitrum:0x531bae79da2e057731798be73f20fd87526dbfef`
   - status: solved

Commands used:

```bash
pnpm run dev issues view d9233f5e30
pnpm run dev assets view blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8
pnpm run dev assets view blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9
pnpm run dev transactions list --platform arbitrum --asset USDT --json
pnpm run dev assets list --action-required --json
pnpm run dev issues view cf1c74f683
pnpm run dev assets view blockchain:arbitrum:0x531bae79da2e057731798be73f20fd87526dbfef
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0x531bae79da2e057731798be73f20fd87526dbfef --reason "CLI-only issue resolution after fix" --json
pnpm run dev issues view cf1c74f683 --json
```

Findings:

- The Arbitrum `USDT` ambiguity is a real CLI decision-quality gap:
  - the CLI exposes the conflicting contracts and enough evidence to see there
    is a problem
  - it does **not** expose enough evidence to choose `confirm` vs `exclude`
    confidently for the unmatched contract
  - symbol-level `transactions list --asset USDT` is helpful, but it still
    mixes both contracts and does not let the user inspect one exact asset
    cleanly
- The scam-token blocker was a valid exclusion target:
  - one movement
  - explicit `SCAM_TOKEN` evidence
  - unmatched canonical reference
  - `assets view` gave enough evidence to justify exclusion
- The CLI investigation exposed a real product bug:
  - before the fix, `assets exclude` changed the asset state to `[Excluded]`
    but left the `asset_review_blocker` issue open
  - root cause: profile issue materialization ignored `excludedAssetIds` even
    though the source reader already loaded them
  - shipped fix: excluded assets no longer materialize as
    `asset_review_blocker` issues

Command-surface assessment:

- good:
  - `issues view` now gives enough owning-workflow examples to reach the right
    command family quickly
  - `assets view` is strong enough for obvious scam-token exclusions
- still weak:
  - the asset workflow needs a better exact-asset investigation path for
    same-symbol ambiguity cases
  - likely direction: exact-asset transaction inspection or stronger conflict
    comparison from `assets view`

Current solved state:

- `cf1c74f683` is gone from `issues`
- asset `blockchain:arbitrum:0x531bae79da2e057731798be73f20fd87526dbfef` is
  excluded and now stays out of the profile issue queue

## Pass 3: Exact Asset Investigation Upgrade

Date: 2026-04-16

Goal:

- improve the CLI enough to inspect one exact conflicting asset without mixing
  same-symbol transactions from a different contract
- make the asset detail surface advertise that exact investigation path

Commands used:

```bash
pnpm run dev issues view d9233f5e30
pnpm run dev assets view blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8
pnpm run dev transactions list --asset-id blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8 --json
pnpm run dev transactions list --asset-id blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --json
```

Findings:

- shipped fix: `transactions list` and related browse/export flows now accept
  `--asset-id`, which isolates one exact asset instead of mixing all contracts
  that share a symbol
- shipped fix: `assets view` now shows:
  - full conflicting asset IDs under `Conflict asset`
  - an exact inspection command:
    `transactions list --asset-id <asset-id>`
- the exact filter made the Arbitrum `USDT` ambiguity materially clearer:
  - unmatched asset `0xc7cb...` shows only 2 withdrawals totaling
    `218.061708 USDT`
  - matched asset `0xfd08...` shows the earlier `218.061708 USDT` deposit, the
    later withdrawals, and a small later dust deposit
- that is enough to continue the investigation honestly through the CLI without
  guessing at symbol-level transaction lists

Command-surface assessment:

- strong improvement:
  - the user no longer has to infer an exact-asset transaction command
  - ambiguity detail no longer shortens conflicting assets into bare contract
    refs that are awkward to reuse
- still open:
  - the current asset detail still does not explain _why_ one conflicting asset
    might be safer to exclude than the other
  - the next CLI-only step for this case is likely transaction-level inspection
    of one of the exact conflicting transfers, not more asset-surface changes

## Pass 4: Resolved Ambiguous Arbitrum USDT Through CLI

Date: 2026-04-16

Goal:

- decide whether issue `d9233f5e30` could now be resolved honestly through the
  shipped CLI alone

Commands used:

```bash
pnpm run dev transactions list --asset-id blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8
pnpm run dev transactions list --asset-id blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9
pnpm run dev transactions view 3c0e0a5234
pnpm run dev transactions view 079b26908d
pnpm run dev transactions view 08e44da752
pnpm run dev transactions view f8c08002e6
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8 --reason "CLI-only ambiguity resolution after exact asset investigation" --json
pnpm run dev assets view blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8
pnpm run dev issues view d9233f5e30 --json
pnpm run dev issues --json
```

Findings:

- the unmatched asset `0xc7cb...` now had enough CLI-visible evidence to
  exclude safely:
  - no canonical match
  - only 2 outbound transfers
  - negative net quantity (`-218.061708`)
  - exact quantities mirrored the matched `USDT` asset’s real deposit and later
    withdrawals
  - the unmatched transfers also lacked network-fee context that the matched
    withdrawals had
- after `assets exclude`, the issue disappeared from `issues view`
- the broader profile issue queue dropped from `71` to `70` open/blocking
  issues
- the excluded asset detail now stays coherent:
  - `[Excluded]`
  - include command shown as the reversal path
  - exact transaction inspection path still available for audit

Command-surface assessment:

- this is the first same-symbol ambiguity case that became fully solvable
  through the CLI after the `--asset-id` upgrade
- the successful flow depended on two things:
  - exact-asset transaction isolation
  - public transaction detail by `TX-REF`
- remaining gap:
  - the CLI still made the user do the reasoning manually; it surfaced the
    evidence, but did not summarize the mirrored-transfer pattern itself

## Pass 5: Fixed Stale Ambiguity After Exclusion

Date: 2026-04-16

Goal:

- verify the next real asset-review blocker after Pass 4 and confirm that
  excluding the unwanted contract fully clears the surviving intended asset

Commands used:

```bash
pnpm run dev issues view e7509ce04a
pnpm run dev assets view blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9
pnpm run dev assets confirm --asset-id blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --json
pnpm run dev assets view blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9
pnpm run dev issues view e7509ce04a --json
pnpm run dev issues --json
```

Findings:

- this exposed a second real bug:
  - after excluding the fake `USDT` contract, the matched `USDT` asset still
    showed `same-symbol-ambiguity`
  - `assets confirm` recorded review, but returned `accountingBlocked: true`
  - `issues` kept surfacing the matched asset as blocked
- root cause:
  - read paths were using raw persisted ambiguity evidence without applying the
    current exclusion policy to `conflictingAssetIds`
- shipped fix:
  - asset-review read paths now apply the current exclusion policy over
    same-symbol ambiguity metadata
  - when every conflicting alternative is excluded, the surviving asset reads
    as clear
- live result after the fix:
  - `assets view` for `0xfd08...` now shows no badge, no conflict line, and
    `Action: Nothing needs your attention right now.`
  - `issues view e7509ce04a` now returns `NOT_FOUND`
  - the profile issue queue dropped from `70` to `69`

Command-surface assessment:

- this was not a missing command. It was a stale domain rule leaking through the
  CLI correctly enough to reveal itself.
- the CLI investigation sequence was strong enough to isolate the defect:
  - exclude unwanted asset
  - inspect surviving asset
  - see stale ambiguity remain
  - verify that `issues` still blocked on the same stale ambiguity

## Pass 6: Cost-Basis Failure Routed Back To Profile Asset Review

Date: 2026-04-16

Goal:

- investigate the failed `CA / average-cost / 2024` cost-basis scope strictly
  through the CLI
- determine whether the failure was really a price problem or an earlier
  profile-level blocker

Commands used:

```bash
pnpm run dev issues cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --fiat-currency CAD --start-date 2024-01-01T00:00:00.000Z --end-date 2024-12-31T23:59:59.999Z --json
pnpm run dev cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --json
pnpm run dev issues view 2af7f64baf
pnpm run dev assets view blockchain:arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831
pnpm run dev assets view blockchain:arbitrum:0xecdbd3db08665184630db0b5b4502aa336b69736
pnpm run dev transactions list --asset-id blockchain:arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831
pnpm run dev transactions list --asset-id blockchain:arbitrum:0xecdbd3db08665184630db0b5b4502aa336b69736
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0xecdbd3db08665184630db0b5b4502aa336b69736 --reason "CLI-only ambiguity resolution after exact asset investigation" --json
pnpm run dev assets view blockchain:arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831
pnpm run dev issues view ee6b88fa51 --json
pnpm run dev issues view 91d3b4747a --json
pnpm run dev issues --json
```

Findings:

- the scope-level failure route is useful:
  - bare `cost-basis` still surfaced the user-facing missing-price failure
  - `issues cost-basis` showed the current scoped blocker as
    `execution_failure`
  - `issues view 2af7f64baf` exposed the true current cause:
    unresolved profile asset-review blockers, not prices yet
- the Arbitrum `USDC` pair followed the same pattern as the earlier `USDT` case:
  - matched contract `0xaf88...` had real deposit/withdrawal history
  - unmatched contract `0xecdb...` was outbound-only, negative, and lacked the
    fee context the matched withdrawals had
- excluding `0xecdb...` cleared the surviving matched `USDC` asset
  immediately; no second confirm step was needed
- after resolving the `USDT` and `USDC` ambiguity pairs, the profile issue queue
  dropped from `69` to `64`

Command-surface assessment:

- good:
  - scoped `issues view` is strong enough to explain when a filing failure is
    really a profile review problem in disguise
  - the asset + exact-transaction workflow is now reusable across same-symbol
    ambiguity cases
- still open:
  - the scoped issue family is still named `execution_failure`, even when the
    detail clearly reveals a deterministic preflight blocker that could
    potentially surface as a more specific scoped issue later

## Pass 7: Cleared Scoped Missing-Price Scam Noise Through Assets CLI

Date: 2026-04-16

Goal:

- continue the `CA / average-cost / 2024` scoped issue investigation strictly
  through the CLI
- determine whether the remaining `missing_price` rows were real price-work or
  earlier asset-review noise leaking into the filing scope

Commands used:

```bash
pnpm run dev issues cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --fiat-currency CAD --start-date 2024-01-01T00:00:00.000Z --end-date 2024-12-31T23:59:59.999Z --json
pnpm run dev issues view d5aaf88c80 --json
pnpm run dev transactions view fb78bc2336 --json
pnpm run dev transactions view 56feb63288 --json
pnpm run dev transactions view 5276082946 --json
pnpm run dev transactions view ae5740d3b3 --json
pnpm run dev transactions view 438e64bbef --json
pnpm run dev assets list --action-required --json
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0x03072a044a7fdd4031b86a8c83d0feb5d04ace8c --reason "CLI-only cost-basis missing-price scam exclusion" --json
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0x95e8799b6c3c7942e321ff95ee0a656fefe20bda --reason "CLI-only cost-basis missing-price scam exclusion" --json
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0x8bc3051e5ae5ec07b1246b1bd25f1ecb2443ca1b --reason "CLI-only cost-basis missing-price scam exclusion" --json
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0x8030b0966b55a2573699ea37dc2dc71262c2f76e --reason "CLI-only cost-basis missing-price scam exclusion" --json
pnpm run dev assets exclude --asset-id blockchain:arbitrum:0xbf829835cce05a22382ac2e09a04fb9435eae18b --reason "CLI-only cost-basis missing-price scam exclusion" --json
pnpm run dev issues cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --fiat-currency CAD --start-date 2024-01-01T00:00:00.000Z --end-date 2024-12-31T23:59:59.999Z --json
pnpm run dev cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --json
```

Findings:

- the five remaining scoped `missing_price` issues were not real price-research
  work:
  - each was a one-off Arbitrum scam-token inflow
  - each carried clear `SCAM_TOKEN` evidence in transaction detail
  - each asset was already visible in `assets list --action-required`
- excluding the five scam assets through the normal `assets exclude` workflow
  was enough to clear the scoped price burden honestly
- after the exclusions:
  - `issues cost-basis ...` dropped from 6 rows to 1 row
  - the remaining row became a warning-only
    `UNCERTAIN_PROCEEDS_ALLOCATION` issue
  - `cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --json`
    completed successfully

Command-surface assessment:

- this was a strong cross-workflow success case:
  - scoped filing issues routed to exact transactions
  - transaction detail exposed the real scam evidence
  - the owning corrective action stayed in `assets`
  - re-reading the same filing scope reflected the result honestly
- remaining gap:
  - the scoped `missing_price` issue family still required manual recognition
    that the right fix lived in `assets`, not `prices`

## Pass 8: Transfer-Gap Investigation Exposed Broken Date Filtering

Date: 2026-04-16

Goal:

- investigate the remaining transfer-gap burden strictly through the CLI
- confirm whether the shipped transaction browse surface was strong enough to
  inspect likely same-day candidates without guessing

Commands used:

```bash
pnpm run dev issues view 0bc2408d69 --json
pnpm run dev links gaps view 65e2da44fb --json
pnpm run dev transactions view c8cbc2c15c --json
pnpm run dev transactions list --platform bitcoin --asset BTC --since 2026-02-12 --until 2026-02-14 --json
```

Findings:

- this exposed a real browse bug:
  - `transactions list --since/--until` was filtering on row creation time,
    not transaction datetime
  - the command returned irrelevant 2023-2026 BTC history when it should have
    returned only the requested 2026-02-12 to 2026-02-14 window
- shipped fix:
  - repository date filtering now uses `transactions.transaction_datetime`
  - a regression test now protects `findAll({ since })`

Command-surface assessment:

- the live CLI investigation was necessary to reveal this; unit coverage had
  not caught the fact that the browse command violated its obvious user
  contract
- once fixed, date-window investigation became usable enough for real transfer
  review

## Pass 9: Resolved High-Confidence Transfer Suggestions, Then Closed The Gap-View Command Hop

Date: 2026-04-16

Goal:

- continue transfer-gap cleanup through the CLI alone
- identify where the user still had to jump between commands to finish an
  otherwise obvious resolution

Commands used:

```bash
pnpm run dev links list --status suggested --min-confidence 0.9 --json
pnpm run dev transactions view ee9ba3a19e --json
pnpm run dev transactions view 846dfdd39d --json
pnpm run dev links view 49256e4264 --json
pnpm run dev links confirm 49256e4264 --json
pnpm run dev links view 5be524d412 --json
pnpm run dev links view 4f343401d0 --json
pnpm run dev links confirm 5be524d412 --json
pnpm run dev links confirm 4f343401d0 --json
pnpm run dev links gaps view 445883f6ee --json
pnpm run dev links gaps view 8650cd6e7c --json
pnpm run dev issues --json
```

Findings:

- the live CLI workflow successfully resolved:
  - the `RNDR` KuCoin → Ethereum pair through proposal `49256e4264`
  - the two remaining 100% confidence BTC proposals `5be524d412` and
    `4f343401d0`
- those confirmations reduced the profile issue queue from 61 transfer-gap rows
  to 55 total issues
- but the workflow exposed a real discoverability defect:
  - `links gaps view` showed `suggestedCount` and confidence
  - it did **not** show the exact proposal ref to confirm
  - the user had to leave the gap workflow, open `links list --status suggested`,
    and manually correlate the right `LINK-REF`
- shipped fix:
  - `links gaps view` detail now shows exact `links confirm <LINK-REF>` commands
    when the proposal ref can be derived honestly
  - gap JSON now includes `suggestedProposalRefs`

Command-surface assessment:

- before the fix, gap review still leaked too much internal navigation
- after the fix, the gap detail surface itself carries the exact next command
  when the data supports it
- current live workspace note:
  - after resolving the remaining suggestions, there were no naturally pending
    suggested gaps left to exercise the new detail path live again
  - the improvement is still grounded in the earlier real workflow and covered
    by focused CLI tests

## Pass 10: Link Review Commands Were Not Symmetric

Date: 2026-04-16

Goal:

- use the CLI itself to validate the revised link-review surface
- verify that a mistaken rejection can be recovered without leaving the command
  surface

Commands used:

```bash
pnpm run dev links view 4f343401d0 --json
pnpm run dev links reject 4f343401d0 --json
pnpm run dev links confirm 4f343401d0 --json
pnpm run dev links view 4f343401d0 --json
```

Findings:

- this exposed a second real command-surface bug:
  - `links reject` allowed a previously confirmed proposal to move to
    `rejected`
  - `links confirm` then refused to move the same proposal back to
    `confirmed`
  - the CLI had a one-way review mutation even though both commands were
    visible as first-class review actions
- shipped fix:
  - `links confirm` now confirms any non-confirmed proposal legs in the
    selected proposal
  - `links reject` and `links confirm` are now symmetric review mutations over
    reviewable proposal legs
  - the TUI reducer and command help copy now use the same model
- live result:
  - proposal `4f343401d0` was rejected through the CLI
  - the same proposal was then restored to `confirmed` through the CLI
  - the workspace ended back in a clean semantic state

Command-surface assessment:

- this was exactly the kind of defect the CLI-only investigation is meant to
  surface: the product looked complete, but one real recovery path was missing
- one smaller follow-up smell remains:
  - `links reject` still does not accept a `--reason`, unlike gap-resolution
    commands

## Pass 11: Repeated BTC Inflow Gaps Resolved As No-Link Exceptions

Date: 2026-04-16

Goal:

- continue reducing the live profile issue queue strictly through the CLI
- determine whether the remaining transfer gaps included a repeatable pattern
  that could later become a user-facing investigation skill

Issues and gaps resolved:

1. `0bc2408d69` / `65e2da44fb`
   - transaction ref: `c8cbc2c15c`
2. `0eb4db9c9c` / `8431e48c50`
   - transaction ref: `5997082341`

Commands used:

```bash
pnpm run dev issues view 0bc2408d69 --json
pnpm run dev links gaps view 65e2da44fb --json
pnpm run dev transactions view c8cbc2c15c --json
pnpm run dev transactions list --platform bitcoin --asset BTC --since 2026-02-12 --until 2026-02-14 --json
pnpm run dev accounts list --platform bitcoin --json
pnpm run dev links gaps resolve 65e2da44fb --reason "External BTC inflow from untracked source address bc1qkavv9h6dhexg8e62e7kc4xwunksk3h3jfl9943" --json
pnpm run dev issues view 0bc2408d69 --json
pnpm run dev issues view 0eb4db9c9c --json
pnpm run dev links gaps view 8431e48c50 --json
pnpm run dev transactions view 5997082341 --json
pnpm run dev links gaps resolve 8431e48c50 --reason "External BTC inflow from untracked source address bc1qtvr642rlwlwu20p3nqfppmwlyl7mc2s7dyp3ad" --json
pnpm run dev issues view 0eb4db9c9c --json
pnpm run dev issues --json
```

Findings:

- both gaps matched the same pattern:
  - single BTC inflow on a tracked destination address
  - source address not present in the imported Bitcoin account set
  - no matching Bitcoin or exchange-side BTC outflow candidate in the repaired
    date window
  - no diagnostics or suggested proposals pointing to an internal transfer path
- in both cases, `links gaps resolve` was the honest command:
  - the transaction intentionally had no internal link to confirm
  - the issue disappeared immediately after the resolve command
  - the profile issue queue dropped from 55 to 53

Command-surface assessment:

- this is the first strong candidate for a user-facing CLI investigation skill:
  - inspect issue
  - inspect gap
  - inspect transaction
  - check nearby date-window candidates
  - check whether destination is tracked and source is not
  - resolve as a gap exception with an evidence-based reason
- current limitation:
  - the CLI does not yet summarize this pattern directly, so the operator still
    has to infer it manually from the transaction and account surfaces

## Pass 12: Same-Hash BTC Outflow Clusters Still Need Better Group UX

Date: 2026-04-16

Goal:

- investigate whether the remaining BTC transfer gaps were still individual
  decisions or were really repeated rows for one underlying blockchain send
- improve the shipped CLI enough to surface that pattern directly

Commands used:

```bash
pnpm run dev issues view 54a85e55f5 --json
pnpm run dev issues view 6a6bcebcf7 --json
pnpm run dev links gaps view 7c626aaafa --json
pnpm run dev transactions view 0436b78ccb --json
pnpm run dev transactions view d7cf981709 --json
pnpm run dev transactions view 029c7fa342 --json
pnpm run dev transactions view efe42f1f51 --json
pnpm run dev accounts list --platform bitcoin --json
pnpm run dev links gaps view 7c626aaafa
```

Findings:

- the next repeated live pattern is not another simple inbound exception
- it is a same-hash BTC outflow cluster:
  - multiple open gap rows
  - each on a different tracked processed transaction row
  - all sharing one Bitcoin transaction hash
  - all sending to the same untracked external destination
- before the fix, `links gaps view <gap-ref>` hid the key facts that make this
  obvious:
  - whether `from` / `to` are tracked
  - whether sibling open gaps exist on the same blockchain hash
- shipped fix:
  - `links gaps view` and `links gaps view --json` now include
    `transactionContext`
  - that context carries:
    - blockchain hash
    - raw `from` / `to`
    - `fromOwnership` / `toOwnership`
    - `openSameHashGapRowCount`
    - `openSameHashTransactionRefs`
- this makes the repeated BTC pattern visible from one gap detail instead of
  requiring several manual transaction/account comparisons

Command-surface assessment:

- improved:
  - the CLI now exposes enough evidence for a future skill or operator to
    recognize `tracked source -> untracked destination` directly from the gap
    detail
  - the JSON contract is now strong enough for a future automation/skill to use
    without scraping prose
- still open:
  - the command surface is still row-at-a-time for same-hash outflow clusters
  - if four open rows are really one external send decision, the user still has
    to resolve four separate gaps
  - that is a real product smell, not just missing wording

## Automatic-Linking Notes

These are not canonical rules yet. They are implementation candidates revealed
by live CLI investigation and should be revisited as linking improves.

Patterns that currently look like good candidates for more automatic handling:

- same-hash blockchain clusters with one clear external route
  - example seen live: the 2024-07-05 BTC outflow cluster
  - multiple tracked processed rows shared one blockchain hash and one
    untracked destination
  - this currently behaves like several separate gap decisions, but it appears
    much closer to one underlying external send
  - likely product direction:
    - collapse the review burden to one grouped gap workflow
    - or auto-resolve sibling rows once one grouped external-send decision is
      confirmed
- same-hash blockchain clusters with one clear tracked-to-tracked route
  - if future live investigation shows one normalized hash with one tracked
    sender side and one tracked receiver side and no competing quantities, that
    should likely become pre-linking / confirmed-link automation rather than
    manual review
- externally sourced blockchain inflows with strong negative evidence for an
  internal counterpart
  - example seen live: repeated BTC inflows from untracked source addresses
    into tracked wallets, with no nearby exchange/blockchain counterpart
  - these are currently handled honestly as manual gap exceptions
  - they may be good candidates for stronger automatic guidance, but not yet
    for silent auto-resolution
- same-hash external sends into one exact exchange deposit with no hash
  - example seen live: the 2024-07-05 BTC outflow cluster into Kraken
  - the exchange deposit had no blockchain hash, so the old exact-hash-only
    strategy produced no suggestion at all
  - a conservative grouped strategy fallback was safe here because:
    - one same-hash blockchain outflow group existed
    - one exact-amount exchange deposit followed shortly after
    - no tracked sibling inflows competed with the route
    - there was only one viable exchange target candidate
  - this is now implemented as a `suggested` same-hash external proposal, not
    an auto-confirmed link

Patterns that still look manual by design:

- cases where the CLI can show `tracked` vs `untracked`, but quantity matching,
  counterparty meaning, or grouped intent is still ambiguous
- mixed-scope blockchain events that depend on processor truth rather than
  linking heuristics
- cross-platform transfers that still need timing/amount/counterparty judgment
  beyond what one route can prove

## Pass 13: Same-Hash BTC Cluster Closed By Strategy, Not Manual Exception

Date: 2026-04-16

Goal:

- determine whether the BTC same-hash outflow cluster should stay a manual
  grouped gap workflow or could be solved conservatively by the linker itself

Commands used:

```bash
pnpm run dev transactions list --platform bitcoin --asset BTC --since 2024-07-05 --until 2024-07-06 --json
pnpm run dev transactions view b12ff406b1 --json
pnpm run dev links run --json
pnpm run dev links gaps view 7c626aaafa
pnpm run dev links gaps view 345af7d9e9 --json
pnpm run dev links confirm 1b358e686e --json
pnpm run dev issues view 54a85e55f5 --json
pnpm run dev links gaps view 7c626aaafa --json
pnpm run dev issues --json
pnpm run dev links run --json
```

Findings:

- the cluster was a real automatic-linking candidate, not a manual exception:
  - five tracked BTC outflows shared one blockchain hash and one external
    destination
  - one Kraken BTC deposit followed shortly after with the exact grouped amount
  - the Kraken deposit had no blockchain hash, so the old exact-hash-only
    strategy never suggested a route
- shipped fix:
  - same-hash external outflow matching now allows one conservative fallback
    target when:
    - the target has no blockchain hash
    - the grouped amount matches exactly
    - the deposit arrives within one hour
    - there is exactly one viable exchange target
  - fallback matches are always emitted as `suggested`
  - link metadata now records
    `sameHashExternalTargetEvidence=exact_amount_timing`
- live result:
  - `links run --json` moved from `0` to `5` suggested links
  - the same proposal ref `1b358e686e` appeared on multiple gap rows in the
    cluster, which confirmed that the grouped decision was modeled coherently
  - `links confirm 1b358e686e --json` confirmed all five links at once
  - the related gap refs and issue refs disappeared immediately afterward
  - the profile issue queue dropped from `52` to `47`
  - a follow-up `links run --json` returned `0` suggested links, so the queue
    was cleanly converged

Command-surface assessment:

- strong:
  - the current CLI was sufficient to validate and confirm the grouped
    strategy once the linker produced a real proposal
  - one grouped proposal confirmation clearing five gap rows is the right
    user-facing behavior for this pattern
- still weak:
  - `links gaps explore` still does not explain the suggested target route any
    better than `links gaps view`
  - the operator still cannot inspect the proposed target transaction ref or
    the strategy evidence directly from the gap surface
  - `links gaps` browse still has no `--limit`, which makes larger live queues
    harder to slice during investigation
