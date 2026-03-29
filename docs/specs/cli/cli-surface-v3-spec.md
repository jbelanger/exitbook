---
last_verified: 2026-03-29
status: draft
supersedes: cli-surface-v2-spec.md
---

# CLI Surface V3 Specification

> Code is law: if this document disagrees with implementation, the implementation is correct and this spec must be updated.

This spec defines the next surface model for the Exitbook CLI. It replaces the V2 draft's generic `--text` / `--tui` override model with a command-shape model:

- command shape chooses the human surface
- terminal readiness decides whether an explorer can mount Ink
- `--json` remains the only generic output override
- command-specific flags such as `--interactive` may still exist, but they control prompting or execution behavior, not presentation selection

## Quick Reference

| Shape                          | Human output                             | TTY required |
| ------------------------------ | ---------------------------------------- | ------------ |
| `accounts`                     | static list/table                        | no           |
| `accounts <name>`              | static detail card                       | no           |
| `accounts view`                | TUI explorer/master-detail               | yes          |
| `accounts view <name>`         | TUI explorer pre-selected on `<name>`    | yes          |
| `accounts view` off-TTY        | static list/table fallback               | no           |
| `accounts view <name>` off-TTY | static detail card fallback              | no           |
| any command + `--json`         | machine JSON                             | no           |
| workflows                      | line-oriented `text-progress` by default | no           |

The same command-shape pattern should apply consistently to browse-heavy families such as `accounts`, `transactions`, `links`, `assets`, `prices`, `providers`, `blockchains`, and `balance`.

Off-TTY `view` fallbacks are intentionally aliases of the matching static commands:

- `accounts view` off-TTY should produce the same output as `accounts`
- `accounts view kraken-main` off-TTY should produce the same output as `accounts kraken-main`

The `view` verb selects the explorer when available. It does not imply a richer text surface.

## Goals

- Make browse commands predictable from syntax alone.
- Reserve master-detail for TUI explorers only.
- Keep static output compact and copyable in scrollback.
- Preserve one generic machine-output escape hatch: `--json`.
- Allow workflows to keep capability-specific flags such as `--interactive` without turning them into generic presentation flags.

## Non-Goals

- Redesign the look of existing Ink explorers.
- Standardize every selector shape in one pass.
- Require every domain to support static detail immediately.

## Core Model

### Human Surface Is Chosen By Command Shape

Browse-heavy namespaces expose four canonical human-facing forms:

| Shape                | Meaning                                   | Static / TUI |
| -------------------- | ----------------------------------------- | ------------ |
| bare noun            | quick browse list/table                   | static       |
| bare noun + selector | focused non-interactive detail            | static       |
| `view`               | immersive explorer                        | TUI          |
| `view` + selector    | immersive explorer with initial selection | TUI          |

Examples:

- `exitbook accounts`
- `exitbook accounts kraken-main`
- `exitbook accounts view`
- `exitbook accounts view kraken-main`

The key rule is simple: users choose list vs detail vs explorer by command shape, not by generic output flags.

### Static Output Is Never Master-Detail

Static output may be either:

- a compact list/table
- a compact detail card

Static output must never imitate the TUI's master-detail layout. No selected-row expansion, no side-by-side detail pane, and no copied controls bar.

### TUI Is Reserved For Explorers

Master-detail, keyboard navigation, inline actions, and other immersive interaction patterns are reserved for `view` explorers on interactive terminals.

### JSON Is The Only Generic Output Override

`--json` is the only generic cross-command output override. It bypasses TUI and static human formatting and returns machine-oriented data.

There is no general `--text` flag and no general `--tui` flag in V3.

For browse commands, JSON follows the semantic target, not the human-facing surface verb:

- `accounts --json` and `accounts view --json` should return the same list payload
- `accounts kraken-main --json` and `accounts view kraken-main --json` should return the same detail payload

Per-family specs still define the exact JSON schema, but the top-level contract is that `view` does not create a different JSON shape.

### V2 To V3 Terminology

V2 used the term `text` for human-readable non-TUI output. V3 renames that concept to `static` because the human surface is now split into two explicit forms:

- static list/table
- static detail card

This is a naming cleanup, not a new renderer family.

### Workflow Flags Are Capability Flags, Not Presentation Flags

Workflow commands still default to line-oriented `text-progress`. Some workflows may keep flags such as `--interactive` when they need to opt into prompting or guided input collection.

Those flags:

- are command-specific
- do not imply TUI
- do not replace the command-shape rules used by browse commands

## Interactive Terminal

A command is considered interactive when all of the following are true:

- `process.stdin.isTTY === true`
- `process.stdout.isTTY === true`
- `process.env.CI` is not set

If a `view` explorer is invoked without an interactive terminal, it must not try to mount Ink.

Even on an interactive terminal, a `view` command should not mount Ink when there is no navigable explorer state to show. The approved short-circuit cases are:

- the initial collection is truly empty, so the matching static empty state is the entire useful result
- a requested selector does not resolve, in which case the shared not-found path should run before any renderer mounts

A zero-result filtered slice inside an otherwise valid explorer is not, by itself, a reason to skip TUI.

## Browse Surface Rules

### Static List

The bare namespace command should render a compact static list/table:

- `accounts`
- `transactions`
- `links`
- `assets`
- `prices`
- `providers`
- `blockchains`
- `balance`

This surface should answer the quick "show me what's here" question.

### Static Detail

When the family has a stable, obvious selector, the bare namespace plus selector should render a static detail card:

- `accounts kraken-main`
- `transactions 123`
- `links 456`

Static detail is the non-interactive "tell me about this one thing" surface. It is not an explorer fallback pasted into scrollback.

