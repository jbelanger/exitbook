---
last_verified: 2026-03-29
status: superseded-draft
superseded_by: cli-surface-v3-spec.md
---

# CLI Surface V2 Specification

> Superseded by [CLI Surface V3](./cli-surface-v3-spec.md). Retained for migration history only.

> Code is law: if this document disagrees with implementation, the implementation is correct and this spec must be updated.

This spec defines the command taxonomy, presentation mode rules, naming conventions, and migration plan for the Exitbook CLI. It sits above the existing per-command specs and resolves the current ambiguity between TUI and non-TUI behavior.

## Quick Reference

| Concept                   | Rule                                                  |
| ------------------------- | ----------------------------------------------------- |
| Bare namespace commands   | `text` by default; quick snapshot only                |
| `view` explorer commands  | `tui` on terminal; `text` fallback off-terminal       |
| Workflow commands         | `text-progress` by default; `--tui` for Ink dashboard |
| Mutate / export           | `text` always; no TUI unless explicitly justified     |
| `--json`                  | Machine output; never launches TUI or text-progress   |
| `--json`/`--text`/`--tui` | Mutually exclusive; CLI exits with validation error   |
| Browse flags              | Narrow initial state; do not replace the depth model  |
| Long-running workflows    | One execution engine, multiple renderers              |
| Acceptance scope          | Applies to the full currently registered CLI surface  |

## Goals

- Make command behavior predictable across TUI, human-readable text, and JSON contexts.
- Stop treating "has flags" as a proxy for "should not use TUI".
- Separate execution logic from rendering logic for workflow commands.
- Preserve scriptability without degrading interactive review flows.
- Define naming rules so new commands fit the surface without ad hoc exceptions.
- Cover the full runnable CLI surface, including recently added profile, export, and maintenance commands.

## Non-Goals

- Redesign the visual layout of existing TUIs.
- Rename every current command in one pass.
- Introduce backward-compatibility aliases unless they materially reduce migration risk.
- Specify per-command keyboard behavior already covered by existing view specs.

This spec applies to the full currently registered runnable CLI surface, not only to TUI-heavy commands or to commands touched during an initial migration slice. The migration plan and acceptance criteria must therefore cover every currently registered runnable command.

## Problem Statement

The current CLI mostly uses a binary output model:

- `--json` => JSON
- everything else => TUI or ad hoc text

That model is too coarse.

- Browse commands need filters and still should open in TUI.
- Domain namespaces should answer a quick question without forcing users through `view`.
- Long-running workflows need live progress in both interactive and non-interactive contexts.
- One-shot action commands should remain fast, plain, and legible without requiring TUI.
- "Non-TUI" is not a useful internal product concept because it conflates snapshot output with live progress output.

## User Journey Overlay

Intent drives presentation, but user journeys drive information architecture. The current CLI surface should read as five coherent workflows:

| Journey              | Goal                                                        | Commands                                                                         |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Workspace setup      | choose a working dataset and inspect available integrations | `profiles`, `accounts`, `blockchains`, `providers`                               |
| Sync and rebuild     | fetch or regenerate current derived state                   | `import`, `reprocess`, `links run`, `prices enrich`, `balance refresh`           |
| Review and resolve   | inspect suspicious, missing, or ambiguous data              | `accounts`, `transactions`, `links`, `links gaps`, `assets`, `prices`, `balance` |
| Analyze and export   | inspect outcomes and emit artifacts                         | `portfolio`, `cost-basis`, `transactions export`, `cost-basis export`            |
| Cleanup and recovery | safely remove or reset data                                 | `clear`                                                                          |

The journey overlay is what keeps new namespaces from feeling arbitrary. A new command must fit both a command intent and a user journey.

## Definitions

### Command Intent

The semantic role of a command. Intent, not flag count, determines default presentation.

| Intent               | Meaning                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `browse`             | Inspect, review, filter, triage, or drill into data                |
| `workflow`           | Run a multi-step process that may take noticeable time             |
| `mutate`             | Apply a single focused state change and exit                       |
| `destructive-review` | Review destructive impact, then confirm execution                  |
| `export`             | Emit report or file-oriented output without an interactive browser |

`destructive-review` is reserved for commands where preview/review is the primary safety mechanism before execution, not a convenience feature. New commands require explicit justification to use this intent; it is not a general-purpose bucket for dangerous mutations.

### Presentation Mode

The output frontend selected for a command execution. `PresentationMode` is an internal runtime model, not a claim that every mode needs its own public CLI flag.

```ts
type PresentationMode = 'json' | 'text' | 'text-progress' | 'tui';
```

- `json`: structured machine output only
- `text`: human-readable snapshot or confirmation output
- `text-progress`: human-readable progress updates during a running workflow
- `tui`: interactive Ink application

### Browse Entrypoint Roles

Browse-heavy namespaces expose two standard entrypoint roles:

| Entrypoint role | Typical syntax           | Human goal                            | Default presentation |
| --------------- | ------------------------ | ------------------------------------- | -------------------- |
| `snapshot`      | `exitbook accounts`      | get a quick answer                    | `text`               |
| `explorer`      | `exitbook accounts view` | browse, drill down, act interactively | `tui`                |

Focused landing inside the explorer may still accept a selector such as:

```text
exitbook accounts view kraken-main
```

Static detail, when needed, should be expressed as a dedicated subcommand rather than a positional variant of the snapshot entrypoint.
When an explorer command falls back to non-interactive text, it must collapse to one static surface: either a list/table or a detail card. It must not try to preserve the TUI's master-detail layout.

### Interactive Terminal

