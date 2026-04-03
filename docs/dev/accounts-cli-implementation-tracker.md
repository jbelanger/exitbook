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

### Phase 3: Start Folding Stored Balance Summaries Into `accounts` Browse

Status: `completed`

Intent:

- add stored asset count to the static `accounts` list
- expose a minimal stored balance summary on `accounts` static detail
- thread the same summary fields through the `accounts` JSON/view model
- keep this slice summary-shaped and read-only rather than partially porting the balance explorer

Why this slice came next:

- the workflow boundary is already clean; the remaining duplication is in read surfaces
- the static `accounts` list/detail was still too thin relative to the new spec
- this is the smallest coherent read-surface slice that improves `accounts` without duplicating the balance explorer

What landed:

- The static `accounts` list now includes an `ASSETS` column backed by stored snapshot asset count.
- Static `accounts` detail now includes a `Balances` section with stored asset count and any stored status/suggestion summary.
- The `accounts` browse JSON payload and TUI/view model now carry stored asset count and stored status/suggestion fields.
- Accounts browse tests now assert the new stored-balance summary shape explicitly.

## Verified Current Facts

- `accounts refresh` is the only CLI workflow entrypoint for rebuilding stored balances and verifying live data in [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts) and [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts).
- `balance` is now a browse-only namespace in [balance.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance.ts).
- The refresh execution engine still reuses balance workflow runtime/services from the balance feature, but no longer exposes a `balance refresh` command.
- Stored balance freshness messaging and related read surfaces direct users to `exitbook accounts refresh`.
- `refresh` remains reserved as an account name.
- `accounts` list rows now show stored asset count when the stored snapshot is readable in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts).
- `accounts` detail now shows a summary-level `Balances` section, but not full per-asset stored balance detail yet, in [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts).
- The `accounts` projection/model layer now includes stored asset count plus stored status/suggestion summary in [account-query-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/query/account-query-utils.ts), [account-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/account-view-projection.ts), and [accounts-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/accounts-view-model.ts).

## Phase 3 Exit Criteria

- Static `accounts` list exposes stored asset count without inventing a second implementation path.
- Static `accounts` detail exposes a stored balance summary section.
- `accounts` JSON/detail projections carry the same stored-balance summary fields used by the renderer.
- The slice lands without touching workflow ownership or introducing a second balance-summary model.

Phase 3 result:

- all exit criteria met

## Likely Touchpoints

- [account-query-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/query/account-query-utils.ts)
- [account-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/account-view-projection.ts)
- [accounts-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/accounts-view-model.ts)
- [accounts-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-static-renderer.ts)
- accounts browse tests under `apps/cli/src/features/accounts/**/__tests__/`

## Slice Notes

Constraints that shaped the implementation:

- keep the slice summary-shaped; do not half-port the balance asset explorer into `accounts`
- reuse the existing `accounts` query/projection path instead of creating an alternate balance-summary adapter
- leave the deeper stored-balance drilldown and renderer consolidation for a later reassessment

Post-slice reassessment notes:

- `accounts` is now a better top-level read surface, but it still does not absorb full stored balance detail
- the main remaining duplication is asset-level detail and explorer state, not workflow commands
- the next slice should either add stored asset detail to `accounts` static/JSON detail or move the balance explorer drilldown under `accounts`

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-inspect the `accounts` and `balance` read surfaces as they exist after phase 3.
3. Pick the single best read-surface consolidation slice from current code, not from prior assumptions.

Likely next reassessment candidates:

- add full stored balance detail to static `accounts` detail and JSON
- reuse stored balance asset drilldown inside `accounts view`
- remove or hollow out the remaining CLI `balance` browse surface once `accounts` truly covers it

Do not commit to one of these until the code is re-read and the best slice is confirmed again.

## Progress Log

| Slice                                                            | Status      | Notes                                                                                                                 |
| ---------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed. |
| Phase 1: `accounts refresh` as canonical workflow command        | `completed` | Added `accounts refresh`; refresh text is line-oriented progress; stale guidance now points to `accounts refresh`.    |
| Phase 2: remove legacy `balance refresh` alias                   | `completed` | Deleted `balance refresh`; moved refresh command support under `accounts`; `balance` is now browse-only.              |
| Phase 3: add stored balance summary to `accounts` browse         | `completed` | Added `ASSETS` to static list and a summary-level `Balances` section to static/detail/JSON browse surfaces.           |
