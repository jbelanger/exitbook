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

### Phase 7: Remove The Final Internal CLI `balance` Namespace

Status: `completed`

Intent:

- move the remaining internal refresh/detail helpers out of `apps/cli/src/features/balance/`
- align module ownership with the shipped `accounts` command surface instead of keeping a ghost feature folder
- delete the final CLI `balance` directory once no live imports remain

Why this slice came next:

- phase 6 removed the user-facing `balance` surface, but the CLI still depended on balance-owned internal modules
- keeping those files under `/features/balance/` obscured the true command boundary and made future regressions easier to miss
- this is the last slice needed to make the CLI code match the command surface cleanly

What landed:

- Refresh workflow scope, runner, and entry helpers now live under `apps/cli/src/features/accounts/command/`.
- Stored balance diagnostics and stored asset detail helpers now live under `apps/cli/src/features/shared/`.
- The final internal CLI `apps/cli/src/features/balance/` directory is gone.

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
- CLI account detail now uses [account-balance-detail-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/account-balance-detail-builder.ts) plus shared stored-balance helpers instead of importing through `/features/balance/`.
- `accounts refresh` now owns its internal workflow support in [accounts-refresh-scope.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-scope.ts), [accounts-refresh-runner.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-runner.ts), [run-accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/run-accounts-refresh.ts), and [accounts-refresh-types.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-types.ts).
- Shared stored-balance sorting and diagnostics helpers now live in [stored-balance-detail-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-detail-utils.ts) and [stored-balance-diagnostics.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-diagnostics.ts).

## Phase 7 Exit Criteria

- No live imports in `apps/cli/src` point at `apps/cli/src/features/balance/`.
- The remaining refresh/detail helpers live under `accounts` or `shared` according to actual ownership.
- The CLI `apps/cli/src/features/balance/` directory is deleted.

Phase 7 result:

- all exit criteria met

## Likely Touchpoints

- [cli.ts](/Users/joel/Dev/exitbook/apps/cli/src/cli.ts)
- [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts)
- [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts)
- [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts)
- [accounts-refresh-scope.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-scope.ts)
- [accounts-refresh-runner.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-runner.ts)
- [account-balance-detail-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/account-balance-detail-builder.ts)
- [stored-balance-detail-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-detail-utils.ts)
- [stored-balance-diagnostics.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-diagnostics.ts)
- current-facing CLI docs under `docs/specs/cli/`

## Slice Notes

Constraints that shaped the implementation:

- move ownership rather than leave compatibility wrappers behind
- keep shared stored-balance helpers genuinely shared instead of re-nesting them under `accounts`
- delete the old feature directory in the same slice so ownership cannot drift back silently

Post-slice reassessment notes:

- the CLI `balance` feature directory is gone
- the remaining work is no longer about command ownership; it should be driven by behavior, UX polish, or cross-surface spec drift only

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-scan the shipped `accounts` behavior for remaining spec drift or awkward UX.
3. Pick the single highest-value behavioral slice, not another ownership-only cleanup.

Likely next reassessment candidates:

- tighten any remaining spec drift around stored-live semantics or explorer behavior
- simplify newly moved account refresh/detail modules if any names or helper boundaries still feel awkward
- update broader trackers/spec references only where the shipped code now justifies it

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
| Phase 7: remove final internal CLI `balance` namespace           | `completed` | Moved remaining refresh/detail support under `accounts` and `shared`, then deleted the CLI `balance` feature folder.  |