A command is considered interactive when all of the following are true:

- `process.stdin.isTTY === true`
- `process.stdout.isTTY === true`
- `process.env.CI` is not set (any non-empty string is truthy)

`stderr` is not checked. Redirecting stderr (`exitbook transactions view 2>error.log`) is a legitimate terminal use case — the TUI renders on stdout and reads input from stdin, so stderr piping should not force a fallback.

Common edge case: `exitbook transactions view | head` is non-interactive for presentation purposes because `stdout` is piped, even if `stdin` is still a TTY. That command must fall back to non-TUI output.

## Surface Model

### Core Rule

Default presentation follows from the entrypoint role, not just the semantic intent:

| Entrypoint role      | Default (interactive) | Default (non-interactive) |
| -------------------- | --------------------- | ------------------------- |
| `snapshot`           | `text`                | `text`                    |
| `explorer`           | `tui`                 | `text`                    |
| `workflow`           | `text-progress`       | `text-progress`           |
| `mutate`             | `text`                | `text`                    |
| `export`             | `text`                | `text`                    |
| `destructive-review` | `tui`                 | `text` (no execute)       |

TUI is reserved for explorer entrypoints with real interaction value: list/detail navigation, drill-down, inline actions. Snapshot entrypoints are intentionally text-first even on interactive terminals. Workflow monitors — progress displays without keyboard interaction — use `text-progress` by default. Users can opt into the Ink dashboard for workflows via `--tui`.

`json` remains the machine-facing mode.

### Browse Commands May Trigger Workflow-Style Prereqs

Some browse commands (`cost-basis`, `portfolio`, `balance`, `balance view`) implicitly rebuild upstream projections (processed transactions, links, price coverage) before rendering. When a browse command triggers a prereq rebuild, the rebuild uses its own presenter selected by the current presentation mode — it does not inherit the browse command's static text renderer. This means a `cost-basis --text` invocation may emit `text-progress` output for stale projections before printing the final text snapshot.

This is intentional: the prereq rebuild is a workflow sub-operation with different rendering needs than the parent browse command. Phase 4 of the migration plan formalizes this by introducing a projection monitor contract.

### Command Taxonomy

The taxonomy below is the target surface model for browse-heavy namespaces. Aliases such as `accounts list` are covered by their canonical target.

#### Workspace Setup

| Command               | Role / intent | Default on interactive terminal | Default off terminal / CI |
| --------------------- | ------------- | ------------------------------- | ------------------------- |
| `profiles`            | `snapshot`    | `text`                          | `text`                    |
| `profiles current`    | `export`      | `text`                          | `text`                    |
| `profiles add`        | `mutate`      | `text`                          | `text`                    |
| `profiles rename`     | `mutate`      | `text`                          | `text`                    |
| `profiles switch`     | `mutate`      | `text`                          | `text`                    |
| `accounts`            | `snapshot`    | `text`                          | `text`                    |
| `accounts view`       | `explorer`    | `tui`                           | `text`                    |
| `accounts add`        | `mutate`      | `text`                          | `text`                    |
| `accounts update`     | `mutate`      | `text`                          | `text`                    |
| `accounts rename`     | `mutate`      | `text`                          | `text`                    |
| `accounts remove`     | `mutate`      | `text`                          | `text`                    |
| `blockchains`         | `snapshot`    | `text`                          | `text`                    |
| `blockchains view`    | `explorer`    | `tui`                           | `text`                    |
| `providers`           | `snapshot`    | `text`                          | `text`                    |
| `providers view`      | `explorer`    | `tui`                           | `text`                    |
| `providers benchmark` | `workflow`    | `text-progress`                 | `text-progress`           |

#### Sync And Rebuild

| Command           | Role / intent | Default on interactive terminal | Default off terminal / CI |
| ----------------- | ------------- | ------------------------------- | ------------------------- |
| `import`          | `workflow`    | `text-progress`                 | `text-progress`           |
| `reprocess`       | `workflow`    | `text-progress`                 | `text-progress`           |
| `links run`       | `workflow`    | `text-progress`                 | `text-progress`           |
| `prices enrich`   | `workflow`    | `text-progress`                 | `text-progress`           |
| `balance refresh` | `workflow`    | `text-progress`                 | `text-progress`           |

#### Review And Resolve

| Command                  | Role / intent | Default on interactive terminal | Default off terminal / CI |
| ------------------------ | ------------- | ------------------------------- | ------------------------- |
| `transactions`           | `snapshot`    | `text`                          | `text`                    |
| `transactions view`      | `explorer`    | `tui`                           | `text`                    |
| `transactions edit note` | `mutate`      | `text`                          | `text`                    |
| `links`                  | `snapshot`    | `text`                          | `text`                    |
| `links view`             | `explorer`    | `tui`                           | `text`                    |
| `links gaps`             | `explorer`    | `tui`                           | `text`                    |
| `links confirm`          | `mutate`      | `text`                          | `text`                    |
| `links reject`           | `mutate`      | `text`                          | `text`                    |
| `assets`                 | `snapshot`    | `text`                          | `text`                    |
| `assets view`            | `explorer`    | `tui`                           | `text`                    |
| `assets confirm`         | `mutate`      | `text`                          | `text`                    |
| `assets clear-review`    | `mutate`      | `text`                          | `text`                    |
| `assets include`         | `mutate`      | `text`                          | `text`                    |
| `assets exclude`         | `mutate`      | `text`                          | `text`                    |
| `assets exclusions`      | `export`      | `text`                          | `text`                    |
| `prices`                 | `snapshot`    | `text`                          | `text`                    |
| `prices view`            | `explorer`    | `tui`                           | `text`                    |
| `prices set`             | `mutate`      | `text`                          | `text`                    |
| `prices set-fx`          | `mutate`      | `text`                          | `text`                    |
| `balance`                | `snapshot`    | `text`                          | `text`                    |
| `balance view`           | `explorer`    | `tui`                           | `text`                    |

