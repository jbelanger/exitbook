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

### Phase 8: Align Stored-Live Labels In Browse TUI

Status: `completed`

Intent:

- align the remaining browse TUI wording with the accounts spec for stored snapshot balances
- remove ambiguous `live` labels from read-only browse surfaces so users do not infer current provider data
- lock the behavior with renderer-level tests

Why this slice came next:

- the ownership cleanup is done, so the next remaining work should be behavior/spec alignment
- the accounts spec explicitly says stored snapshot values must be labeled `last verified live`
- the static surface already matched, but the TUI preview and drilldown still used the ambiguous label `live`

What landed:

- The accounts detail preview row now labels stored snapshot values as `last verified live`.
- The shared stored-balance asset drilldown rows now use the same `last verified live` label.
- Renderer tests now cover both the account detail preview and the drilled-down asset view wording.

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
- The TUI preview in [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx) now matches the browse wording already used by the static table and the asset diagnostics panel.
- The shared drilled-down asset view in [stored-balance-assets-view.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-assets-view.tsx) now uses the same label, so browse semantics are consistent across static, preview, and drilldown surfaces.

## Phase 8 Exit Criteria

- Browse TUI surfaces do not label stored snapshot amounts as plain `live`.
- The account detail preview and asset drilldown both use `last verified live`.
- Renderer tests cover the wording so the drift is harder to reintroduce.

Phase 8 result:

- all exit criteria met

## Likely Touchpoints

- [cli.ts](/Users/joel/Dev/exitbook/apps/cli/src/cli.ts)
- [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts)
- [accounts-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/accounts-view-components.tsx)
- [stored-balance-assets-view.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-assets-view.tsx)
- [accounts-view-components.test.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/view/__tests__/accounts-view-components.test.tsx)
- current-facing CLI docs under `docs/specs/cli/`

## Slice Notes

Constraints that shaped the implementation:

- keep the slice strictly behavioral after the ownership cleanup
- reuse the existing stored-balance wording instead of inventing new terminology
- add tests at the renderer boundary where the drift actually showed up

Post-slice reassessment notes:

- stored snapshot wording is now aligned across the main browse surfaces
- the next slice should look for a different class of behavior drift, not more label churn

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
| Phase 8: align stored-live labels in browse TUI                  | `completed` | Updated the accounts preview and drilled-down asset rows to say `last verified live` and added renderer coverage.     |
