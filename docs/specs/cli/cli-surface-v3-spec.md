---
last_verified: 2026-03-31
status: draft
supersedes: cli-surface-v2-spec.md
---

# CLI Surface V3 Specification

> This document is the normative user-facing surface contract for the Exitbook CLI. Internal wiring and helper structure belong in [CLI Command Wiring](../../code-assistants/cli-command-wiring.md), not here.

V3 replaces the earlier generic `--text` / `--tui` model with a command-shape model:

- command shape chooses the human surface
- terminal readiness decides whether an explorer can mount Ink
- `--json` remains the only generic output override
- command-specific flags such as `--interactive` or `--confirm` may change input collection or execution behavior, but they do not act as generic presentation flags

## Quick Reference

| Shape                              | Human output                                     | TTY required |
| ---------------------------------- | ------------------------------------------------ | ------------ |
| `accounts`                         | static list/table                                | no           |
| `accounts <selector>`              | static detail card                               | no           |
| `accounts view`                    | TUI explorer/master-detail                       | yes          |
| `accounts view <selector>`         | TUI explorer pre-selected on `<selector>`        | yes          |
| `accounts view` off-TTY            | same static list/table as `accounts`             | no           |
| `accounts view <selector>` off-TTY | same static detail card as `accounts <selector>` | no           |
| any command + `--json`             | machine JSON                                     | no           |
| workflows                          | text-progress or prompt-first interaction        | no           |

Browse-heavy families should follow this ladder when they expose both static and explorer surfaces:

- `accounts`
- `accounts <selector>`
- `accounts view`
- `accounts view <selector>`

The same model applies to families such as `accounts`, `transactions`, `links`, `assets`, `prices`, `providers`, `blockchains`, and `balance` when they have stable browse semantics.

## Goals

- Make browse behavior predictable from syntax alone.
- Reserve master-detail for explorer/TUI surfaces only.
- Keep static output compact and readable in scrollback.
- Preserve a single generic machine-output escape hatch: `--json`.
- Allow workflows to remain command-shaped instead of being forced into browse rules.

## Non-Goals

- Prescribe internal helper names or shared type taxonomies.
- Require every family to invent a selector before it is stable.
- Turn prompt-first workflows into a generic TUI mode.

## Current Contract

### Browse Surface Is Chosen By Command Shape

Browse-heavy namespaces expose up to four human-facing forms:

| Shape                | Meaning                                   | Surface |
| -------------------- | ----------------------------------------- | ------- |
| bare noun            | quick browse list/table                   | static  |
| bare noun + selector | focused non-interactive detail            | static  |
| `view`               | immersive explorer                        | TUI     |
| `view` + selector    | immersive explorer with initial selection | TUI     |

Examples:

- `exitbook accounts`
- `exitbook accounts kraken-main`
- `exitbook accounts view`
- `exitbook accounts view kraken-main`

The user chooses list vs detail vs explorer by command shape, not by generic presentation flags.

### Static Output Is Never Master-Detail

Static output may be:

- a compact list/table
- a compact detail card

Static output must never imitate the explorer layout. No selected-row expansion, no side-by-side detail pane, no controls footer, and no copied quit hints.

### `view` Always Means Explorer

`view` is the explorer verb. It does not mean “show text” and it does not introduce a separate JSON schema.

On an interactive terminal:

- `view` opens the explorer when there is a real collection to browse
- `view <selector>` opens the same explorer pre-selected on that entity

On a non-interactive terminal:

- `view` falls back to the matching static list/table
- `view <selector>` falls back to the matching static detail card
- those fallbacks are intentionally aliases of the matching bare command shapes

### Interactive Terminal Readiness

A terminal is considered interactive when all of the following are true:

- `process.stdin.isTTY === true`
- `process.stdout.isTTY === true`
- `process.env.CI` is not set

Explorer commands must check readiness before Ink mounts.

Approved explorer short-circuit cases:

- the initial collection is truly empty, so the matching static empty state is the entire useful result
- a requested selector does not resolve, so the shared not-found path runs before any renderer mounts

Non-approved short-circuit case:

- a zero-result filtered slice inside an otherwise valid explorer

That last case must still open the explorer. A filtered empty view is not the same thing as an empty collection.

### JSON Is The Only Generic Output Override

`--json` is the only generic cross-command output override.

- there is no generic `--text`
- there is no generic `--tui`
- `view` does not create a different JSON shape

For browse commands, JSON follows the semantic target rather than the human-facing verb:

- `accounts --json` and `accounts view --json` return the same list payload
- `accounts kraken-main --json` and `accounts view kraken-main --json` return the same detail payload

Per-family specs still own the concrete JSON schema. This spec only defines the cross-command contract.

### Selector Resolution Must Not Diverge By Surface

If a selector does not resolve, the command should fail before rendering.

- `accounts ghost-wallet`
- `accounts view ghost-wallet`
- `accounts ghost-wallet --json`
- `accounts view ghost-wallet --json`

These forms may render differently on success, but they must not disagree about whether the selector exists.

### Workflow Rules

Workflows are not browse commands. They should keep workflow semantics on both TTY and non-TTY terminals.

Examples:

- `import`
- `reprocess`
- `links run`
- `prices enrich`
- `balance refresh`
- `providers benchmark`
- `clear`

Workflow rules:

- they do not participate in the browse ladder
- they do not switch surfaces through generic flags
- they remain observable in scrollback, logs, and CI
- they may use command-specific flags such as `--interactive` or `--confirm`

#### Text-Progress Default

Most workflows should default to line-oriented `text-progress`.

Minimum contract:

- line-oriented output only
- material state changes are visible
- long-running work emits periodic progress or heartbeat summaries
- final output includes a concise outcome summary
- the same run remains legible when stdout is piped or captured

#### Prompt-First Workflows

Some workflows may begin with interactive prompting or guided confirmation before they start execution.

This is valid when the command meaning is inherently interactive, such as:

- destructive confirmation before `clear`
- guided input collection before a workflow starts

Prompt-first interaction does not create a generic TUI mode. It is still command-local workflow behavior.

### Mutation, Export, And Review Commands

These remain text-first unless `--json` is requested.

- mutation commands render compact confirmations
- export commands render compact success/failure output
- explicit review commands may use TUI when the command itself is a review surface

This category does not reintroduce a generic presentation override.

### Static Layout Rules

Static human output should follow these rules:

- one blank line before the header
- one blank line after the header
- then immediately the primary table or detail card
- no controls footer
- no quit hints
- no master-detail imitation
- no trailing truncation hint unless truncation actually happened

The shell prompt returning is the natural end of the output.

### Naming And Help Rules

Preferred browse ladder:

1. `noun`
2. `noun <selector>`
3. `noun view`
4. `noun view <selector>`

Rules:

- `view` always means “open the explorer”
- keep `--json`
- do not introduce generic `--text`
- do not introduce generic `--tui`
- do not reintroduce removed browse aliases such as `list`

## Transition Direction

The V3 direction is to prefer `noun + selector` for static detail when the selector is stable and obvious.

Until then:

- a family may keep a dedicated detail subcommand temporarily
- temporary shapes should not become the new default pattern
- once a stable selector exists, the family should converge on the standard browse ladder

This section is directional. The rest of the document is the current contract.

## Implementation Boundary

This spec intentionally does not prescribe helper constructors, internal type unions, or file layout.

Implementation details belong in:

- [CLI Command Wiring](../../code-assistants/cli-command-wiring.md)
- `apps/cli/src/cli/presentation.ts`

If implementation helpers need to change, update those documents and modules without weakening the user-facing surface contract defined here.

## Acceptance Criteria

- Browse command shape alone tells the user whether they will get a static list, a static detail card, or an explorer.
- `view` never requires a generic `--tui` flag.
- Non-interactive `view` commands fall back to the matching static surface.
- Explorer commands skip Ink only when there is no navigable explorer state, such as a truly empty initial collection or a missing selector.
- Filtered-empty explorer states do not silently downgrade to static.
- Static output never imitates master-detail.
- `--json` remains the only generic output override.
- Workflow-specific flags are documented as input or execution flags, not presentation flags.