#### Analyze And Export

| Command               | Role / intent | Default on interactive terminal | Default off terminal / CI |
| --------------------- | ------------- | ------------------------------- | ------------------------- |
| `portfolio`           | `snapshot`    | `text`                          | `text`                    |
| `cost-basis`          | `snapshot`    | `text`                          | `text`                    |
| `cost-basis export`   | `export`      | `text`                          | `text`                    |
| `transactions export` | `export`      | `text`                          | `text`                    |

#### Cleanup And Recovery

| Command | Intent               | Default on interactive terminal | Default off terminal / CI                                                    |
| ------- | -------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `clear` | `destructive-review` | `tui`                           | `text` preview only; execution requires `--confirm`, otherwise exit non-zero |

Top-level namespace commands such as `accounts`, `assets`, `balance`, `blockchains`, `links`, `prices`, `profiles`, `providers`, and `transactions` should become standalone snapshot entrypoints rather than dead-end grouping commands.

## Mode Selection Rules

### Precedence

Mode resolution follows this order:

1. `--json`
2. `--text`
3. entrypoint-role default
4. fallback safety rule

### Override Flags

This spec standardizes two explicit output overrides:

- `--text` — force human-readable text output without TUI or live progress. Command intent determines whether the renderer is `text` or `text-progress`.
- `--tui` — force the Ink dashboard for workflow commands. Snapshot commands should not use this flag; use the explicit `view` explorer command instead.

`--tui` exists because workflow commands default to `text-progress`, not TUI. Users who prefer the Ink progress dashboard can opt in per invocation. Explorer commands already encode the TUI choice in the command shape itself.

For `snapshot`, `mutate`, and `export` commands, `--text` is a no-op because these commands already default to `text` in all contexts. Implementations should accept the flag silently rather than erroring, but should not register special `--text` handling for these entrypoint roles.

`--no-tui` is not the preferred surface because it describes implementation rather than output behavior. It may exist as a temporary compatibility alias for `--text` during migration, but it is not the canonical flag.

### Flag Conflicts

`--json`, `--text`, and `--tui` are mutually exclusive. If any combination is passed together, the CLI must exit with a validation error and a clear message. Silent precedence would mask user confusion.

### Resolution Algorithm

```ts
function resolvePresentationMode(spec: CommandPresentationSpec, options: RawOptions): PresentationMode {
  const flagCount = [options.json, options.text, options.tui].filter(Boolean).length;
  if (flagCount > 1) {
    throw new Error('--json, --text, and --tui are mutually exclusive');
  }

  if (options.json === true) return 'json';

  if (options.tui === true) {
    if (spec.role === 'workflow' || spec.role === 'explorer' || spec.role === 'destructive-review') {
      return 'tui';
    }

    throw new Error('--tui is not supported for this command; use the explicit view command instead');
  }

  if (options.text === true) {
    return spec.nonTuiOverrideMode;
  }

  if (spec.role === 'snapshot' || spec.role === 'mutate' || spec.role === 'export') {
    return 'text';
  }

  if (!isInteractiveTerminal()) {
    return spec.fallbackNonInteractiveMode;
  }

  return spec.interactiveDefaultMode;
}
```

This resolves the selected entrypoint's presentation mode. Browse snapshot commands that trigger upstream projection rebuilds (e.g., `cost-basis`, `portfolio`, `balance`) may internally use a `text-progress` presenter for those sub-operations even when the parent command resolves to `text`. The projection monitor contract in Phase 4 governs that behavior — the resolver above does not override it.

### Fallback Safety Rules

- `snapshot` commands must always remain text-first.
- `explorer` commands off-terminal must not try to mount Ink.
- preferred behavior for `explorer` commands off-terminal is a text fallback rendered as one static surface: either a table/list or a detail card, depending on the requested scope.
- explorer fallbacks must never emulate the TUI's master-detail layout in static output.
- until a given explorer has a snapshot fallback, it may exit with a single-line CLI error that explains the TTY requirement and points to a non-interactive mode.
- React or Ink stack traces are never an acceptable non-interactive failure mode.
- `workflow` commands off-terminal must not silently degrade to a bare success line. They render progress and completion in `text-progress`.
- Both `text` and `text-progress` must be CI-safe, line-oriented terminal output. They must not depend on cursor control, spinners, or full-screen terminal behavior.
- `--json` remains the only mode intended for machine parsing.

## Flag Semantics

### Snapshot And Explorer Commands

Browse-heavy namespaces expose two human-facing depths:

- bare namespace commands for text snapshots
- explicit `view` commands for immersive exploration
- dedicated detail subcommands for focused non-interactive detail, if a family truly needs them
- explorer fallbacks collapse to one static surface; they do not become static master-detail views

Flags narrow the initial state at either depth. They do not replace the depth model.

Examples:

- `accounts` means "show me the quick account snapshot"
- `accounts view` means "open the interactive account explorer"
- `accounts view kraken-main` means "open the interactive account explorer focused on that account"
- `transactions view --asset BTC` means "open the transaction explorer scoped to BTC"
- `prices view --missing-only --platform kraken` means "open the missing-price browser scoped to Kraken"
- `cost-basis --asset ETH` means "calculate as requested, then scope the report to ETH"

