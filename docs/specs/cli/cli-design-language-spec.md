---
last_verified: 2026-03-29
status: draft
---

# CLI Design Language Specification

> The Exitbook CLI should read like a product, not a bag of tools. New commands must fit a user journey first, then a code structure.

This spec defines the user-facing design language for the CLI as it grows: the mental model, command grouping rules, naming rules, help-writing rules, and interaction patterns that keep new command families consistent.

## Product Promise

Exitbook helps a user move through five questions without learning a new interface each time:

1. What workspace am I operating in?
2. How do I get or rebuild the data I need?
3. What needs review before I can trust the results?
4. What is my current financial position or tax outcome?
5. How do I recover safely when something is stale, wrong, or no longer needed?

Every command should clearly belong to one of those questions.

## User Journey Map

| Journey              | User question                                | Primary commands                                                                 |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| Workspace setup      | "What dataset am I working in?"              | `profiles`, `accounts`, `blockchains`, `providers`                               |
| Sync and rebuild     | "How do I get or regenerate current data?"   | `import`, `reprocess`, `links run`, `prices enrich`, `balance refresh`           |
| Review and resolve   | "What is suspicious, missing, or ambiguous?" | `accounts`, `transactions`, `links`, `links gaps`, `assets`, `prices`, `balance` |
| Analyze and export   | "What does my data mean?"                    | `portfolio`, `cost-basis`, `transactions export`, `cost-basis export`            |
| Cleanup and recovery | "How do I reset safely?"                     | `clear`                                                                          |

These journeys are the primary navigation system for humans. Technical ownership and package layout are secondary.

## Information Architecture

### Top-Level Goals Stay Top-Level

Keep a command top-level when the user thinks in outcomes, not domain objects.

Examples:

- `import`
- `reprocess`
- `clear`
- `portfolio`
- `cost-basis`

These are user goals. Do not bury them under generic containers like `data`, `reports`, or `workflows`.

### Domain Namespaces Own Ongoing Surfaces

Use noun namespaces when the user is browsing, updating, or exporting one domain repeatedly.

Examples:

- `accounts`
- `transactions`
- `links`
- `assets`
- `prices`
- `providers`
- `blockchains`
- `profiles`

The namespace should describe the object the user is reasoning about, not the implementation technique.

### Namespaces Need A Default Landing Surface

A bare namespace command should do something useful when that namespace has a primary browse surface. It should not just dump help and force the user to remember `view`.

The standard interaction ladder for browse-heavy namespaces is:

- bare noun: quick static list/table
- bare noun + stable selector: focused static detail card
- explicit `view`: immersive TUI explorer
- explicit `view` + selector: same explorer, pre-selected on that entity

Example:

- `exitbook accounts`
- `exitbook accounts kraken-main`
- `exitbook accounts view`
- `exitbook accounts view kraken-main`

This makes the CLI feel faster and more product-like:

- quick answer without leaving scrollback
- deeper inspection through stable command shapes, not output flags
- one stable explorer verb for TUI-heavy flows

When a browse family has a stable, obvious selector, the bare namespace plus selector should open a static detail card. If the selector contract is not yet stable, a dedicated detail subcommand is acceptable temporarily, but it should not become the default pattern.
Static output may be a list/table or a detail card, but master-detail is reserved for the TUI explorer.

### Ambient Context Beats Repeated Flags

Profile selection is context, not routine input. The default CLI posture should be:

- use the active profile automatically
- show the resolved profile when it materially affects the result
- avoid forcing `--profile` onto everyday commands
- let explicit environment overrides remain exceptional and visible

The user should feel like they are working inside a workspace, not passing the same routing flag to every command.

## Naming Rules

### Verb Contract

Reserve verbs for stable meanings across the whole CLI.

| Verb           | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `view`         | Open the immersive explorer/TUI for a domain                        |
| `run`          | Execute a workflow that changes derived state                       |
| `refresh`      | Rebuild and re-verify a stored snapshot                             |
| `enrich`       | Fill missing derived information                                    |
| `export`       | Emit a report or file-focused artifact                              |
| `add`          | Create a named resource                                             |
| `update`       | Change sync or config fields on an existing resource                |
| `rename`       | Change a label or key-adjacent identifier without changing identity |
| `switch`       | Change the default active context for future commands               |
| `current`      | Show the currently resolved context                                 |
| `set`          | Write one explicit value                                            |
| `confirm`      | Accept a suggested or suspicious state                              |
| `reject`       | Dismiss a suggested state                                           |
| `include`      | Re-enable something previously excluded                             |
| `exclude`      | Remove something from a policy-driven workflow                      |
| `clear-review` | Remove a previously stored review decision                          |
| `remove`       | Delete a named resource directly                                    |
| `gaps`         | Show unresolved coverage or matching gaps                           |

Do not add near-synonyms unless the workflow is materially different.

### Identifier Rules

Use the same option name for the same kind of input across commands:

- `--account` for a human-facing account name
- `--account-id` for an internal numeric account identifier
- `--asset` for a user-facing asset symbol filter
- `--asset-id` for a canonical asset identity
- `--blockchain` and `--provider` for registry keys
- `--json` for machine output everywhere
- `--verbose` for extra diagnostics without changing the interaction model

