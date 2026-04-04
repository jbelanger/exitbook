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

### Phase 6: Remove The Legacy `balance` Browse Surface

Status: `completed`

Intent:

- remove the remaining user-facing `balance` browse namespace now that `accounts` owns stored balance inspection
- update current-facing docs/help so they stop describing `balance` as a real CLI family
- trim dead browse-only balance support code instead of leaving a hollow command shell behind

Why this slice came next:

- `accounts` already owned static detail, JSON detail, and explorer drilldown for stored balance inspection
- the remaining `balance` command family was legacy surface area, not distinct capability
- deleting the browse shell now keeps the user-facing contract elegant before any deeper internal ownership moves

What landed:

- The `balance` browse command registration and deleted browse implementation files are now gone from `apps/cli/src/features/balance/`.
- CLI help and current-facing specs now treat `accounts` as the canonical stored-balance read surface.
- Dead browse-only balance support was trimmed:
  - [run-balance.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/run-balance.ts) no longer exposes a dead browse entrypoint
  - [balance-command-scope.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-command-scope.ts) no longer carries the unused stored-snapshot reader
  - [balance-view-state.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/view/balance-view-state.ts) now exports only refresh/detail types still used by live code
  - [balance-view-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/view/balance-view-utils.ts) no longer keeps dead browse-only builders/sorts

## Verified Current Facts

- `accounts refresh` is the only CLI workflow entrypoint for rebuilding stored balances and verifying live data in [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts) and [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts).
- `accounts` is now the only user-facing CLI family for stored balance inspection as well as refresh.
- Stored balance freshness messaging and related read surfaces direct users to `exitbook accounts refresh`.
- `refresh` remains reserved as an account name.
- `accounts` list rows now show stored asset count when the stored snapshot is readable in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts).
- `accounts` detail now shows full stored balance detail, including asset rows and unreadable snapshot hints, in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts).
- The `accounts` projection/model layer now includes stored asset count plus stored status/suggestion summary in [account-query-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/query/account-query-utils.ts), [account-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/account-view-projection.ts), and [accounts-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/accounts-view-model.ts).
- `accounts` detail loading is now read-only and separate from the list query in [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts).
- Stored asset rows now include `liveBalance` and `comparisonStatus` in [stored-balance-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-view.ts) and [balance-asset-details-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-asset-details-builder.ts).
- Shared static stored-balance asset rendering now lives in [stored-balance-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-static-renderer.ts).
- `accounts view` now supports stored-balance asset drilldown in [accounts-view-controller.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-controller.ts), [accounts-view-state.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-state.ts), and [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx).
- TUI browse presentation now preloads per-account detail in [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts).
- Shared stored-balance asset explorer rendering now lives in [stored-balance-assets-view.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-assets-view.tsx) and [stored-balance-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-formatters.ts).
- The remaining CLI balance code is internal support reused by `accounts`, not a separate command family.

## Phase 6 Exit Criteria

- `exitbook balance` and `exitbook balance view` are no longer registered CLI commands.
- Current-facing docs/help no longer describe `balance` as a live command family.
- Dead browse-only balance support code is removed instead of being left behind as a hollow compatibility shell.

Phase 6 result:

- all exit criteria met

## Likely Touchpoints

- [cli.ts](/Users/joel/Dev/exitbook/apps/cli/src/cli.ts)
- [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts)
- [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts)
- [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts)
- [balance-command-scope.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-command-scope.ts)
- [balance-asset-details-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-asset-details-builder.ts)
- [balance-view-state.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/view/balance-view-state.ts)
- [balance-view-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/view/balance-view-utils.ts)
- current-facing CLI docs under `docs/specs/cli/`

## Slice Notes

Constraints that shaped the implementation:

- remove the user-facing legacy surface cleanly instead of keeping aliases or duplicate read entrypoints
- keep current-facing docs aligned with the actual shipped CLI surface
- delete obviously dead browse-only code in the same slice when the owning command surface is removed

Post-slice reassessment notes:

- the user-facing balance browse surface is gone
- the remaining cleanup is internal ownership: balance workflow/detail helpers still live under `apps/cli/src/features/balance/` even though `accounts` owns the CLI surface
- the next slice should decide whether those remaining internal helpers move under `accounts` or a neutral shared path so the CLI balance feature directory can disappear entirely

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-inspect the remaining internal files under `apps/cli/src/features/balance/`.
3. Pick the single best ownership move that removes the last balance-only CLI support path without duplicating code.

Likely next reassessment candidates:

- move the remaining balance refresh/detail support files under `accounts` or `shared`
- rename the remaining balance-owned helper types/modules so they reflect their post-consolidation role more clearly
- delete the final internal CLI balance feature directory once no live imports point at it

Do not commit to one of these until the code is re-read and the best slice is confirmed again.

## Progress Log

| Slice                                                            | Status      | Notes                                                                                                                 |
| ---------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed. |
| Phase 1: `accounts refresh` as canonical workflow command        | `completed` | Added `accounts refresh`; refresh text is line-oriented progress; stale guidance now points to `accounts refresh`.    |
| Phase 2: remove legacy `balance refresh` alias                   | `completed` | Deleted `balance refresh`; moved refresh command support under `accounts`; `balance` is now browse-only.              |
| Phase 3: add stored balance summary to `accounts` browse         | `completed` | Added `ASSETS` to static list and a summary-level `Balances` section to static/detail/JSON browse surfaces.           |
| Phase 4: add full stored balance detail to `accounts` detail     | `completed` | Added nested detail balance data, full asset tables, unreadable snapshot hints, and shared stored-balance rendering.  |
| Phase 5: move stored balance drilldown into `accounts view`      | `completed` | Added accounts explorer asset drilldown, preloaded explorer detail, and shared stored-snapshot asset rendering.       |
| Phase 6: remove legacy `balance` browse surface                  | `completed` | Deleted the user-facing `balance` browse family, updated current-facing docs/help, and trimmed dead browse-only code. |