### Workflow Commands

Flags parameterize execution. They do not change the rendering model unless they explicitly select a presentation mode.

Examples:

- `prices enrich --asset BTC` still behaves like a workflow, not a static report
- `providers benchmark --skip-burst` is still a live progress command

### Mutation Commands

Flags fully describe the action. The default presentation is a concise confirmation line.

Examples:

- `links confirm 123`
- `prices set --asset SOL --date ... --price ...`
- `assets exclude --asset scam-token`

### Destructive Review Commands

`clear` is special because the interactive review is part of the safety model.

- Default on terminal: TUI preview + inline confirm
- `--text` on terminal: render text preview, prompt for yes/no confirmation on stdin, execute only on affirmative response. This is the non-TUI equivalent of the TUI confirm flow — it does not skip confirmation or exit non-zero, because the user is present and explicitly asked for text output.
- `--confirm`: skip review and execute immediately
- Off-terminal without `--confirm`: render text preview, do not execute, and exit non-zero to signal that explicit confirmation is required
- In CI and other automation contexts, `clear` must fail closed by default. Scripts that intend to execute it must pass `--confirm` explicitly.
- `--json`: render structured preview or result depending on the action path

## Input Collection Rules

Prompting and presentation are separate concerns.

- Missing required parameters may be gathered interactively when the command explicitly supports prompt-driven input.
- Prompt-driven input requires an interactive terminal.
- Prompt collection happens before a workflow TUI takes over.
- Browse filters are never collected through prompts when sensible defaults already exist.

Current command policy:

| Command           | Prompt policy                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `cost-basis`      | Prompt for missing method/jurisdiction/year inputs on terminal                                                            |
| `links run`       | Prompt only when threshold flags are omitted and interactive prompting is still desired                                   |
| `import`          | No general prompt flow; confirmation only for special warnings                                                            |
| `prices enrich`   | No manual price prompts in workflow mode                                                                                  |
| `clear`           | TUI: inline confirm. `--text` on terminal: yes/no stdin prompt. Off-terminal: no prompt, exit non-zero unless `--confirm` |
| `browse` commands | No prompts; flags only                                                                                                    |

## Naming Rules

### Top-Level Goals

Keep a command top-level when it is a primary user goal rather than a sub-operation on a domain object.

Examples:

- `import`
- `reprocess`
- `clear`
- `portfolio`
- `balance`
- `cost-basis`

These should not be forced into artificial namespaces like `data import` or `reports portfolio`.

### Domain Namespaces

Use noun namespaces when the command family clusters around inspecting and mutating one domain.

Examples:

- `transactions`
- `prices`
- `links`
- `assets`
- `providers`
- `accounts`
- `blockchains`

### Verb Reservation

Use verbs consistently:

| Verb                  | Meaning                                |
| --------------------- | -------------------------------------- |
| `view`                | Open the immersive explorer/TUI        |
| `run`                 | Execute a workflow process             |
| `refresh`             | Rebuild and re-verify stored state     |
| `enrich`              | Fill gaps in existing domain data      |
| `benchmark`           | Run a measurement workflow             |
| `export`              | Emit report/file output                |
| `add`                 | Create a named resource                |
| `update`              | Change stored sync/config fields       |
| `rename`              | Change a human-facing label or name    |
| `switch`              | Change the default active context      |
| `current`             | Show the currently resolved context    |
| `list`                | Emit a short textual/export snapshot   |
| `set`                 | Write one explicit value               |
| `confirm` / `reject`  | Resolve a suggested state change       |
| `include` / `exclude` | Toggle accounting policy or visibility |
| `remove`              | Delete a named resource directly       |
| `gaps`                | Show unresolved coverage gaps          |

Avoid introducing additional near-synonyms unless a domain has a materially different workflow.

## Shared Implementation Shape

### Required Abstractions

Replace the current boolean `isJsonMode` branching with explicit presentation contracts.

```ts
type CommandIntent = 'browse' | 'workflow' | 'mutate' | 'destructive-review' | 'export';
type CommandEntrypointRole = 'snapshot' | 'explorer' | 'workflow' | 'mutate' | 'export' | 'destructive-review';

interface CommandPresentationSpec {
  /** Identifies the command in diagnostics and logging; not used by the resolver. */
  commandId: string;
  intent: CommandIntent;
  role: CommandEntrypointRole;
  interactiveDefaultMode: Extract<PresentationMode, 'tui' | 'text' | 'text-progress'>;
  nonTuiOverrideMode: Extract<PresentationMode, 'text' | 'text-progress'>;
  fallbackNonInteractiveMode: Extract<PresentationMode, 'text' | 'text-progress'>;
}
```

Each command must define its spec as a const export co-located with the command registration. The shared resolver consumes these directly — there is no central registry map. A registry is unnecessary because `resolvePresentationMode` receives the spec from the caller; it does not look it up by name.

For commands with fixed presentation behavior, use entrypoint-role helper constructors to eliminate boilerplate:

```ts
function snapshotPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'browse',
    role: 'snapshot',
    interactiveDefaultMode: 'text',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

function explorerPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'browse',
    role: 'explorer',
    interactiveDefaultMode: 'tui',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

function workflowPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'workflow',
    role: 'workflow',
    interactiveDefaultMode: 'text-progress',
    nonTuiOverrideMode: 'text-progress',
    fallbackNonInteractiveMode: 'text-progress',
  };
}

function mutatePresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'mutate',
    role: 'mutate',
    interactiveDefaultMode: 'text',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

function exportPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'export',
    role: 'export',
    interactiveDefaultMode: 'text',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}
```

