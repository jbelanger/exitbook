---
last_verified: 2026-03-10
status: draft
---

# CLI Surface V2 Specification

> Code is law: if this document disagrees with implementation, the implementation is correct and this spec must be updated.

This spec defines the command taxonomy, presentation mode rules, naming conventions, and migration plan for the Exitbook CLI. It sits above the existing per-command specs and resolves the current ambiguity between TUI and non-TUI behavior.

## Quick Reference

| Concept                | Rule                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `--json`               | Always machine output; never launches TUI                  |
| Browse flags           | Narrow initial state; do not force non-TUI                 |
| Human non-TUI output   | Split into `text` and `text-progress`                      |
| Long-running workflows | One execution engine, multiple renderers                   |
| One-shot mutations     | Stay simple by default; no TUI unless explicitly justified |

## Goals

- Make command behavior predictable across TUI, text, and JSON contexts.
- Stop treating "has flags" as a proxy for "should not use TUI".
- Separate execution logic from rendering logic for workflow commands.
- Preserve scriptability without degrading interactive review flows.
- Define naming rules so new commands fit the surface without ad hoc exceptions.

## Non-Goals

- Redesign the visual layout of existing TUIs.
- Rename every current command in one pass.
- Introduce backward-compatibility aliases unless they materially reduce migration risk.
- Specify per-command keyboard behavior already covered by existing view specs.

## Problem Statement

The current CLI mostly uses a binary output model:

- `--json` => JSON
- everything else => TUI or ad hoc text

That model is too coarse.

- Browse commands need filters and still should open in TUI.
- Long-running workflows need live progress in both interactive and non-interactive contexts.
- One-shot action commands should remain fast, plain, and legible without requiring TUI.
- "Non-TUI" is not a useful product concept because it conflates snapshot output with live progress output.

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

### Presentation Mode

The output frontend selected for a command execution.

```ts
type PresentationMode = 'json' | 'text' | 'text-progress' | 'tui';
```

- `json`: structured machine output only
- `text`: human-readable snapshot or confirmation output
- `text-progress`: human-readable progress updates during a running workflow
- `tui`: interactive Ink application

### Interactive Terminal

A command is considered interactive when all of the following are true:

- `process.stdin.isTTY === true`
- `process.stdout.isTTY === true`
- `process.stderr.isTTY === true`
- `process.env.CI` is not set to a truthy CI environment marker

This is stricter than checking only `stdout.isTTY`. TUI commands require a real terminal, not just a writable stream.

## Surface Model

### Core Rule

The CLI has three human-facing presentation modes, not one:

- `text`
- `text-progress`
- `tui`

`json` remains the machine-facing mode.

### Command Taxonomy

| Command               | Intent               | Default on interactive terminal | Default off terminal / CI                                 |
| --------------------- | -------------------- | ------------------------------- | --------------------------------------------------------- |
| `accounts view`       | `browse`             | `tui`                           | `text`                                                    |
| `transactions view`   | `browse`             | `tui`                           | `text`                                                    |
| `links view`          | `browse`             | `tui`                           | `text`                                                    |
| `prices view`         | `browse`             | `tui`                           | `text`                                                    |
| `providers view`      | `browse`             | `tui`                           | `text`                                                    |
| `blockchains view`    | `browse`             | `tui`                           | `text`                                                    |
| `portfolio`           | `browse`             | `tui`                           | `text`                                                    |
| `cost-basis`          | `browse`             | `tui`                           | `text`                                                    |
| `balance`             | `browse`             | `tui`                           | `text-progress` for verification, then `text` summary     |
| `import`              | `workflow`           | `tui`                           | `text-progress`                                           |
| `reprocess`           | `workflow`           | `tui`                           | `text-progress`                                           |
| `links run`           | `workflow`           | `tui`                           | `text-progress`                                           |
| `prices enrich`       | `workflow`           | `tui`                           | `text-progress`                                           |
| `providers benchmark` | `workflow`           | `tui`                           | `text-progress`                                           |
| `links confirm`       | `mutate`             | `text`                          | `text`                                                    |
| `links reject`        | `mutate`             | `text`                          | `text`                                                    |
| `prices set`          | `mutate`             | `text`                          | `text`                                                    |
| `prices set-fx`       | `mutate`             | `text`                          | `text`                                                    |
| `assets include`      | `mutate`             | `text`                          | `text`                                                    |
| `assets exclude`      | `mutate`             | `text`                          | `text`                                                    |
| `assets exclusions`   | `export`             | `text`                          | `text`                                                    |
| `transactions export` | `export`             | `text`                          | `text`                                                    |
| `clear`               | `destructive-review` | `tui`                           | `text` preview only; execution still requires `--confirm` |

