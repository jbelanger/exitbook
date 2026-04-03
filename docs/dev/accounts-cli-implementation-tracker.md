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

### Phase 1: `accounts refresh` As The Canonical Workflow Command

Status: `completed`

Intent:

- make `accounts refresh` the primary balance refresh workflow surface
- keep `balance refresh` only as a compatibility alias
- switch refresh text output to line-oriented workflow progress instead of workflow TUI rendering
- retarget stale snapshot guidance and help text toward `accounts refresh`
- reserve `refresh` as an account name so the command surface stays unambiguous

Why this slice came next:

- the credential ownership boundary was already corrected in phase 0
- refresh is the cleanest workflow boundary to move first without forcing browse-surface consolidation
- V3 workflow guidance fits line-oriented progress better than explorer-style workflow UI

What landed:

- `accounts refresh` now exists as a first-class command.
- `balance refresh` now delegates to the same shared refresh executor as a compatibility alias.
- Text refresh output now reports line-oriented progress and completion summaries for both single-account and all-account runs.
- Browse/detail guidance now points users to `exitbook accounts refresh` when stored balances are missing or stale.
- `refresh` is now treated as a reserved account name.

## Verified Current Facts

- `accounts` now owns the canonical refresh workflow entrypoint in [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts).
- `balance refresh` still exists, but only as a compatibility alias over the shared executor in [balance-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-refresh.ts) and [balance-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-refresh-command-support.ts).
- Refresh JSON output still uses the existing structured response contract, while text mode now uses line-oriented workflow progress instead of rendering the workflow app.
- Stored balance freshness guidance now points to `exitbook accounts refresh` in [balance-snapshot-freshness-message.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/balance-snapshot-freshness-message.ts).
- `refresh` is reserved alongside other account subcommands in [account-lifecycle-service.ts](/Users/joel/Dev/exitbook/packages/accounts/src/accounts/account-lifecycle-service.ts).

## Phase 1 Exit Criteria

- `accounts refresh` exists as a documented, tested command.
- `balance refresh` delegates to shared refresh execution instead of owning a separate workflow implementation.
- Text refresh mode no longer depends on the workflow TUI shell.
- CLI help text and freshness messaging prefer `accounts refresh`.
- Account naming rules reserve `refresh`.
- Tests cover the new command registration path and the line-oriented refresh text flow.

Phase 1 result:

- all exit criteria met

## Likely Touchpoints

- [accounts.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts.ts)
- [accounts-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-refresh.ts)
- [balance.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance.ts)
- [balance-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-refresh.ts)
- [balance-refresh-command-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-refresh-command-support.ts)
- [run-balance.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/run-balance.ts)
- [balance-snapshot-freshness-message.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/balance-snapshot-freshness-message.ts)
- refresh command tests under `apps/cli/src/features/accounts/command/__tests__/` and `apps/cli/src/features/balance/command/__tests__/`
- account lifecycle rules in `packages/accounts/src/accounts/`

## Slice Notes

Constraints that shaped the implementation:

- keep the existing refresh execution engine rather than duplicating workflow logic under `accounts`
- preserve the current JSON contract while changing only the text workflow presentation
- keep `balance refresh` operational so existing scripts do not break during surface consolidation

Post-slice reassessment notes:

- the workflow boundary is now cleaner, but browse/detail duplication between `accounts` and `balance` still exists
- `balance` still owns the richer stored-balance asset drilldown components that `accounts view` does not yet reuse
- the next slice should improve the read surface, not add more workflow variants

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `accounts` spec.
2. Re-inspect both `accounts` and `balance` read surfaces as they exist after phase 1.
3. Pick the single best read-surface consolidation slice from current code, not from prior assumptions.

Likely next reassessment candidates:

- add the `ASSETS` count to the static `accounts` list
- unify `accounts` static detail with stored balance detail
- reuse stored balance asset drilldown inside `accounts view`

Do not commit to one of these until the code is re-read and the best slice is confirmed again.

## Progress Log

| Slice                                                            | Status      | Notes                                                                                                                                                           |
| ---------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed.                                           |
| Phase 1: `accounts refresh` as canonical workflow command        | `completed` | Added `accounts refresh`; `balance refresh` now delegates as an alias; text refresh is line-oriented progress; stale guidance now points to `accounts refresh`. |