Commands with non-standard combinations (e.g., `clear` with `destructive-review`) define their spec inline. The helpers cover the common cases — most commands should use one without modification.

The shared presentation model must live in one module family only. Do not introduce duplicate definitions of `PresentationMode`, `CommandIntent`, or resolver helpers in multiple directories during migration. All presentation primitives belong under `apps/cli/src/features/shared/presentation/`.

### Renderer Split

Workflow handlers must expose one execution engine and multiple presenters.

```ts
interface WorkflowPresenter<TEvent, TResult> {
  /** Must resolve before onEvent() is called. Sets up the rendering surface. */
  start(): Promise<void>;
  onEvent(event: TEvent): void;
  succeed(result: TResult): Promise<void>;
  fail(error: Error): Promise<void>;
  abort(): Promise<void>;
}
```

Presenter variants:

- Ink presenter
- text-progress presenter
- JSON collector

The orchestrator or pipeline must not know which presenter is active.

### Error and Output Contract

- `json`: structured success or error only
- `text`: concise human snapshot or confirmation
- `text-progress`: live progress plus final human summary
- `tui`: full-screen or controlled Ink session

Human-readable progress output should not be interleaved with JSON payloads.
Human-readable text modes must remain CI-safe and readable in log streams.
TUI commands must guard terminal readiness before calling Ink. A non-interactive invocation may fall back to `text`, or fail with one clean CLI error line when no snapshot renderer exists yet, but it must never dump an Ink raw-mode stack trace.

### Snapshot Rendering Contract

`text` snapshot mode should preserve the TUI's information hierarchy while dropping interactive chrome.

#### Header

- Use the same header copy as the TUI for the equivalent surface
- Keep the same count/filter language and ordering
- Render one blank line before the header and one blank line after it

Example:

```text

Accounts  3 total · 3 blockchain

```

#### Body

- Render the primary table or summary block immediately after the header
- Do not insert blank lines between table rows
- Keep output compact; static mode is a terminal snapshot, not a prose document
- Do not emulate TUI detail panes, selected-row expansions, or nested detail tables in snapshot mode
- If a command needs detailed non-interactive output, define a dedicated detail subcommand with its own text contract

#### Footer

- Do not render controls bars or interaction hints in static mode
- The shell prompt returning is the natural end of output
- Only render a trailing line like `... and N more (use --limit to adjust)` when truncation actually occurred

#### Whitespace

- one blank line before the header
- one blank line after the header
- no blank lines between rows
- one trailing newline at the end of output

### Text-Progress Rendering Contract

`text-progress` is the default renderer for workflow commands. It is not a spinner plus "done." It is a curated line-oriented stream that preserves operational visibility — the same signal the Ink monitors provide, in a form that works in scrollback, logs, and pipes.

#### Event Categories

The text-progress presenter receives the same event stream as the Ink presenter. It emits three categories of output:

**State changes** — emitted immediately when they occur:

- Provider selected, failover, backoff, rate-limit hit, auth failure, retry exhaustion
- Workflow phase transitions (e.g., "started", "processing", "complete")
- Errors and warnings that require user attention

**Heartbeat summaries** — emitted periodically (every few seconds) during active work:

- Current provider, request rate, items processed, error count, queue depth
- Collapsed into a single line per heartbeat; no cumulative scroll noise

**Final summaries** — emitted once at workflow completion:

- Per-provider stats: requests, failures, average latency, fallback path used
- Workflow totals: items imported/processed/fetched, duration, error count

#### Example Output

```
[import] bitcoin address bc1q... started
[providers] 3 providers ready
[stream:transactions] started · provider=mempool.space
[stream:transactions] 4,280 imported · provider=mempool.space · 2.8 req/s
[provider] mempool.space rate-limited · backoff 1200ms
[provider] failover mempool.space → blockstream
[stream:transactions] 8,940 imported · provider=blockstream · 1.9 req/s
[processing] token-metadata fetched=42 cached=380 · provider=alchemy · 4.1 req/s
[complete] imported=8,940 processed=8,940 duration=00:42
[provider-summary] mempool.space requests=112 failures=3 avg=240ms
[provider-summary] blockstream requests=87 failures=0 avg=180ms
```

#### Design Constraints

- Every line must answer at least one of: is it stuck? which provider? is it failing? how far along?
- State changes are not optional — provider failover and rate-limiting must be visible at default verbosity.
- Heartbeat frequency should be adaptive: more frequent during active fetching, suppressed when idle.
- Low-level request diagnostics belong in logs, not in a generic `--verbose` CLI flag.
- Output must be CI-safe: no cursor control, no ANSI escape sequences beyond basic color, no terminal-width assumptions.
- Human-facing text output should prefer text-style symbols over emoji presentation.

## Migration Plan

### Phase 1: Shared Presentation Primitives

Add a new shared presentation module family:

- `apps/cli/src/features/shared/presentation/`

Expected files:

- `presentation-mode.ts` — `PresentationMode`, `CommandIntent`, `CommandEntrypointRole`
- `command-presentation.ts` — `CommandPresentationSpec`, helper constructors (`snapshotPresentationSpec`, `explorerPresentationSpec`, `workflowPresentationSpec`, `mutatePresentationSpec`, `exportPresentationSpec`), `resolvePresentationMode()`
- `interactive-terminal.ts` — `isInteractiveTerminal()`

Also provide shared option helpers for `--json`, `--text`, and `--tui`, including the mutual-exclusion validation.

Then retire or narrow:

- `apps/cli/src/features/shared/json-mode.ts`