## Mode Selection Rules

### Precedence

Mode resolution follows this order:

1. `--json`
2. explicit presentation override flag
3. command-intent default
4. fallback safety rule

### Override Flags

This spec standardizes two explicit human-output overrides:

- `--tui`
- `--text`

`--no-tui` is not the preferred surface because it does not distinguish `text` from `text-progress`. It may exist as a temporary compatibility alias for `--text` during migration, but it is not the canonical flag.

### Resolution Algorithm

```ts
function resolvePresentationMode(spec: CommandPresentationSpec, options: RawOptions): PresentationMode {
  if (options.json === true) return 'json';

  if (options.tui === true) {
    if (!spec.supportsTui) throw new Error('This command does not support --tui');
    if (!isInteractiveTerminal()) throw new Error('--tui requires an interactive terminal');
    return 'tui';
  }

  if (options.text === true) {
    return spec.textOverrideMode;
  }

  if (spec.intent === 'mutate' || spec.intent === 'export') {
    return 'text';
  }

  if (!isInteractiveTerminal()) {
    return spec.fallbackNonInteractiveMode;
  }

  return spec.interactiveDefaultMode;
}
```

### Fallback Safety Rules

- `browse` commands off-terminal must not try to mount Ink. They render a text snapshot instead.
- `workflow` commands off-terminal must not silently degrade to a bare success line. They render progress and completion in `text-progress`.
- Explicit `--tui` on a non-interactive terminal is an error, not a silent downgrade.
- `--json` remains the only mode intended for machine parsing.

## Flag Semantics

### Browse Commands

Flags narrow the initial state. They do not imply a non-TUI path.

Examples:

- `transactions view --asset BTC` means "open the transaction browser scoped to BTC"
- `prices view --missing-only --source kraken` means "open the missing-price browser scoped to Kraken"
- `cost-basis --asset ETH` means "calculate as requested, then land directly on ETH details"

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
- `--confirm`: skip review and execute immediately
- Off-terminal without `--confirm`: render text preview and exit non-destructively
- `--json`: render structured preview or result depending on the action path

## Input Collection Rules

Prompting and presentation are separate concerns.

- Missing required parameters may be gathered interactively when the command explicitly supports prompt-driven input.
- Prompt-driven input requires an interactive terminal.
- Prompt collection happens before a workflow TUI takes over.
- Browse filters are never collected through prompts when sensible defaults already exist.

Current command policy:

| Command           | Prompt policy                                                                           |
| ----------------- | --------------------------------------------------------------------------------------- |
| `cost-basis`      | Prompt for missing method/jurisdiction/year inputs on terminal                          |
| `links run`       | Prompt only when threshold flags are omitted and interactive prompting is still desired |
| `import`          | No general prompt flow; confirmation only for special warnings                          |
| `prices enrich`   | No manual price prompts in workflow mode                                                |
| `browse` commands | No prompts; flags only                                                                  |

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
| `view`                | Open a browse/review surface           |
| `run`                 | Execute a workflow process             |
| `enrich`              | Execute a named domain workflow        |
| `benchmark`           | Run a measurement workflow             |
| `export`              | Emit report/file output                |
| `set`                 | Write one explicit value               |
| `confirm` / `reject`  | Resolve a suggested state change       |
| `include` / `exclude` | Toggle accounting policy or visibility |

Avoid introducing additional near-synonyms unless a domain has a materially different workflow.

## Shared Implementation Shape

### Required Abstractions

Replace the current boolean `isJsonMode` branching with explicit presentation contracts.

```ts
type CommandIntent = 'browse' | 'workflow' | 'mutate' | 'destructive-review' | 'export';

interface CommandPresentationSpec {
  commandId: string;
  intent: CommandIntent;
  supportsTui: boolean;
  interactiveDefaultMode: Extract<PresentationMode, 'tui' | 'text' | 'text-progress'>;
  textOverrideMode: Extract<PresentationMode, 'text' | 'text-progress'>;
  fallbackNonInteractiveMode: Extract<PresentationMode, 'text' | 'text-progress'>;
}
```

### Renderer Split

Workflow handlers must expose one execution engine and multiple presenters.

