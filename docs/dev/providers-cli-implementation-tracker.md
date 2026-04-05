# Providers CLI Implementation Tracker

Tracks implementation progress for the `providers` family redesign defined in [Providers CLI Spec](/Users/joel/Dev/exitbook/docs/specs/cli/providers/providers-view-spec.md).

This is a working tracker, not a speculative roadmap. After each coherent slice lands, stop, re-read the code, and update this document from facts.

## Working Rules

- Only one active slice at a time.
- Prefer architectural clarity over local convenience.
- Reuse the shared browse-ladder wiring where it genuinely fits; do not fork a provider-specific variant unless the family shape truly requires it.
- If something must be deferred, add a `TODO:` in code with a concrete follow-up, then re-assess it regularly.
- Every completed slice must leave the codebase coherent, documented, and validated with `pnpm lint`, `pnpm build`, and `pnpm test`.

## Current Slice

### Phase 2: Align Explorer Detail With The New Browse Contract

Status: `in_progress`

Intent:

- align the explorer detail panel with the new static detail card
- close any remaining detail/empty-state drift between `providers` and `providers view`
- keep `providers benchmark` unchanged while the browse family settles

Why this slice is next:

- phase 1 established the root browse ladder and selector contract
- the main remaining V3 risk is explorer/detail inconsistency, not command-shape ambiguity
- once explorer/detail semantics match, the family should be close to complete

## Verified Current Facts

- `providers` now supports bare static list/detail plus `view` and `benchmark` in [providers.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers.ts).
- `providers benchmark` is a separate workflow command and should stay that way in [providers-benchmark.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers-benchmark.ts).
- provider-name selectors are now explicit, exact, and case-insensitive in [providers-browse-command.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers-browse-command.ts).
- root static list/detail rendering lives in [providers-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/view/providers-static-renderer.ts).
- the existing provider loader already returns summary and detail data in [providers-view-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers-view-handler.ts).
- the current TUI data model already contains enough aggregate and per-blockchain detail to power both static and explorer surfaces in [providers-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/providers-view-model.ts).

## Phase 1 Result

- `exitbook providers` renders a static list.
- `exitbook providers <selector>` renders a static detail card.
- `providers view` off-TTY matches `providers`.
- `providers view <selector>` off-TTY matches `providers <selector>`.
- JSON follows list/detail semantic parity for bare vs selector forms.

## Phase 2 Exit Criteria

- explorer detail uses the same underlying fields and wording as static detail
- selector preselection and off-TTY fallback still behave correctly after the detail alignment
- empty and filtered-empty states remain coherent across static and TUI surfaces

## Likely Touchpoints

- [providers.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers.ts)
- [providers-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers-view.ts)
- [providers-view-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers-view-handler.ts)
- [providers-view-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/command/providers-view-utils.ts)
- [providers-view-state.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/providers/view/providers-view-state.ts)

## Slice Notes

Constraints that shape the implementation:

- keep `providers benchmark` untouched in this slice
- avoid inventing a second provider-loading path if the existing handler can serve both list and detail
- reuse shared provider wording/helpers rather than duplicating static and TUI-only copy

## Reassessment Gate

Before starting the next slice:

1. Re-read the current `providers` spec.
2. Re-scan the shipped `providers` behavior for remaining spec drift.
3. Pick the single highest-value next slice instead of planning the whole family in advance.