If a family does not yet have a stable selector contract, it may keep a dedicated detail subcommand temporarily, but the V3 direction is to prefer a simple noun-plus-selector shape where the selector is unambiguous.

If the selector does not match anything, the command should fail before rendering with the same not-found error path used by the explorer form. `accounts ghost-wallet` and `accounts view ghost-wallet` should not diverge in not-found behavior just because one is static and one is TUI-shaped.

### Explorer

`view` is the canonical explorer verb:

- `accounts view`
- `accounts view kraken-main`
- `transactions view`
- `transactions view 123`

On an interactive terminal:

- `view` opens the TUI explorer when there is an actual collection to browse
- `view` may short-circuit to the matching static empty state when the initial collection is truly empty
- `view <selector>` opens the same explorer pre-selected on that entity

Off terminal:

- `view` falls back to the matching static list/table
- `view <selector>` falls back to the matching static detail card
- those fallbacks are intentionally identical to the matching bare command forms

Explorer fallbacks must never emulate master-detail in static output.

If a selector passed to `view <selector>` does not resolve, the command should fail before Ink mounts rather than opening an empty explorer. In JSON mode, the same case should return the structured not-found error payload.

## Workflow Rules

Workflows are different from browse commands:

- they always behave like workflows, not static browse surfaces
- they default to `text-progress` on both TTY and non-TTY terminals
- they may use command-specific flags such as `--interactive`
- they may expose richer interactive prompting when the user is present, but they do not switch into TUI through a generic flag

Examples:

- `import`
- `reprocess`
- `links run`
- `prices enrich`
- `balance refresh`
- `providers benchmark`

### Minimum `text-progress` Contract

`text-progress` must remain observable enough that a workflow is understandable in scrollback, logs, and CI.

Minimum requirements:

- line-oriented output only; no cursor control, spinner frames, or full-screen terminal tricks
- material state changes must be visible
- long-running work should emit periodic heartbeat/progress summaries
- final completion output must include a concise outcome summary
- the same run should remain legible when stdout is piped or captured

## Mutation, Export, And Destructive Review

These remain text-first unless `--json` is requested.

- mutate commands render compact confirmations
- export commands render compact success/failure output
- destructive-review commands may use TUI when the command itself is explicitly a review surface, but they do not participate in a generic `--tui` model
- new `destructive-review` commands require explicit justification; this remains a narrow category rather than a catch-all for dangerous actions

## Static Layout Rules

Static human output should follow these rules:

- one blank line before the header
- one blank line after the header
- then immediately the primary table or detail card
- no controls footer
- no quit hints
- no master-detail imitation
- no trailing truncation hint unless truncation actually happened

List/table and detail card are both valid static surfaces. The shell prompt returning is the natural end of the output.

## Naming And Help Rules

### Browse Families

The preferred ladder is:

1. `noun`
2. `noun <selector>`
3. `noun view`
4. `noun view <selector>`

The static and TUI shapes should describe the same domain object at different depths, not different mental models.

### `view`

`view` always means "open the explorer." It should never mean "show text."

### Generic Flags

- keep `--json`
- remove generic `--text`
- remove generic `--tui`
- keep capability-specific flags only when they serve a real command-local purpose, such as `--interactive`

### Legacy Aliases

Legacy aliases such as `list` may remain temporarily for compatibility, but they are not part of the V3 model and new browse families should not add them. Canonical docs should teach the noun-based ladder, not the aliases.

## Shared Implementation Shape

The shared presentation layer should model surface shape, not semantic intent.

Recommended internal split:

```ts
type PresentationMode = 'json' | 'static' | 'text-progress' | 'tui';
type StaticSurfaceKind = 'list' | 'detail'; // only used when PresentationMode === 'static'
type CommandSurfaceKind =
  | 'static-list'
  | 'static-detail'
  | 'explorer'
  | 'workflow'
  | 'text-only'
  | 'destructive-review';
```

Key consequences:

- resolver-level types should not carry a separate `intent` field
- helper constructors should model actual surface behavior, not semantic categories
- `accounts` and `accounts <name>` are different entrypoint shapes even though they share a namespace

Minimal useful helper families:

- `staticListSurfaceSpec`
- `staticDetailSurfaceSpec`
- `explorerSurfaceSpec`
- `workflowSurfaceSpec`
- `textOnlySurfaceSpec`
- `destructiveReviewSurfaceSpec`

`textOnlySurfaceSpec` covers mutate/export commands whose human output is a compact confirmation or result line rather than a browse surface.

## Changes From V2

Compared with V2:

- generic `--text` and `--tui` are removed
- `--json` remains the only generic output override
- V2 `text` is renamed to `static`
- browse command shape now distinguishes static list, static detail, and explorer explicitly
- off-TTY `view` is intentionally an alias of the matching static command shape
- legacy aliases may remain temporarily, but they are no longer canonical

## Acceptance Criteria

- Browse command shape alone tells the user whether they will get a static list, a static detail card, or a TUI explorer.
- `view` never needs a generic `--tui` flag.
- TUI is skipped when there is no navigable explorer state to present, such as a truly empty initial collection.
- Static output never imitates master-detail.
- `view` commands fall back cleanly off-terminal.
- `--json` remains the only generic output override.
- Command-specific flags such as `--interactive` are documented as input/execution flags, not presentation flags.

## Decisions & Smells

- Decision: master-detail is reserved for TUI only.
- Decision: static human output may be either list/table or detail card.
- Decision: command shape, not generic human-output flags, is the primary browse UX contract.
- Decision: `--json` remains the only generic output override.
- Smell: V2 mixed semantic intent with presentation-selection concerns in one type.
- Smell: V2 helper constructors modeled command categories more than renderer behavior.
