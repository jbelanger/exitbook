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

### Phase 2: Remove The Legacy `balance refresh` Workflow Alias

Status: `completed`

Intent:

- make `accounts refresh` the only refresh workflow command
- remove the remaining legacy `balance refresh` alias
- move refresh command support under `accounts`, where the workflow now belongs
- leave `balance` as a browse-only surface until read-surface consolidation is ready

Why this slice came next:

- the workflow boundary was already moved to `accounts refresh`
- keeping the alias was now pure surface debt, not a capability requirement
- the shared refresh helper was stranded under `balance` even though only `accounts` should own the workflow

What landed:

- `balance refresh` was removed.
- `accounts refresh` now owns its command support module directly.
- `balance` is now browse-only and exposes only root browse plus `balance view`.
- Refresh CLI tests now exercise `accounts refresh` directly instead of a legacy alias.
- Current canonical docs now describe `accounts refresh` as the rebuild-and-verify path for stored balances.

## Verified Current Facts

- `accounts refresh` is the only CLI workflow entrypoint for rebuilding stored balances and verifying live data in [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts) and [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts).
- `balance` is now a browse-only namespace in [balance.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance.ts).
- The refresh execution engine still reuses balance workflow runtime/services from the balance feature, but no longer exposes a `balance refresh` command.
- Stored balance freshness messaging and related read surfaces direct users to `exitbook accounts refresh`.
- `refresh` remains reserved as an account name.

## Phase 2 Exit Criteria

- `balance refresh` no longer exists in the command tree.
- `accounts refresh` remains fully tested for JSON and text workflow output.
- `balance` help and tests describe a browse-only surface.
- Refresh command support no longer lives under `apps/cli/src/features/balance/command/`.
- Current canonical docs no longer describe `balance refresh` as a live command.

Phase 2 result:

- all exit criteria met

## Likely Touchpoints

- [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts)
- [accounts-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh-command-support.ts)
- [accounts.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts.ts)
- [balance.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance.ts)
- refresh command tests under `apps/cli/src/features/accounts/command/__tests__/`
- balance browse tests under `apps/cli/src/features/balance/command/__tests__/`
- current CLI specs under `docs/specs/cli/`

## Slice Notes

Constraints that shaped the implementation:

- keep `balance` browse/view because `accounts` still does not absorb the stored-balance explorer yet
- remove only the workflow alias, not the still-distinct browse surface
- update canonical docs in the same slice so the live surface and spec remain aligned

Post-slice reassessment notes:

- the workflow boundary is now clean
- the remaining duplication is almost entirely in read surfaces and renderers
- the next slice should consolidate browse/detail behavior, not touch workflow naming again

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-inspect the `accounts` and `balance` read surfaces as they exist after phase 2.
3. Pick the single best read-surface consolidation slice from current code, not from prior assumptions.

Likely next reassessment candidates:

- add the `ASSETS` count to the static `accounts` list
- unify `accounts` static detail with stored balance detail
- reuse stored balance asset drilldown inside `accounts view`

Do not commit to one of these until the code is re-read and the best slice is confirmed again.

## Progress Log

| Slice                                                            | Status      | Notes                                                                                                                 |
| ---------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed. |
| Phase 1: `accounts refresh` as canonical workflow command        | `completed` | Added `accounts refresh`; refresh text is line-oriented progress; stale guidance now points to `accounts refresh`.    |
| Phase 2: remove legacy `balance refresh` alias                   | `completed` | Deleted `balance refresh`; moved refresh command support under `accounts`; `balance` is now browse-only.              |
