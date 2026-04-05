# Accounts CLI Implementation Tracker

Tracks implementation progress for the `accounts` family redesign defined in [Accounts CLI Spec](/Users/joel/Dev/exitbook/docs/specs/cli/accounts/accounts-view-spec.md).

This is a working tracker, not a speculative roadmap. After each coherent slice lands, stop, re-read the code, and update this document from facts.

## Working Rules

- Only one active slice at a time.
- Prefer architectural clarity over local convenience.
- Do not preserve obsolete command boundaries or helper shapes just to minimize diffs.
- If something must be deferred, add a `TODO:` in code with a concrete follow-up, then re-assess it regularly.
- Do not carry speculative future work here unless it is the immediate next reassessment candidate.
- Every completed slice must leave the codebase coherent, documented, and validated with `pnpm lint`, `pnpm build`, and `pnpm test`.

## Current Slice

### Phase 10: Improve New-Account Balance Guidance And Detail Copy

Status: `completed`

Intent:

- remove circular detail hints that told users to refresh before any transaction data existed
- replace internal detail jargon like `Projection`, `Verification`, and `snapshot is not readable`
- make refresh completion styling match actual outcomes instead of always looking successful
- keep first-run account guidance aligned between detail and workflow surfaces

Why this slice came next:

- review feedback exposed a poor first-run account experience
- new accounts could hit a dead-end loop: detail said `accounts refresh`, refresh said `No import sessions found`
- the detail surfaces still leaked internal storage terminology even after the command unification
- refresh footer severity still needed one more UX pass after the earlier correctness work

What landed:

- unreadable account detail now checks import readiness for the real balance scope and tells users to run `exitbook import` first when no transaction data exists
- brand-new account detail now says `No balance data yet` instead of `stored balance snapshot is not readable`
- detail headers now use `Balance data` and `Live check`, and hide the status row entirely when both values are still untouched
- detail surfaces now say `Import sessions: N` instead of `Imports: N imports`
- refresh completion now uses success, warning, or error styling based on actual totals
- missing-import refresh failures now explain the next step directly in the balance workflow

## Verified Current Facts

- `accounts refresh` is the only CLI workflow entrypoint for rebuilding stored balances and verifying live data in [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts) and [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts).
- `accounts` is now the only user-facing CLI family for stored balance inspection as well as refresh.
- Stored balance freshness messaging and related read surfaces direct users to `exitbook accounts refresh`.
- `refresh` remains reserved as an account name.
- `accounts` list rows now show stored asset count when the stored snapshot is readable in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts).
- `accounts` detail now shows full stored balance detail, including asset rows and unreadable snapshot hints, in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts).
- The `accounts` projection/model layer now includes stored asset count plus stored status/suggestion summary in [account-query-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/query/account-query-utils.ts), [account-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/account-view-projection.ts), and [accounts-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/accounts-view-model.ts).
- `accounts` detail loading is now read-only and separate from the list query in [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts).
- Stored asset rows now include `liveBalance` and `comparisonStatus` in [stored-balance-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-view.ts) and [account-balance-detail-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/account-balance-detail-builder.ts).
- Shared static stored-balance asset rendering now lives in [stored-balance-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-static-renderer.ts).
- `accounts view` now supports stored-balance asset drilldown in [accounts-view-controller.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-controller.ts), [accounts-view-state.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-state.ts), and [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx).
- TUI browse presentation now preloads per-account detail in [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts).
- Shared stored-balance asset explorer rendering now lives in [stored-balance-assets-view.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-assets-view.tsx) and [stored-balance-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-formatters.ts).
- The TUI preview in [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx) now matches the browse wording already used by the static table and the asset diagnostics panel.
- The shared drilled-down asset view in [stored-balance-assets-view.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-assets-view.tsx) now uses the same label, so browse semantics are consistent across static, preview, and drilldown surfaces.
- Aborted refresh streams now surface cancellation back to the command layer in [accounts-refresh-runner.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-runner.ts) and [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts).
- All-refresh aggregate totals now expose separate `errors`, `mismatches`, `warnings`, and `partialCoverageScopes` counts in [accounts-refresh-types.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-types.ts).
- Live e2e helper contracts now target `accounts` browse plus `accounts refresh` in [exchange-workflow-factory.ts](/Users/joel/Dev/exitbook/apps/cli/src/__tests__/helpers/exchange-workflow-factory.ts), [blockchain-workflow-factory.ts](/Users/joel/Dev/exitbook/apps/cli/src/__tests__/helpers/blockchain-workflow-factory.ts), and [e2e-test-types.ts](/Users/joel/Dev/exitbook/apps/cli/src/__tests__/helpers/e2e-test-types.ts).
- unreadable account balance detail now differentiates between `no imports`, `no completed imports`, and `stale balance data` in [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts) and [balance-snapshot-freshness-message.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/balance-snapshot-freshness-message.ts).
- static and TUI account detail now use the same user-facing `Balance data` / `Live check` wording in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts), [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx), and [accounts-view-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-formatters.ts).
- balance refresh workflow failures now tell users to run `exitbook import` first when no imported transaction data exists in [balance-workflow.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-workflow.ts).

