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

| Journey              | User question                                | Primary commands                                                                      |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Workspace setup      | "What dataset am I working in?"              | `profiles`, `accounts`, `blockchains`, `providers`                                    |
| Sync and rebuild     | "How do I get or regenerate current data?"   | `import`, `reprocess`, `links run`, `prices enrich`, `balance refresh`                |
| Review and resolve   | "What is suspicious, missing, or ambiguous?" | `accounts view`, `transactions view`, `links view`, `links gaps`, `assets view`       |
| Analyze and export   | "What does my data mean?"                    | `portfolio`, `balance view`, `cost-basis`, `transactions export`, `cost-basis export` |
| Cleanup and recovery | "How do I reset safely?"                     | `clear`                                                                               |

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
| `view`         | Open or print a review surface                                      |
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

Browse commands should feel like inspection tools:

- filters narrow the initial state
- the command lands directly in the most useful review surface
- JSON bypasses the TUI entirely
- non-interactive terminals degrade to readable text snapshots

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
