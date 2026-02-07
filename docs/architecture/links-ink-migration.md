# Links Command: @clack/prompts to Ink Migration

**Date:** 2026-02-07
**Status:** Complete
**Scope:** Links command only (other commands to be rewritten later)

## Summary

Migrated the links command from using @clack/prompts to pure Ink for interactive prompts, consolidating on a single UI framework for consistency and better keyboard handling.

## Changes Made

### 1. New Ink Form Components

Created three new reusable Ink components in `apps/cli/src/ui/shared/`:

#### `ConfirmPrompt.tsx`

- Yes/No confirmation prompts
- Keyboard navigation: Y/N, arrow keys, Enter to submit, Esc to cancel
- Visual indicators for selected option

#### `TextPrompt.tsx`

- Text input with validation
- Real-time validation feedback
- Placeholder support with default values
- Backspace/delete handling
- Enter to submit, Esc to cancel

#### `PromptFlow.tsx`

- Orchestrates sequential prompt flows
- Manages state between prompt steps
- Handles completion and cancellation
- Title display support

### 2. Updated Links Run Command

**File:** `apps/cli/src/features/links/links-run.ts`

**Changes:**

- **Removed `@clack/prompts` entirely** - No more clacks UI elements
- **Removed `OutputManager`** - No more clacks spinner, intro, or outro
- Removed dependency on shared `prompts.ts` utilities (`isCancelled`, `handleCancellation`, `promptConfirm`)
- Rewrote `promptForLinksRunParams()` to use Ink `PromptFlow`
- Returns `null` on cancellation instead of using `process.exit()` in prompt layer
- Validates auto-confirm threshold >= min-confidence after all inputs collected
- Direct logger configuration instead of spinner-based logging
- JSON output via `createSuccessResponse()` utility instead of OutputManager
- Integrated 4-step prompt flow:
  1. Dry-run mode confirmation
  2. Minimum confidence score (text with validation)
  3. Auto-confirm threshold (text with validation)
  4. Final confirmation to proceed

### 3. Tests

Added component tests in `apps/cli/src/ui/shared/__tests__/`:

- `ConfirmPrompt.test.tsx` - 3 rendering tests
- `TextPrompt.test.tsx` - 3 rendering tests

**Note:** Interactive keyboard tests skipped due to `ink-testing-library` limitations with async state updates. Components tested through manual usage and integration.

### 4. Exports

Updated `apps/cli/src/ui/shared/index.ts` to export new components:

- `ConfirmPrompt` + `ConfirmPromptProps`
- `TextPrompt` + `TextPromptProps`
- `PromptFlow` + `PromptStep`

## Benefits

### Consistency

- **100% Ink** - Single UI framework for prompts, TUI, and output
- No more dual UI paradigm (@clack/prompts vs Ink)
- Uniform styling and keyboard handling throughout
- One testing strategy (`ink-testing-library`)

### Better UX

- Full keyboard control over prompts
- Consistent visual design with TUI commands
- Better integration with links view/gaps mode
- Clean output without clacks decorations

### Maintainability

- Reusable prompt components for future commands
- Clean separation: form components vs business logic
- Type-safe prompt flow orchestration
- Simpler code: removed OutputManager abstraction layer

## What's NOT Changed

The following still use @clack/prompts (will be rewritten later):

- `apps/cli/src/features/prices/prices-prompts.ts` (239 lines)
- `apps/cli/src/features/export/export-prompts.ts` (126 lines)
- `apps/cli/src/features/cost-basis/cost-basis-prompts.ts` (201 lines)
- `apps/cli/src/features/shared/prompts.ts` (256 lines) - shared utilities

**Total remaining:** ~822 lines of @clack/prompts code

## Dependencies

### Still Required

- `@clack/prompts` - Used by prices, export, cost-basis commands
- `ink` - Main TUI framework
- `ink-testing-library` - Test utilities
- `react` - Required by Ink

### Can Be Removed Later

Once all commands are rewritten, `@clack/prompts` can be removed entirely.

## Testing

```bash
# Run all CLI tests
pnpm --filter exitbook-cli test

# Run prompt component tests
pnpm --filter exitbook-cli test -- src/ui/shared/__tests__/

# Build verification
pnpm --filter exitbook-cli build
```

## Manual Testing

To test the new prompts interactively:

```bash
# Run links command without flags to trigger prompts
pnpm run dev links run

# Expected flow:
# 1. "Run in dry-run mode?" - Y/N navigation
# 2. "Minimum confidence score" - text input with validation
# 3. "Auto-confirm threshold" - text input with validation
# 4. "Start transaction linking?" - Y/N navigation

# Test cancellation at any step with Esc or Ctrl+C
```

## Architecture Notes

### Component Design

- **Stateless where possible**: Components manage only UI state
- **Validation in components**: Form validation logic lives in prompt components
- **Business logic separated**: Command files handle business validation (e.g., auto-confirm >= min-confidence)

### State Management

- Local `useState` for prompt values
- `useInput` for keyboard handling
- Sequential state via `PromptFlow` orchestrator

### Error Handling

- Validation errors shown inline (red text)
- Cancellation returns `null` (not throwing or process.exit)
- Business logic errors handled at command level

## Future Work

### Phase 2 (Later)

- Migrate prices prompts to Ink
- Migrate export prompts to Ink
- Migrate cost-basis prompts to Ink
- Migrate shared prompts utilities to Ink
- Remove `@clack/prompts` dependency

### Potential Enhancements

- `SelectPrompt` component (for exchange/blockchain selection)
- `MultiTextPrompt` (form with multiple fields)
- Better accessibility (screen reader support)
- Custom themes/styling support

## References

- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [Ink Testing Library](https://github.com/vadimdemedes/ink-testing-library)
- Original discussion: GitHub issue or PR link (if applicable)
