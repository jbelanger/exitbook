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

### Phase 5: Move Stored Balance Drilldown Into `accounts view`

Status: `completed`

Intent:

- make `accounts view` the primary explorer for stored balance inspection
- add asset drilldown from the accounts explorer into stored balance assets
- preload explorer detail before closing the database so drilldown remains read-only and coherent
- collapse the stored-snapshot asset pane into one shared component instead of keeping a separate balance-owned implementation

Why this slice came next:

- static/detail `accounts` browse already covered stored balance inspection, but the TUI still stopped at summary detail
- `balance view` still owned the only asset drilldown path, which kept the read surface split in practice
- this is the smallest coherent slice that removes the remaining explorer-level duplication without yet deleting the whole balance browse shell

What landed:

- `accounts view` now has explicit `accounts` and `assets` modes plus `Enter` / `Backspace` drilldown behavior.
- TUI browse now preloads a detail index for all listed accounts before closing the database, so asset drilldown stays read-only.
- The accounts detail panel now uses the richer account detail model, including stored balance preview, unreadable snapshot hints, `Last calculated`, and requested-vs-scope rows.
- The stored-snapshot asset pane is now shared in [stored-balance-assets-view.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-assets-view.tsx) and reused by both `accounts view` and the remaining `balance` explorer.
- The old balance-only stored-snapshot formatter module was removed; stored-balance formatting is now shared.

## Verified Current Facts

- `accounts refresh` is the only CLI workflow entrypoint for rebuilding stored balances and verifying live data in [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts) and [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts).
- `balance` is now a browse-only namespace in [balance.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance.ts).
- The refresh execution engine still reuses balance workflow runtime/services from the balance feature, but no longer exposes a `balance refresh` command.
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

## Phase 5 Exit Criteria

- `accounts view` supports `Enter` drilldown into stored balance assets when stored balance data is readable.
- `accounts view` keeps the database-closed read-only model by preloading detail before Ink mounts.
- Stored snapshot asset rendering is shared instead of being implemented separately in `accounts` and `balance`.
- The accounts detail panel shows stored balance preview or unreadable snapshot messaging without needing a separate `balance` explorer.

Phase 5 result:

- all exit criteria met

## Likely Touchpoints

- [accounts-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/accounts-view-model.ts)
- [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts)
- [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts)
- [accounts-view-controller.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-controller.ts)
- [accounts-view-state.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-state.ts)
- [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx)
- [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts)
- [stored-balance-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-view.ts)
- [stored-balance-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-static-renderer.ts)
- [stored-balance-assets-view.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-assets-view.tsx)
- [stored-balance-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-formatters.ts)
- [balance-asset-details-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-asset-details-builder.ts)
- accounts browse tests under `apps/cli/src/features/accounts/**/__tests__/`

## Slice Notes

Constraints that shaped the implementation:

- keep the list query summary-shaped and preload detail separately for the explorer
- keep browse read-only; do not reopen the database from inside Ink just to load drilldown state
- share the stored-snapshot asset pane instead of copying balance's asset renderer into `accounts`

Post-slice reassessment notes:

- `accounts` now covers the main stored-balance inspection path across static, JSON, and TUI surfaces
- the remaining duplication is mostly the existence of the user-facing `balance` browse shell, not the stored-snapshot asset pane itself
- the next slice should decide how much of `apps/cli/src/features/balance/command` and `apps/cli/src/features/balance/view` can be deleted immediately now that `accounts` owns the canonical read surface

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-inspect the `accounts` and `balance` read surfaces as they exist after phase 4.
3. Pick the single best read-surface consolidation slice from current code, not from prior assumptions.

Likely next reassessment candidates:

- remove or hollow out the remaining CLI `balance` browse surface now that `accounts view` owns drilldown
- move any remaining stored-balance read helpers that still live under `apps/cli/src/features/balance/` into shared or accounts-owned locations
- re-check whether the remaining balance workflow support types should also move out of the CLI balance feature path

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
