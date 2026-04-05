# Blockchains CLI Implementation Tracker

Tracks implementation progress for the `blockchains` family redesign defined in [Blockchains CLI Spec](/Users/joel/Dev/exitbook/docs/specs/cli/blockchains/blockchains-view-spec.md).

This is a working tracker, not a speculative roadmap. After each coherent slice lands, stop, re-read the code, and update this document from facts.

## Working Rules

- Only one active slice at a time.
- Prefer architectural clarity over local convenience.
- Reuse shared browse patterns where they genuinely fit; do not copy `accounts` structure mechanically.
- If something must be deferred, add a `TODO:` in code with a concrete follow-up, then re-assess it regularly.
- Every completed slice must leave the codebase coherent, documented, and validated with `pnpm lint`, `pnpm build`, and `pnpm test`.

## Current Slice

### Phase 3: Align Filtered Empty Explorer Messaging

Status: `completed`

Intent:

- make filtered-empty `blockchains view` use the same empty-state wording as the static browse surface
- remove the stale unfiltered registration-failure warning from filtered-empty explorer output
- keep empty-state wording in one shared helper so static and TUI cannot drift again

Why this slice came next:

- the explorer/detail content was already aligned
- filtered-empty explorer requests still had a misleading fallback message even though the spec keeps them on the explorer code path
- empty-state wording is small but user-facing enough to close before declaring the family done

## Verified Current Facts

- `blockchains` now owns the root static list/detail browse surfaces in [blockchains.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains.ts).
- `blockchains view` now reuses the same browse command path as the bare root in [blockchains-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-view.ts) and [blockchains-browse-command.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-browse-command.ts).
- JSON now follows list/detail semantic parity for bare vs selector forms.
- the current TUI data model already has enough summary/detail data for both list and detail renderers in [blockchains-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/blockchains-view-model.ts).
- the catalog already has a natural selector candidate: the blockchain key in [blockchains-view-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-view-utils.ts).
- static browse rendering now lives in [blockchains-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-static-renderer.ts).
- `blockchains view <selector>` now preselects the requested chain on a TTY and falls back to static detail off-TTY.
- the explorer detail panel now uses the same blockchain title semantics and body fields as the static detail card in [blockchains-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-view-components.tsx) and [blockchains-view-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-view-formatters.ts).
- the explorer detail panel no longer spends its fixed-height space on example command hints.
- static and TUI empty-state messaging now share the same helper in [blockchains-view-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-view-formatters.ts).
- filtered-empty `blockchains view` no longer falls back to the old "provider registration failed" message.

## Phase 3 Exit Criteria

- `blockchains view --requires-api-key` with no matches shows the same empty-state wording as static browse
- filtered-empty explorer output no longer claims provider registration failed
- static and TUI empty-state wording come from one shared helper

Phase 3 result:

- all exit criteria met

## Likely Touchpoints

- [blockchains-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-view-components.tsx)
- [blockchains-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-static-renderer.ts)
- [blockchains-view-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-view-formatters.ts)
- [blockchains-view-components.test.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/__tests__/blockchains-view-components.test.tsx)
- [blockchains-static-renderer.test.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/__tests__/blockchains-static-renderer.test.ts)

## Slice Notes

Constraints that shape the implementation:

- do not let the TUI empty state invent separate wording for filter cases
- keep the unfiltered empty fallback boring because that path should normally collapse to static before the explorer mounts
- prefer a shared formatter over renderer-local conditionals

Post-slice reassessment notes:

- the remaining work should now be either naming cleanup or family-finalization docs
- there are no known user-facing browse-shape mismatches left in the blockchains surface

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `blockchains` spec.
2. Re-scan the shipped `blockchains` behavior for remaining spec drift.
3. Pick the single highest-value next slice instead of planning the whole family in advance.

Likely next reassessment candidates:

- reduce remaining naming drift such as `blockchains-view-utils.ts` now owning browse/catalog logic
- update broader trackers once the family is coherent enough to move from `in_progress` to `done`
- remove the temporary blockchains implementation tracker once the family is formally marked complete
