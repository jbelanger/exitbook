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

### Phase 11: Tighten Batch Refresh Output And Detail Labels

Status: `completed`

Intent:

- remove the remaining rough edges in `accounts refresh` batch output
- stop repeating import guidance in every failed account line during all-account refresh
- suppress empty aggregate detail lines that add no information
- simplify the account detail import label to `Imports`

Why this slice came next:

- the previous slice fixed first-run guidance, but the global refresh text still felt noisy
- batch refresh still had a visible `1 errors` pluralization bug
- import-related failures repeated the same next-step guidance on every failing row
- account detail still used `Import sessions`, which was a bit too internal for the shipped surface

What landed:

- batch refresh footers now use singular/plural `error` counts correctly
- all-account refresh now shortens repeated import-related failure lines and prints one shared `Next:` hint in the footer instead
- aggregate detail lines are now suppressed when every count is zero
- aggregate detail wording now says `partial coverage result` instead of `partial coverage scopes`
- account detail surfaces now say `Imports: N`

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
- batch `accounts refresh` output now shortens repeated import-related failure lines, prints a shared footer hint, uses correct `error/errors` pluralization, and suppresses zero-only detail lines in [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts).
- static and TUI account detail now say `Imports: N` in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts) and [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx).

## Phase 11 Exit Criteria

- All-account refresh footers do not show `1 errors`.
- Batch refresh does not repeat full import guidance on every failed account line.
- Zero-only aggregate detail lines are suppressed.
- Account detail uses `Imports: N`.

Phase 11 result:

- all exit criteria met

## Likely Touchpoints

- [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts)
- [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts)
- [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx)
- [accounts-refresh.test.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/__tests__/accounts-refresh.test.ts)

## Slice Notes

Constraints that shaped the implementation:

- keep single-account refresh guidance verbose while making all-account refresh concise
- suppress noise only when it is truly empty; keep the detail line when there is anything worth surfacing
- keep static and TUI detail labels aligned

Post-slice reassessment notes:

- global refresh output reads more cleanly now
- the next reassessment should look at broader browse UX and scaling concerns rather than more copy cleanup unless it changes behavior

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

| Slice                                                            | Status      | Notes                                                                                                                                                 |
| ---------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed.                                 |
| Phase 1: `accounts refresh` as canonical workflow command        | `completed` | Added `accounts refresh`; refresh text is line-oriented progress; stale guidance now points to `accounts refresh`.                                    |
| Phase 2: remove legacy `balance refresh` alias                   | `completed` | Deleted `balance refresh`; moved refresh command support under `accounts`; `balance` is now browse-only.                                              |
| Phase 3: add stored balance summary to `accounts` browse         | `completed` | Added `ASSETS` to static list and a summary-level `Balances` section to static/detail/JSON browse surfaces.                                           |
| Phase 4: add full stored balance detail to `accounts` detail     | `completed` | Added nested detail balance data, full asset tables, unreadable snapshot hints, and shared stored-balance rendering.                                  |
| Phase 5: move stored balance drilldown into `accounts view`      | `completed` | Added accounts explorer asset drilldown, preloaded explorer detail, and shared stored-snapshot asset rendering.                                       |
| Phase 6: remove legacy `balance` browse surface                  | `completed` | Deleted the user-facing `balance` browse family, updated current-facing docs/help, and trimmed dead browse-only code.                                 |
| Phase 7: remove final internal CLI `balance` namespace           | `completed` | Moved remaining refresh/detail support under `accounts` and `shared`, then deleted the CLI `balance` feature folder.                                  |
| Phase 8: align stored-live labels in browse TUI                  | `completed` | Updated the accounts preview and drilled-down asset rows to say `last verified live` and added renderer coverage.                                     |
| Phase 9: tighten refresh correctness and live test coverage      | `completed` | Fixed abort footer semantics, surfaced stored snapshot read failures, split refresh totals, and realigned live e2e helpers.                           |
| Phase 10: improve new-account balance guidance and detail copy   | `completed` | Added import-first hints, simplified new-account detail wording, and aligned refresh severity styling with outcomes.                                  |
| Phase 11: tighten batch refresh output and detail labels         | `completed` | Fixed `1 error` pluralization, moved repeated import guidance into a shared footer hint, hid zero-only detail lines, and simplified `Imports` labels. |