Examples should prefer names over IDs unless the command fundamentally operates on an ID.

## Help And Copy Rules

### One-Line Description Formula

A command description should say:

1. the user action
2. the user-facing object
3. the key outcome or constraint

Good patterns:

- "Rebuild derived data from saved raw imports"
- "View stored balance snapshots without calling live providers"
- "Set the default profile for future commands in this data directory"

Avoid descriptions that only describe internals.

### Help Section Order

Every non-trivial command should use this order:

1. concise description
2. options and arguments
3. `Examples:`
4. `Notes:` or `Common Usage:` when the command needs context

Examples must move from common to specific. The first example should match the most likely user task.

### Character Style

Human-facing CLI copy should use text-style symbols, not emoji presentation.

- Avoid: `✅`, `⚠️`, or other glyphs that render like mobile emoji
- When in doubt, prefer a plain text label over a pictographic icon

## Visual Hierarchy

### Header Tiers

Explorer and static-surface headers should have one visual headline and one metadata tier.

- the command title is the headline: white/bold
- inline counts, scope labels, type counts, provider counts, and `showing X of Y` text are supporting context: dim
- use brighter colors in headers only for true status or warning signals, not for routine counts
- if a header metric is the primary payload of the surface rather than supporting context, it may stay emphasized, but this should be deliberate and uncommon

Example:

- preferred: `Accounts` in bold, `0 total · 3 blockchain` in dim
- avoid: `Accounts` in bold, `0 total` in normal white, then other metadata in dim

### Error Copy

Errors must answer three things quickly:

1. what failed
2. why it matters
3. what to do next

When a better next step exists, name the exact command:

- "Run `exitbook balance refresh` first"
- "Run `exitbook import` before `exitbook reprocess` if raw data is stale"

### Success Copy

Success text should confirm the durable outcome, not narrate the implementation.

Prefer:

- "Default profile set to business [key: business]"
- "Added profile business [key: business]"

Avoid low-signal confirmations like:

- "Operation completed successfully"

## Interaction Rules

### Review Surfaces

Browse-heavy namespaces should expose three human-facing browse surfaces:

- bare noun commands should return a fast static list/table by default
- bare noun + selector should return a static detail card when the selector is stable
- explicit `view` commands should open the richer explorer surface
- focused selection inside Ink remains valid and important
- `view` + selector should open the same explorer pre-selected on that entity
- filters narrow the initial state at either depth
- human-facing surface is chosen by command shape, not by generic `--text` / `--tui` flags
- JSON bypasses the TUI entirely
- `--json` is the only generic output override; command-specific flags such as `--interactive` are about prompting or execution, not presentation
- non-interactive terminals degrade to the matching static surface: list/table or detail card
- explorer commands must detect non-interactive terminals before Ink mounts
- interactive `view` commands may short-circuit to the matching static empty state when the initial collection is truly empty
- missing selectors should use the shared not-found path instead of mounting an empty explorer
- a zero-result filtered slice inside an otherwise valid explorer should not, by itself, change the chosen surface
- never leak React or Ink stack traces for terminal-readiness failures
- if a static fallback is not implemented yet, fail with one clean CLI error line and a non-interactive hint instead of a framework crash

### Static Output Layout

Static human output should reuse the TUI's information design without imitating the TUI chrome.

- keep the header text identical to the TUI header when the command already has one
- render one blank line before the header and one blank line after it
- go straight into the primary table or detail card with no extra document-style spacing
- do not render controls bars, quit hints, or other interaction footers
- only render a trailing truncation hint when results were actually cut off

Static output is not a master-detail surface. Static output may be a compact list/table or a single detail card, but it must never embed detail panes, selected-row expansions, or any other imitation of the TUI's master-detail layout. If a family cannot support noun-plus-selector detail yet because its selector contract is not stable, a dedicated detail subcommand is acceptable temporarily.

The shell prompt returning is the natural end of static output. It should feel compact and scannable, not like a pasted report.

### Workflows

Workflow commands should answer operational questions continuously:

- what phase is running
- which provider or account is active
- whether work is advancing or blocked
- what the final outcome was

Users should not need `--verbose` just to learn whether the run is stuck or failing.

### Mutations

Mutation commands should be fast and explicit:

- accept the exact identifier needed for the change
- print one concise durable confirmation
- avoid full-screen UI unless review is part of safety, not convenience

### Destructive Recovery

Destructive commands must fail closed when a human is not present. `clear` is the reference model:

- interactive review before destructive execution
- `--confirm` for explicit automation
- text preview when no TTY is available

## Growth Checklist For New Commands

Before adding a new command or subcommand, answer all of these:

1. Which user journey owns this command?
2. Is it a top-level goal or a domain namespace operation?
3. Which reserved verb fits the action without inventing new terminology?
4. Is the default output a review surface, a workflow monitor, a concise mutation response, or an export?
5. Which existing command should feel "the same" to the user?
6. What exact command should error messages point to as the next step?
7. Does this need a dedicated spec, or is it fully covered by an existing family spec?

If those answers are unclear, the command design is not ready.
