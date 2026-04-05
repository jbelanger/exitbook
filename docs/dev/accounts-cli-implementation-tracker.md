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

### Phase 9: Tighten Refresh Correctness And Live Test Coverage

Status: `completed`

Intent:

- remove misleading success semantics from aborted `accounts refresh` runs
- stop hiding stored snapshot repository failures behind empty-balance output
- realign the live e2e helpers to the unified `accounts` browse/refresh surface
- split refresh totals so mismatches, warnings, and partial coverage are reported explicitly

Why this slice came next:

- review findings exposed correctness drift in the refresh workflow and supporting tests
- the old all-refresh footer still looked successful after aborts
- the live e2e layer was still asserting a deleted pre-unification contract
- refresh aggregate totals were semantically muddy for JSON consumers

What landed:

- `accounts refresh` now prints an aborted footer instead of a success footer when the stream is cancelled.
- Stored snapshot asset load failures now fail loudly instead of rendering as an empty asset list.
- All-refresh totals now report `mismatches`, `warnings`, and `partialCoverageScopes` separately.
- Live e2e helpers now browse with `accounts --platform ... --json`, refresh with `accounts refresh`, and persist exchange credentials at import time instead of passing them to refresh.

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

## Phase 9 Exit Criteria

- Aborted refresh runs do not print a success-looking completion footer.
- Stored snapshot asset repository failures are surfaced as command errors, not empty balances.
- Live e2e helpers target the shipped `accounts` browse/refresh contract.
- All-refresh totals stop overloading `mismatches` with warnings and partial coverage.

Phase 9 result:

- all exit criteria met

## Likely Touchpoints

- [accounts-refresh-runner.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-runner.ts)
- [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts)
- [account-balance-detail-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/account-balance-detail-builder.ts)
- [accounts-refresh.test.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/__tests__/accounts-refresh.test.ts)
- [accounts-refresh-services.test.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/__tests__/accounts-refresh-services.test.ts)
- [apps/cli/src/**tests**/helpers/](/Users/joel/Dev/exitbook/apps/cli/src/__tests__/helpers/)

## Slice Notes

Constraints that shaped the implementation:

- keep the fixes behaviorally precise instead of reopening larger ownership refactors
- prefer explicit totals and hard failures over ambiguous success output
- update the live test helpers to the shipped command contract instead of preserving compatibility glue

Post-slice reassessment notes:

- refresh correctness is tighter, but the explorer still preloads detail eagerly and may need scaling review later
- the next slice should come from another code/spec reread, not from carrying this review list forward blindly

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