`isJsonMode()` may remain only as a low-level compatibility shim during migration, but it must no longer be the primary decision point.

### Phase 2: Presenter Contracts and Factory

Introduce shared presenter contracts in:

- `apps/cli/src/features/shared/presentation/`

Expected files:

- `workflow-presenter.ts`
- `workflow-presenter-factory.ts`
- `text-progress-presenter.ts`

Do not put feature-specific rendering logic here. Shared code should only define contracts and reusable human-progress primitives.

The existing `EventDrivenController<TEvent>` in `ui/shared/event-driven-controller.ts` already covers most of the Ink presenter surface (`start`, `stop`, `complete`, `abort`, `fail`). The Ink presenter variant should wrap or evolve `EventDrivenController` rather than replacing it from scratch, since three workflow commands already depend on it.

### Phase 3: Workflow Commands

Refactor these commands away from `{ isJsonMode: boolean }` factories and
multi-argument handler constructors:

- `apps/cli/src/features/import/command/import.ts`
- `apps/cli/src/features/import/command/run-import.ts`
- `apps/cli/src/features/reprocess/command/reprocess.ts`
- `apps/cli/src/features/reprocess/command/run-reprocess.ts`
- `apps/cli/src/features/links/command/links-run.ts`
- `apps/cli/src/features/links/command/run-links.ts`
- `apps/cli/src/features/prices/command/prices-enrich.ts`
- `apps/cli/src/features/prices/command/run-prices-enrich.ts`
- `apps/cli/src/features/providers/command/providers-benchmark.ts`
- `apps/cli/src/features/providers/command/providers-benchmark-handler.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/balance/command/balance-handler.ts`

The primary renderer for all workflow commands is now `text-progress`. The Ink presenter remains available via `--tui` but is no longer the default path. This means the text-progress presenter must be built first and must satisfy the rendering contract defined in this spec — it is not a degraded fallback.

Known bug to fix in this phase: `createIngestionInfrastructure` always mounts the Ink `IngestionMonitor` even in JSON mode, unlike `prices enrich` and `links run` which gate the controller on `isJsonMode`. The import command is the highest-priority target for this refactor because it is the only workflow that currently renders TUI in JSON mode.

`balance refresh` must use the same presentation architecture as the other workflow commands. Do not introduce a balance-specific mode resolver, presenter contract, or parallel execution path. The command has scope-dependent result views (single-scope vs all-scope refresh), but scope affects the result shape, not presenter selection. Presenter selection must flow through the same `resolvePresentationMode()` and shared workflow presenter factory used by the rest of the workflow surface.

#### Prerequisite: JSON/TUI Business-Logic Divergence Audit

The current `executeXxxJSON` / `executeXxxTUI` dual-function pattern sometimes contains different business logic between the two paths — not just different rendering. The presenter-injection model only works if presenter choice does not change business behavior. Before unifying any command's two paths into a single handler + injected presenter, audit both paths for logic differences and resolve them. Any divergence is a bug that must be fixed as a prerequisite, not deferred.

Pseudo-code shape after migration:

```ts
await runCommand(appRuntime, async (scope) => {
  const mode = resolvePresentationMode(commandSpec, rawOptions);
  const presenter = createWorkflowPresenter(mode, deps);
  const result = await runWorkflow(scope, params, { presenter });
  if (result.isErr()) throw result.error;
});
```

Exit criteria:

- each workflow command has one execution engine and presenter-selected rendering
- `text-progress` is the default presenter and satisfies the rendering contract (state changes, heartbeats, final summaries)
- `--tui` selects the Ink presenter for users who prefer the dashboard
- `balance refresh` uses the same shared presenter path as the other workflow commands
- no workflow command chooses business logic by presentation mode

### Phase 4: Projection Prereqs

This is the highest-risk phase because prereq rebuilds sit underneath multiple top-level commands and can easily regress output-mode consistency. Do not start this phase until Phase 3 workflow presenters and command-level presentation resolution are stable.

Current hotspot to replace:

- `apps/cli/src/features/shared/consumer-input-readiness.ts`
- `apps/cli/src/features/shared/projection-readiness.ts`
- `apps/cli/src/features/shared/projection-reset.ts`
- `apps/cli/src/features/shared/price-readiness.ts`

Required change:

- replace `isJsonMode` with `presentationMode`
- keep prereq orchestration as explicit command-scope functions rather than a generic runtime registry
- allow prereq rebuilds to use either Ink monitor or text-progress monitor
- preserve a silent machine path for JSON

This is critical for:

- `cost-basis`
- `portfolio`
- future commands that implicitly ensure projections before rendering

Recommended sub-plan:

1. Introduce a prereq monitor contract that accepts `presentationMode` instead of `isJsonMode`.
2. Implement three monitor variants: Ink, line-oriented text-progress, and silent JSON-safe.
3. Keep prereq execution as explicit command-scope functions such as `ensureProcessedTransactionsReady`, `ensureAssetReviewReady`, and `ensureLinksReady`. Do not add a registry/strategy layer back.
4. Migrate one command with projection prereqs first, preferably `cost-basis`, and verify each mode separately.
5. Only then fan the change out to `portfolio` and any other prereq-driven commands.

The projection monitor contract should follow this shape:

```ts
interface PrereqMonitor {
  notifyRebuildStarted(projection: string): void;
  notifyRebuildProgress(projection: string, event: unknown): void;
  notifyRebuildCompleted(projection: string): void;
  notifyRebuildFailed(projection: string, error: Error): void;
}
```

The three variants (Ink, text-progress, silent/JSON) implement this interface.
The prereq layer receives a `PrereqMonitor` instead of `isJsonMode: boolean`.