## Phase 10 Exit Criteria

- New accounts do not get told to run `accounts refresh` before any transaction data exists.
- Static and TUI detail wording no longer says `Projection`, `Verification`, or `snapshot is not readable` for first-run accounts.
- Refresh completion styling matches the actual outcome severity.
- Missing-import refresh failures explain the next step directly.

Phase 10 result:

- all exit criteria met

## Likely Touchpoints

- [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts)
- [balance-snapshot-freshness-message.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/balance-snapshot-freshness-message.ts)
- [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts)
- [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx)
- [accounts-view-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-formatters.ts)
- [balance-workflow.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-workflow.ts)

## Slice Notes

Constraints that shaped the implementation:

- derive first-run guidance from the real balance scope instead of guessing from the selected row summary
- keep static and TUI wording aligned through shared formatter/message helpers
- avoid inventing import-command specifics in hints; generic `exitbook import` guidance is enough here

Post-slice reassessment notes:

- first-run balance UX is materially clearer now
- the next reassessment should look at broader browse UX and scaling concerns rather than more wording churn

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-scan the shipped `accounts` behavior for remaining spec drift or awkward UX.
3. Pick the single highest-value behavioral slice, not another wording-only cleanup unless it affects semantics.

Likely next reassessment candidates:

- tighten any remaining explorer/detail behavior drift beyond wording
- simplify newly moved account refresh/detail modules if any names or helper boundaries still feel awkward
- update broader trackers/spec references only where the shipped code now justifies it

Do not commit to one of these until the code is re-read and the best slice is confirmed again.

## Progress Log

| Slice                                                            | Status      | Notes                                                                                                                       |
| ---------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed.       |
| Phase 1: `accounts refresh` as canonical workflow command        | `completed` | Added `accounts refresh`; refresh text is line-oriented progress; stale guidance now points to `accounts refresh`.          |
| Phase 2: remove legacy `balance refresh` alias                   | `completed` | Deleted `balance refresh`; moved refresh command support under `accounts`; `balance` is now browse-only.                    |
| Phase 3: add stored balance summary to `accounts` browse         | `completed` | Added `ASSETS` to static list and a summary-level `Balances` section to static/detail/JSON browse surfaces.                 |
| Phase 4: add full stored balance detail to `accounts` detail     | `completed` | Added nested detail balance data, full asset tables, unreadable snapshot hints, and shared stored-balance rendering.        |
| Phase 5: move stored balance drilldown into `accounts view`      | `completed` | Added accounts explorer asset drilldown, preloaded explorer detail, and shared stored-snapshot asset rendering.             |
| Phase 6: remove legacy `balance` browse surface                  | `completed` | Deleted the user-facing `balance` browse family, updated current-facing docs/help, and trimmed dead browse-only code.       |
| Phase 7: remove final internal CLI `balance` namespace           | `completed` | Moved remaining refresh/detail support under `accounts` and `shared`, then deleted the CLI `balance` feature folder.        |
| Phase 8: align stored-live labels in browse TUI                  | `completed` | Updated the accounts preview and drilled-down asset rows to say `last verified live` and added renderer coverage.           |
| Phase 9: tighten refresh correctness and live test coverage      | `completed` | Fixed abort footer semantics, surfaced stored snapshot read failures, split refresh totals, and realigned live e2e helpers. |
| Phase 10: improve new-account balance guidance and detail copy   | `completed` | Added import-first hints, simplified new-account detail wording, and aligned refresh severity styling with outcomes.        |
