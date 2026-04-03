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

### Phase 4: Add Full Stored Balance Detail To `accounts` Static/JSON Detail

Status: `completed`

Intent:

- add asset-level stored balance detail to `accounts <selector>` and `accounts view <selector> --json`
- keep browse read-only by loading stored snapshots without auto-rebuilds
- introduce a dedicated `accounts` detail model instead of bloating the list item
- remove obvious static-detail gaps such as capped child/session rows and missing `Last calculated`

Why this slice came next:

- `accounts` list now carried summary-level balance signals, but detail still stopped short of the actual stored snapshot data
- the spec requires asset rows, last verified live values, scope resolution, and unreadable snapshot hints on detail
- this is the smallest slice that materially moves stored-balance inspection out of the `balance` CLI surface

What landed:

- `accounts` detail now loads a dedicated stored-balance payload with scope resolution, readable vs unreadable states, and asset rows.
- Static `accounts` detail now renders `Last calculated`, optional `Requested` / `Balance scope`, the full balance asset table, and uncapped child/session rows.
- Detail JSON now includes the richer nested `balance` object while list JSON stays summary-shaped.
- Stored snapshot asset rows now carry stored `liveBalance` and `comparisonStatus`, not just calculated balance and diagnostics.
- Shared static asset-table rendering now lives outside the `balance` feature so both `accounts` and `balance` can reuse it.

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

## Phase 4 Exit Criteria

- `accounts` static detail renders asset-level stored balance data when snapshots are readable.
- `accounts` detail JSON exposes a nested stored-balance object while list JSON remains summary-shaped.
- Unreadable stored snapshots render a concrete reason plus refresh hint instead of failing the whole detail surface.
- The stored-balance asset rendering path is shared rather than reimplemented in both features.

Phase 4 result:

- all exit criteria met

## Likely Touchpoints

- [accounts-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/accounts-view-model.ts)
- [accounts-detail-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-detail-support.ts)
- [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts)
- [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts)
- [stored-balance-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-view.ts)
- [stored-balance-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-static-renderer.ts)
- [balance-asset-details-builder.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-asset-details-builder.ts)
- accounts browse tests under `apps/cli/src/features/accounts/**/__tests__/`

## Slice Notes

Constraints that shaped the implementation:

- keep the list query summary-shaped and move detail loading into a separate detail-only path
- keep browse read-only; do not reuse balance's auto-rebuild-on-read semantics
- share the asset table renderer instead of copying it into `accounts`

Post-slice reassessment notes:

- `accounts` now covers static/detail JSON balance inspection much more completely
- the main remaining duplication is explorer state and the remaining `balance` browse shell
- the next slice should target `accounts view` drilldown and then re-evaluate how much CLI `balance` can be deleted immediately

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-inspect the `accounts` and `balance` read surfaces as they exist after phase 4.
3. Pick the single best read-surface consolidation slice from current code, not from prior assumptions.

Likely next reassessment candidates:

- reuse stored balance asset drilldown inside `accounts view`
- remove or hollow out the remaining CLI `balance` browse surface once `accounts view` covers the same inspection path
- collapse any remaining stored-balance read helpers that still live under `apps/cli/src/features/balance/`

Do not commit to one of these until the code is re-read and the best slice is confirmed again.

## Progress Log

| Slice                                                            | Status      | Notes                                                                                                                 |
| ---------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed. |
| Phase 1: `accounts refresh` as canonical workflow command        | `completed` | Added `accounts refresh`; refresh text is line-oriented progress; stale guidance now points to `accounts refresh`.    |
| Phase 2: remove legacy `balance refresh` alias                   | `completed` | Deleted `balance refresh`; moved refresh command support under `accounts`; `balance` is now browse-only.              |
| Phase 3: add stored balance summary to `accounts` browse         | `completed` | Added `ASSETS` to static list and a summary-level `Balances` section to static/detail/JSON browse surfaces.           |
| Phase 4: add full stored balance detail to `accounts` detail     | `completed` | Added nested detail balance data, full asset tables, unreadable snapshot hints, and shared stored-balance rendering.  |
