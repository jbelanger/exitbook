---
last_verified: 2026-03-31
status: draft
---

# CLI Design Language Specification

> The Exitbook CLI should read like a product, not a bag of tools. New commands must fit a user journey first, then a code structure.

This spec defines the user-facing design language for the CLI as it grows: the mental model, command grouping rules, naming rules, help-writing rules, and visual interaction principles that keep new command families consistent.

Exact browse/workflow surface semantics belong in [CLI Surface V3 Specification](./cli-surface-v3-spec.md). This document owns product language and command-design conventions, not the low-level terminal-behavior contract.

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

The normative browse ladder lives in [CLI Surface V3 Specification](./cli-surface-v3-spec.md). This document only sets the product expectation: a namespace should have a fast default landing surface, a deeper focused inspection path when the selector is stable, and an explicit richer explorer path when exploration is the point.

This makes the CLI feel faster and more product-like:

- quick answer without leaving scrollback
- deeper inspection through stable command shapes, not output flags
- one stable explorer verb for TUI-heavy flows

When a browse family has a stable, obvious selector, it should converge on the standard noun-based ladder instead of inventing extra browse verbs or aliases.

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
| `update`       | Change mutable properties on an existing resource                   |
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

Use the same input shape for the same kind of target across commands:

- bare `<selector>` for direct existing-account targeting
- account selectors resolve account name first, then unique fingerprint prefix
- `--account <selector>` only when a command intentionally exposes account filtering instead of direct target selection
- `--asset` for a user-facing asset symbol filter
- `--asset-id` for a canonical asset identity
- `--blockchain` and `--provider` for registry keys
- `--json` for machine output everywhere

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

### Shell-Native Text

Human-facing text output should feel shell-native first and styled second.

- favor structure, alignment, and wording over decoration
- use restrained semantic color, not decorative color
- never require color to understand the result
- avoid box drawing, chrome, or mini-dashboard styling in non-TUI surfaces
- reserve the richest visual treatment for true TUI explorers

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

Error rendering should stay product-like:

- print one primary error line to stderr
- optionally print one short `Hint:` line when a next step is genuinely useful
- do not leak framework internals or implementation terminology into the primary message
- do not print stack traces by default in normal user-facing CLI output
- keep the final error line flush with the shell prompt; no extra trailing blank line

### Success Copy

Success text should confirm the durable outcome, not narrate the implementation.

Prefer:

- "Default profile set to business [key: business]"
- "Added profile business [key: business]"

Avoid low-signal confirmations like:

- "Operation completed successfully"

Mutation success should usually be one line. A second line is acceptable only when it adds durable context such as profile, identifier, or output path.

## Interaction Principles

### Review Surfaces

Browse-heavy namespaces should feel fast to enter and deeper only when the user asks for it.

- default entry should answer the quick "what is here?" question
- deeper inspection should use stable command shapes, not ad hoc output flags
- richer exploration should feel like the same domain object at greater depth, not a different product
- failure modes should stay product-like: one clean CLI error, no framework leakage, and a clear next step

For the normative browse, fallback, and JSON rules, use [CLI Surface V3 Specification](./cli-surface-v3-spec.md).

### Static Output Layout

Static human output should reuse the TUI's information design without imitating the TUI chrome.

- keep the header text identical to the TUI header when the command already has one
- render no blank line before the header
- render one blank line after the header only when a real table or detail body follows
- go straight into the primary table or detail card with no extra document-style spacing
- do not render controls bars, quit hints, or other interaction footers
- only render a trailing truncation hint when results were actually cut off
- do not render an extra blank line after the final output line

Static output is not a master-detail surface. It should feel like the compact, scrollback-friendly expression of the same product surface, not a degraded screenshot of the explorer.

The shell prompt returning is the natural end of static output. It should feel compact and scannable, not like a pasted report.

### Workflows

Workflow commands should answer operational questions continuously:

- what phase is running
- which provider or account is active
- whether work is advancing or blocked
- what the final outcome was

Users should not need debug logging just to learn whether the run is stuck or failing.

Exact workflow-output and prompt-first semantics belong in [CLI Surface V3 Specification](./cli-surface-v3-spec.md).

### Mutations

Mutation commands should be fast and explicit:

- accept the exact identifier needed for the change
- print one concise durable confirmation
- avoid browse-style headers, cards, or report spacing
- prefer a single line; allow a second line only when it adds durable context
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
