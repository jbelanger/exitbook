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

### Phase 1: Add Root Static Browse Surfaces And Selector Contract

Status: `completed`

Intent:

- introduce bare `blockchains` static list output
- introduce `blockchains <selector>` static detail output
- make `blockchains view` and `blockchains view <selector>` fall back to those same static surfaces off-TTY
- establish blockchain key selector behavior and JSON parity

Why this slice comes first:

- current `blockchains` is still a `view`-only family
- selector semantics are the main contract decision; once that is stable, the renderer work is straightforward
- static browse/detail are the smallest coherent V3 slice and will make later explorer alignment much simpler

## Verified Current Facts

- `blockchains` now owns the root static list/detail browse surfaces in [blockchains.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains.ts).
- `blockchains view` now reuses the same browse command path as the bare root in [blockchains-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-view.ts) and [blockchains-browse-command.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-browse-command.ts).
- JSON now follows list/detail semantic parity for bare vs selector forms.
- the current TUI data model already has enough summary/detail data for both list and detail renderers in [blockchains-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/blockchains-view-model.ts).
- the catalog already has a natural selector candidate: the blockchain key in [blockchains-view-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-view-utils.ts).
- static browse rendering now lives in [blockchains-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-static-renderer.ts).
- `blockchains view <selector>` now preselects the requested chain on a TTY and falls back to static detail off-TTY.

## Phase 1 Exit Criteria

- `exitbook blockchains` renders a static list.
- `exitbook blockchains <selector>` renders a static detail card.
- `blockchains view` off-TTY matches `blockchains`.
- `blockchains view <selector>` off-TTY matches `blockchains <selector>`.
- JSON follows list/detail semantic parity for bare vs selector forms.

Phase 1 result:

- all exit criteria met

## Likely Touchpoints

- [blockchains.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains.ts)
- [blockchains-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-view.ts)
- [blockchains-view-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-view-utils.ts)
- [blockchains-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/blockchains-view-model.ts)
- [blockchains-command.test.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/__tests__/blockchains-command.test.ts)

## Slice Notes

Constraints that shape the implementation:

- selector semantics should stay exact and boring; blockchain key is enough
- avoid inventing a second data-loading path if the existing catalog builder can serve both list and detail
- static surfaces should be compact and useful in scrollback, not a text copy of the current TUI

Post-slice reassessment notes:

- the core V3 browse ladder is now established for `blockchains`
- the next slice should focus on explorer/detail alignment rather than more command-shape work

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `blockchains` spec.
2. Re-scan the shipped `blockchains` behavior for remaining spec drift.
3. Pick the single highest-value next slice instead of planning the whole family in advance.

Likely next reassessment candidates:

- align the explorer detail panel more closely with the new static detail card
- reduce remaining duplication between static and TUI formatting/helpers
- update broader trackers once the family is coherent enough to move from `in_progress` to `done`
