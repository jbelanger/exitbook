# Accounts CLI Implementation Tracker

Tracks implementation progress for the `accounts` family redesign defined in [Accounts CLI Spec](/Users/joel/Dev/exitbook/docs/specs/cli/accounts/accounts-view-spec.md).

This is not a full roadmap. It is a working tracker for the current best next slice. After each meaningful implementation step, stop, re-analyze the codebase, and update this document before committing to the next slice.

## Working Rules

- Only one active slice at a time.
- Prefer architectural clarity over local convenience.
- Do not preserve obsolete command boundaries or helper shapes just to minimize diffs.
- If something must be deferred, add a `TODO:` in code with a concrete follow-up, then re-assess it regularly.
- Do not carry speculative future work here unless it is the immediate next reassessment candidate.
- Every completed slice must leave the codebase in a coherent state with tests and help text aligned.

## Current Slice

### Phase 0: Account-Owned Provider Credentials And Refresh Boundary

Status: `completed`

Intent:

- provider credentials belong to account configuration
- refresh commands must stop accepting credential override flags
- refresh logic must resolve credentials only from stored account data
- account data model and docs must stop implying credentials are exclusive to `exchange-api` accounts

Why this is first:

- it removes a cross-cutting ownership smell before command consolidation starts
- it reduces the risk of building `accounts refresh` on top of the wrong credential boundary
- it narrows later work by making refresh a pure workflow over stored account configuration

What landed:

- `accounts add` and `accounts update` now allow stored provider credentials on `exchange-csv` accounts.
- `balance refresh` no longer accepts `--api-key`, `--api-secret`, or `--api-passphrase`.
- Refresh credential resolution no longer falls back to environment variables.
- Single-account and all-account refresh both resolve credentials from the stored account record.
- The CLI-only override helper module was removed.

## Verified Current Facts

- Browse and workflow responsibilities are split across `accounts` and `balance`, but refresh currently still owns credential override handling in [balance-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-refresh.ts).
- `accounts add` and `accounts update` already own the CLI surface for writing credentials in [accounts-option-schemas.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-option-schemas.ts) and [account-draft-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/account-draft-utils.ts).
- Core and data-layer comments still describe `credentials` as exchange-API-only in [account.ts](/Users/joel/Dev/exitbook/packages/core/src/account/account.ts), [001_initial_schema.ts](/Users/joel/Dev/exitbook/packages/data/src/migrations/001_initial_schema.ts), and [database-schema.ts](/Users/joel/Dev/exitbook/packages/data/src/database-schema.ts).
- Balance refresh still accepts `--api-key`, `--api-secret`, and `--api-passphrase`, and passes built credentials into refresh execution in [balance-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-refresh.ts).
- Balance verification runners already support stored per-account credential resolution for all-account refresh in [balance-verification-runner.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-verification-runner.ts).

## Phase 0 Exit Criteria

- `balance refresh` no longer accepts credential override flags.
- Single-account refresh resolves credentials only from the stored account record.
- All-account refresh keeps using stored per-account credential resolution.
- Domain comments, schema comments, and help text no longer claim credentials are exchange-API-only.
- CSV-backed exchange accounts remain valid places to store provider credentials for verification.
- Tests cover stored-credential refresh behavior without CLI credential overrides.
- Any residual mismatch that cannot be removed immediately is called out with a concrete `TODO:` in code.

Phase 0 result:

- all exit criteria met

## Likely Touchpoints

- [account.ts](/Users/joel/Dev/exitbook/packages/core/src/account/account.ts)
- [001_initial_schema.ts](/Users/joel/Dev/exitbook/packages/data/src/migrations/001_initial_schema.ts)
- [database-schema.ts](/Users/joel/Dev/exitbook/packages/data/src/database-schema.ts)
- [accounts-option-schemas.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-option-schemas.ts)
- [account-draft-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/account-draft-utils.ts)
- [accounts-update.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-update.ts)
- [balance-refresh.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-refresh.ts)
- [balance-option-schemas.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-option-schemas.ts)
- [balance-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/balance/command/balance-utils.ts)
- balance refresh command tests under `apps/cli/src/features/balance/command/__tests__/`
- account lifecycle and draft tests under `apps/cli/src/features/accounts/command/__tests__/`

## Slice Notes

Constraints:

- Keep refresh behavior correct for both single-account and all-account flows.
- Do not introduce a compatibility layer that silently falls back to env-based overrides.
- If naming changes are required, prefer a clean rename over adding parallel terms.

Open design point to resolve during implementation:

- whether `credentials` should be renamed now to something broader such as `providerCredentials`, or whether phase 0 should only fix ownership semantics and defer renaming to a later reassessment

Post-slice reassessment notes:

- The ownership boundary is now correct enough to evaluate command consolidation from a clean base.
- `balance refresh` still exists as the workflow entrypoint, but it now behaves like a pure workflow over stored account config rather than a credential-taking special case.
- The `credentials` field name is now semantically broader than its old comment/docs, but the name itself may still be too generic.

## Reassessment Gate

When phase 0 is complete:

1. Re-read the current `accounts` spec.
2. Re-inspect the command boundaries in code.
3. Decide the next single best slice based on the code as it exists then, not on assumptions made today.

Likely next reassessment candidates:

- introduce `accounts refresh` as the canonical workflow command
- add the `ASSETS` count to `accounts` static list output
- unify account detail with stored balance detail
- reuse balance asset drilldown inside `accounts view`

Do not commit to one of these until phase 0 lands and the codebase is re-evaluated.

## Progress Log

| Slice                                                            | Status      | Notes                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: account-owned provider credentials and refresh boundary | `completed` | CSV accounts can store provider credentials; refresh uses stored account credentials only; CLI/env overrides removed; validated with focused tests and `pnpm build` |
