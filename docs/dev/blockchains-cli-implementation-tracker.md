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

### Phase 2: Align Explorer Detail With The Static Detail Card

Status: `completed`

Intent:

- align `blockchains view` detail content with the new static detail surface
- remove the old example-command hint block from the explorer detail panel
- share the core detail title/body field semantics across static and TUI renderers

Why this slice came next:

- the root browse ladder was already stable
- the main remaining product drift was inside the explorer detail panel
- detail alignment is a self-contained renderer slice that improves the surface without reopening selector or command-shape decisions

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

## Phase 2 Exit Criteria

- explorer detail title uses the same `display name + key + category + layer` semantics as static detail
- explorer detail body shows the same core fields: providers, API keys, example address
- provider detail remains in the explorer panel and may truncate via fixed-height overflow
- example-command hint lines are removed from the explorer detail panel

Phase 2 result:

- all exit criteria met

## Likely Touchpoints

- [blockchains-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-view-components.tsx)
- [blockchains-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-static-renderer.ts)
- [blockchains-view-formatters.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/blockchains-view-formatters.ts)
- [blockchains-view-components.test.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/view/__tests__/blockchains-view-components.test.tsx)

## Slice Notes

Constraints that shape the implementation:

- do not fork the detail vocabulary between static and TUI renderers
- keep the explorer panel compact enough that the list remains usable on a normal terminal
- reuse shared formatters where that reduces drift without forcing identical rendering primitives

Post-slice reassessment notes:

- the explorer/detail drift is now much smaller
- the next reassessment should focus on any remaining filtered-empty or help/spec mismatches before declaring the family complete

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `blockchains` spec.
2. Re-scan the shipped `blockchains` behavior for remaining spec drift.
3. Pick the single highest-value next slice instead of planning the whole family in advance.

Likely next reassessment candidates:

- align filtered-empty explorer messaging with the static browse surface
- reduce remaining naming drift such as `blockchains-view-utils.ts` now owning browse/catalog logic
- update broader trackers once the family is coherent enough to move from `in_progress` to `done`
