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