```ts
interface WorkflowPresenter<TEvent, TResult> {
  start(): Promise<void>;
  onEvent(event: TEvent): void;
  succeed(result: TResult): Promise<void>;
  fail(error: Error): Promise<void>;
  abort(): void;
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

## File-Level Migration Plan

### Phase 1: Shared Presentation Resolver

Add a new shared module:

- `apps/cli/src/features/shared/command-presentation.ts`

Responsibilities:

- define `PresentationMode`
- define `CommandIntent`
- implement `isInteractiveTerminal()`
- implement `resolvePresentationMode()`
- provide shared option helpers for `--json`, `--tui`, and `--text`

Then retire or narrow:

- `apps/cli/src/features/shared/utils.ts`

`isJsonMode()` may remain only as a low-level compatibility shim during migration, but it must no longer be the primary decision point.

### Phase 2: Shared Presenter Interfaces

Introduce shared presenter contracts in:

- `apps/cli/src/features/shared/presentation/`

Expected files:

- `presentation-mode.ts`
- `workflow-presenter.ts`
- `text-progress-presenter.ts`

Do not put feature-specific rendering logic here. Shared code should only define contracts and reusable human-progress primitives.

### Phase 3: Refactor Workflow Commands First

Refactor these commands away from `{ isJsonMode: boolean }` factories:

- `apps/cli/src/features/import/command/import.ts`
- `apps/cli/src/features/import/command/import-handler.ts`
- `apps/cli/src/features/reprocess/command/reprocess.ts`
- `apps/cli/src/features/reprocess/command/reprocess-handler.ts`
- `apps/cli/src/features/links/command/links-run.ts`
- `apps/cli/src/features/links/command/links-run-handler.ts`
- `apps/cli/src/features/prices/command/prices-enrich.ts`
- `apps/cli/src/features/prices/command/prices-enrich-handler.ts`
- `apps/cli/src/features/providers/command/providers-benchmark.ts`
- `apps/cli/src/features/providers/command/providers-benchmark-handler.ts`

Pseudo-code shape:

```ts
const mode = resolvePresentationMode(commandSpec, rawOptions);
const presenter = createWorkflowPresenter(mode, deps);
const handler = await createWorkflowHandler(ctx, db, { presenter });
await handler.execute(params);
```

### Phase 4: Refactor Projection Prereqs

Update:

- `apps/cli/src/features/shared/projection-runtime.ts`

Required change:

- replace `isJsonMode` with `presentationMode`
- allow prereq rebuilds to use either Ink monitor or text-progress monitor
- preserve a silent machine path for JSON

This is critical for:

- `cost-basis`
- `portfolio`
- future commands that implicitly ensure projections before rendering

### Phase 5: Refactor Browse Commands

Update browse command registration and handlers to use the same shared resolver:

- `accounts view`
- `transactions view`
- `links view`
- `prices view`
- `providers view`
- `blockchains view`
- `portfolio`
- `cost-basis`
- `balance`

Rules:

- TUI remains default on terminal
- `--text` produces a readable snapshot
- filters never imply text mode

### Phase 6: Surface Cleanup and Rename Review

Once behavior is stable, review the public names and help text.

Likely candidates:

- `assets exclusions`

Possible replacements:

- `assets excluded`
- `assets overrides`
- `assets overrides list`

This rename should happen only after mode behavior is stable so naming work does not get mixed with rendering refactors.

## Acceptance Criteria

- Every command has an explicit intent and presentation policy.
- Browse commands with filters still open in TUI by default on an interactive terminal.
- Workflow commands can run with TUI, text-progress, or JSON without duplicating business logic.
- No handler factory uses `isJsonMode` as its primary branching API.
- `--json` remains the only machine-output guarantee.
- The CLI help text reflects presentation behavior consistently.

## Related Specs

- [Links Command README](./links/README.md)
- [Prices Command README](./prices/README.md)
- [Transactions View Spec](./transactions/transactions-view-spec.md)
- [Providers Benchmark Spec](./providers/providers-benchmark-spec.md)
- [Clear View Spec](./clear/clear-view-spec.md)
- [CLI Command Wiring](../../code-assistants/cli-command-wiring.md)

## Decisions & Smells

- Decision: model the surface around command intent, not around whether flags were supplied.
- Decision: keep `--json` as the single machine-output switch.
- Decision: standardize on `text`, `text-progress`, and `tui` as first-class human presentation modes.
- Smell: `isJsonMode` is an underspecified abstraction and has spread too deeply into handlers and projection prereq code.
- Smell: `assets exclusions` is a low-signal command name and likely does not match the rest of the surface.

---

_Last updated: 2026-03-10_