### Phase 5: Remaining Commands and Cleanup

This phase covers all non-workflow commands. The work is mechanical once the shared resolver and projection runtime are stable.

#### Browse commands

Update browse command registration and handlers to use the shared resolver:

- `accounts view`, `assets view`, `transactions view`, `links view`, `prices view`, `providers view`, `blockchains view`, `portfolio`, `cost-basis`, `balance view`

Rules:

- TUI remains default on terminal
- `--text` produces a readable snapshot
- filters never imply text mode

Prerequisite: Phase 4 must be complete before migrating `cost-basis` and `portfolio`, since these commands trigger projection prereq rebuilds.

#### Destructive review, mutate, and export commands

- `apps/cli/src/features/clear/command/clear.ts`
- `apps/cli/src/features/links/command/links-confirm.ts`
- `apps/cli/src/features/links/command/links-reject.ts`
- `apps/cli/src/features/prices/command/prices-set.ts`
- `apps/cli/src/features/prices/command/prices-set-fx.ts`
- `apps/cli/src/features/assets/command/assets-include.ts`
- `apps/cli/src/features/assets/command/assets-exclude.ts`
- `apps/cli/src/features/assets/command/assets-confirm.ts`
- `apps/cli/src/features/assets/command/assets-clear-review.ts`
- `apps/cli/src/features/assets/command/assets-exclusions.ts`
- `apps/cli/src/features/transactions/command/transactions-export.ts`

Requirements:

- `clear` uses the shared presentation resolver instead of bespoke `json`/confirm branching
- `clear --text` on an interactive terminal remains text preview + stdin confirmation
- mutate/export commands resolve through the same presentation policy API even when they only support `text` and `json`

#### Surface cleanup

Once behavior is stable:

- Remove remaining `isJsonMode()` compatibility branches
- Remove temporary `--no-tui` aliases, if any were introduced during migration
- Update help text to reflect presentation behavior consistently
- Review `assets exclusions` naming (candidates: `assets excluded`, `assets overrides`)

### Verification Gate Per Phase

Each phase must include command-level verification across the modes that command claims to support.

Minimum expectation:

- interactive default path
- `--text`
- `--json`
- `--tui` (workflow commands only)
- non-interactive stdout redirection / CI-safe fallback behavior

No phase is complete until every command touched in that phase has explicit mode-coverage tests or an equivalent command-level verification checklist.

## Acceptance Criteria

- Every command has an explicit intent and presentation policy.
- The migration checklist (Appendix A) covers the full currently registered runnable CLI surface with no omissions.
- Bare namespace browse commands produce useful text snapshots by default.
- Explicit `view` explorer commands still open in TUI by default on an interactive terminal.
- Workflow commands default to `text-progress` on all terminals, with `--tui` opt-in for the Ink dashboard.
- Workflow `text-progress` output satisfies the rendering contract: state changes, heartbeat summaries, final per-provider summaries. It must not be less observable than the current Ink monitors.
- `balance refresh` uses the same shared workflow presenter architecture as the other workflow commands.
- `--text` and `--tui` are the canonical human-output override flags. `--json` remains the only machine-output guarantee.
- `clear` never performs deletion in non-interactive contexts unless `--confirm` is present.
- No handler factory uses `isJsonMode` as its primary branching API.
- The CLI help text reflects presentation behavior consistently.

## Related Specs

- [Links Command README](./links/README.md)
- [Prices Command README](./prices/README.md)
- [Transactions View Spec](./transactions/transactions-view-spec.md)
- [Providers Benchmark Spec](./providers/providers-benchmark-spec.md)
- [Clear View Spec](./clear/clear-view-spec.md)
- [CLI Command Wiring](../../code-assistants/cli-command-wiring.md)

## Decisions & Smells

- Decision: model the surface around command intent plus entrypoint role, not around whether flags were supplied.
- Decision: keep `--json` as the single machine-output switch.
- Decision: keep `text` and `text-progress` as distinct internal renderer categories because snapshot output and workflow progress have different requirements.
- Decision: workflow commands default to `text-progress`, not TUI. The current Ink monitors are progress displays, not interactive apps — full-screen TUI is heavier, harder to copy from, worse in scrollback, and creates more implementation complexity for monitors that have no keyboard interaction. `--tui` opts into the Ink dashboard.
- Decision: bare namespace commands are the canonical text snapshot entrypoints for browse-heavy domains, while `view` is the canonical explorer/TUI verb. `--tui` remains the TUI opt-in for workflow commands. `--json` is machine output. The flags remain mutually exclusive.
- Decision: `text-progress` must preserve operational visibility — provider state changes, heartbeat summaries, and final rollups are not optional. Moving workflows off TUI must not make them less observable.
- Decision: low-level request diagnostics and stack traces belong in logs, not in a generic CLI verbosity flag.
- Decision: `clear` fails closed in CI and other non-interactive contexts; preview without `--confirm` is an error path, not a silent no-op success.
- Decision: `destructive-review` remains a narrow intent reserved for review-gated safety flows, not a generic label for dangerous mutations.
- Decision: `clear --text` on an interactive terminal renders text preview + stdin confirmation prompt. It does not exit non-zero, because the user is present.
- Decision: `CommandPresentationSpec` is co-located with each command, not centralized in a registry map.
- Decision: `balance refresh` is a workflow, `balance view` is the browser. The refresh command should not open a full-screen app by default.
- Smell: `isJsonMode` is an underspecified abstraction and has spread too deeply into handlers and projection prereq code.
- Smell: `destructive-review` is still a category of one today, so the admission rule needs to stay explicit or future commands will get misclassified.
- Smell: the `executeXxxJSON` / `executeXxxTUI` dual-function pattern may hide business-logic divergence between modes. Each must be audited before unification.
- Smell: `createIngestionInfrastructure` always mounts the Ink `IngestionMonitor` even in JSON mode — the only workflow command with this bug.
- Smell: `cost-basis` mixes "report" and "browser" semantics in one command. The name reads like an action ("calculate cost basis"), but the TUI is a browse surface. Strongest candidate for a future `cost-basis` (report) + `cost-basis view` (browser) split, but out of scope for this migration.
- Naming issue: `textOverrideMode` was misleading because it can resolve to `text-progress`; `nonTuiOverrideMode` is more accurate.
- Smell: `assets exclusions` is a low-signal command name and likely does not match the rest of the surface.

### Smell Mitigations Required by This Plan

- `isJsonMode` spread: addressed by Phases 1, 3, 4, and 5. The shim may exist temporarily, but every runnable command must migrate off it before completion.
- `destructive-review` singleton risk: addressed by the narrow admission rule in Definitions plus Phase 5, which keeps `clear` inside the shared presentation system instead of preserving a bespoke branch.
- JSON/TUI business-logic divergence: addressed by the mandatory divergence audit in Phase 3 before any workflow unification lands. The migration checklist (Appendix A) tracks which commands have been audited.
- `createIngestionInfrastructure` JSON bug: addressed explicitly in Phase 3 as the first workflow bug fix.
- `assets exclusions` naming smell: addressed in Phase 5 cleanup only after behavioral migration stabilizes.

### Resolved Decisions (from review)

- **`isInteractiveTerminal()` stderr:** Decided to check `stdin` + `stdout` only. stderr piping is a legitimate terminal use case.
- **`transactions export` intent:** Confirmed as `export`. Today's implementation is a non-interactive file writer. If a future version adds interactive format selection, reclassify at that time.

## Appendix A: Migration Checklist

This checklist tracks per-command migration status across the full runnable CLI surface. No command may be omitted. Update as each command is migrated.

| Command               | Registration file                             | Current branching      | Target intent        | Divergence audited | Migrated | Phase |
| --------------------- | --------------------------------------------- | ---------------------- | -------------------- | ------------------ | -------- | ----- |
| `import`              | `import/command/import.ts`                    | `isJsonMode` dual-fn   | `workflow`           | [ ]                | [ ]      | 3     |
| `reprocess`           | `reprocess/command/reprocess.ts`              | `isJsonMode` dual-fn   | `workflow`           | [ ]                | [ ]      | 3     |
| `links run`           | `links/command/links-run.ts`                  | `isJsonMode` dual-fn   | `workflow`           | [ ]                | [ ]      | 3     |
| `prices enrich`       | `prices/command/prices-enrich.ts`             | `isJsonMode` dual-fn   | `workflow`           | [ ]                | [ ]      | 3     |
| `providers benchmark` | `providers/command/providers-benchmark.ts`    | `isJsonMode` dual-fn   | `workflow`           | [ ]                | [ ]      | 3     |
| `balance refresh`     | `balance/command/balance-refresh.ts`          | `isJsonMode` dual-fn   | `workflow`           | [ ]                | [ ]      | 3     |
| `accounts view`       | `accounts/command/accounts-view.ts`           | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `transactions view`   | `transactions/command/transactions-view.ts`   | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `links view`          | `links/command/links-view.ts`                 | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `prices view`         | `prices/command/prices-view.ts`               | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `providers view`      | `providers/command/providers-view.ts`         | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `blockchains view`    | `blockchains/command/blockchains-view.ts`     | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `assets view`         | `assets/command/assets-view.ts`               | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `portfolio`           | `portfolio/command/portfolio.ts`              | `isJsonMode` dual-fn   | `browse`             | [ ]                | [ ]      | 5     |
| `cost-basis`          | `cost-basis/command/cost-basis.ts`            | `isJsonMode` dual-fn   | `browse`             | [ ]                | [ ]      | 5     |
| `balance view`        | `balance/command/balance-view.ts`             | `isJsonMode` inline    | `browse`             | —                  | [ ]      | 5     |
| `clear`               | `clear/command/clear.ts`                      | `isJsonMode` + confirm | `destructive-review` | [ ]                | [ ]      | 5     |
| `links confirm`       | `links/command/links-confirm.ts`              | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `links reject`        | `links/command/links-reject.ts`               | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `prices set`          | `prices/command/prices-set.ts`                | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `prices set-fx`       | `prices/command/prices-set-fx.ts`             | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `assets include`      | `assets/command/assets-include.ts`            | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `assets exclude`      | `assets/command/assets-exclude.ts`            | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `assets confirm`      | `assets/command/assets-confirm.ts`            | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `assets clear-review` | `assets/command/assets-clear-review.ts`       | `isJsonMode` inline    | `mutate`             | —                  | [ ]      | 5     |
| `assets exclusions`   | `assets/command/assets-exclusions.ts`         | `isJsonMode` inline    | `export`             | —                  | [ ]      | 5     |
| `transactions export` | `transactions/command/transactions-export.ts` | `isJsonMode` inline    | `export`             | —                  | [ ]      | 5     |

All file paths are relative to `apps/cli/src/features/`. "Divergence audited" applies to commands with dual `executeXxxJSON`/`executeXxxTUI` functions — inline-branching commands with trivial JSON output do not need a formal audit (marked `—`).

---

_Last updated: 2026-03-15_
