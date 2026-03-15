---
last_verified: 2026-03-15
status: draft
---

# CLI Surface V2 Specification

> Code is law: if this document disagrees with implementation, the implementation is correct and this spec must be updated.

This spec defines the command taxonomy, presentation mode rules, naming conventions, and migration plan for the Exitbook CLI. It sits above the existing per-command specs and resolves the current ambiguity between TUI and non-TUI behavior.

## Quick Reference

| Concept                | Rule                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `--json`               | Always machine output; never launches TUI                     |
| Browse flags           | Narrow initial state; do not force non-TUI                    |
| Human non-TUI output   | Uses `text` or `text-progress` internally, selected by intent |
| Long-running workflows | One execution engine, multiple renderers                      |
| `--text`               | Canonical non-TUI override for human-readable output          |
| One-shot mutations     | Stay simple by default; no TUI unless explicitly justified    |

## Goals

- Make command behavior predictable across TUI, human-readable text, and JSON contexts.
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
- "Non-TUI" is not a useful internal product concept because it conflates snapshot output with live progress output.

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

### Interactive Terminal

A command is considered interactive when all of the following are true:

- `process.stdin.isTTY === true`
- `process.stdout.isTTY === true`
- `process.env.CI` is not set (any non-empty string is truthy)

`stderr` is not checked. Redirecting stderr (`exitbook transactions view 2>error.log`) is a legitimate terminal use case — the TUI renders on stdout and reads input from stdin, so stderr piping should not force a fallback.

Common edge case: `exitbook transactions view | head` is non-interactive for presentation purposes because `stdout` is piped, even if `stdin` is still a TTY. That command must fall back to non-TUI output.

## Surface Model

### Core Rule

The CLI has two human-readable text renderer categories plus TUI:

- `text`
- `text-progress`
- `tui`

`json` remains the machine-facing mode.

Users do not choose between `text` and `text-progress` directly. Command intent selects which text renderer applies when a command runs outside TUI, either because the terminal is non-interactive or because the user requested `--text`.

### Browse Commands May Trigger Workflow-Style Prereqs

Some browse commands (`cost-basis`, `portfolio`, `balance view`) implicitly rebuild upstream projections (processed transactions, links, price coverage) before rendering. When a browse command triggers a prereq rebuild, the rebuild uses its own presenter selected by the current presentation mode — it does not inherit the browse command's static text renderer. This means a `cost-basis --text` invocation may emit `text-progress` output for stale projections before printing the final text snapshot.

This is intentional: the prereq rebuild is a workflow sub-operation with different rendering needs than the parent browse command. Phase 4 of the migration plan formalizes this by introducing a projection monitor contract.

### Command Taxonomy

| Command               | Intent               | Default on interactive terminal | Default off terminal / CI                                                    |
| --------------------- | -------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `accounts view`       | `browse`             | `tui`                           | `text`                                                                       |
| `transactions view`   | `browse`             | `tui`                           | `text`                                                                       |
| `links view`          | `browse`             | `tui`                           | `text`                                                                       |
| `prices view`         | `browse`             | `tui`                           | `text`                                                                       |
| `providers view`      | `browse`             | `tui`                           | `text`                                                                       |
| `blockchains view`    | `browse`             | `tui`                           | `text`                                                                       |
| `assets view`         | `browse`             | `tui`                           | `text`                                                                       |
| `portfolio`           | `browse`             | `tui`                           | `text`                                                                       |
| `cost-basis`          | `browse`             | `tui`                           | `text`                                                                       |
| `balance view`        | `browse`             | `tui`                           | `text`                                                                       |
| `balance refresh`     | `workflow`           | `tui`                           | `text-progress`                                                              |
| `import`              | `workflow`           | `tui`                           | `text-progress`                                                              |
| `reprocess`           | `workflow`           | `tui`                           | `text-progress`                                                              |
| `links run`           | `workflow`           | `tui`                           | `text-progress`                                                              |
| `prices enrich`       | `workflow`           | `tui`                           | `text-progress`                                                              |
| `providers benchmark` | `workflow`           | `tui`                           | `text-progress`                                                              |
| `links confirm`       | `mutate`             | `text`                          | `text`                                                                       |
| `links reject`        | `mutate`             | `text`                          | `text`                                                                       |
| `prices set`          | `mutate`             | `text`                          | `text`                                                                       |
| `prices set-fx`       | `mutate`             | `text`                          | `text`                                                                       |
| `assets include`      | `mutate`             | `text`                          | `text`                                                                       |
| `assets exclude`      | `mutate`             | `text`                          | `text`                                                                       |
| `assets confirm`      | `mutate`             | `text`                          | `text`                                                                       |
| `assets clear-review` | `mutate`             | `text`                          | `text`                                                                       |
| `assets exclusions`   | `export`             | `text`                          | `text`                                                                       |
| `transactions export` | `export`             | `text`                          | `text`                                                                       |
| `clear`               | `destructive-review` | `tui`                           | `text` preview only; execution requires `--confirm`, otherwise exit non-zero |

## Mode Selection Rules

### Precedence

Mode resolution follows this order:

1. `--json`
2. `--text`
3. command-intent default
4. fallback safety rule

### Override Flags

This spec standardizes one explicit human-output override:

- `--text`

`--text` means "render human-readable output without TUI." Command intent then determines whether that renderer is `text` or `text-progress`.

This spec does not standardize `--tui` as a canonical public flag. For commands where TUI is appropriate, it is already the default on an interactive terminal, so a force-TUI flag is redundant unless a concrete use case emerges later.

`--no-tui` is not the preferred surface because it describes implementation rather than output behavior. It may exist as a temporary compatibility alias for `--text` during migration, but it is not the canonical flag.

### Resolution Algorithm

```ts
function resolvePresentationMode(spec: CommandPresentationSpec, options: RawOptions): PresentationMode {
  if (options.json === true) return 'json';

  if (options.text === true) {
    return spec.nonTuiOverrideMode;
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

This resolves the top-level command's presentation mode. Browse commands that trigger upstream projection rebuilds (e.g., `cost-basis`, `portfolio`) may internally use a `text-progress` presenter for those sub-operations even when the parent command resolves to `text`. The projection monitor contract in Phase 4 governs that behavior — the resolver above does not override it.

### Fallback Safety Rules

- `browse` commands off-terminal must not try to mount Ink. They render a text snapshot instead.
- `workflow` commands off-terminal must not silently degrade to a bare success line. They render progress and completion in `text-progress`.
- Both `text` and `text-progress` must be CI-safe, line-oriented terminal output. They must not depend on cursor control, spinners, or full-screen terminal behavior.
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
  interactiveDefaultMode: Extract<PresentationMode, 'tui' | 'text' | 'text-progress'>;
  nonTuiOverrideMode: Extract<PresentationMode, 'text' | 'text-progress'>;
  fallbackNonInteractiveMode: Extract<PresentationMode, 'text' | 'text-progress'>;
}
```

Each command must define its spec as a const export co-located with the command registration. The shared resolver consumes these directly — there is no central registry map. A registry is unnecessary because `resolvePresentationMode` receives the spec from the caller; it does not look it up by name.

### Renderer Split

Workflow handlers must expose one execution engine and multiple presenters.

```ts
interface WorkflowPresenter<TEvent, TResult> {
  /** Must resolve before onEvent() is called. Sets up the rendering surface. */
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
Human-readable text modes must remain CI-safe and readable in log streams.

## File-Level Migration Plan

### Phase 1: Shared Presentation Resolver

Add a new shared module:

- `apps/cli/src/features/shared/command-presentation.ts`

Responsibilities:

- define `PresentationMode`
- define `CommandIntent`
- implement `isInteractiveTerminal()`
- implement `resolvePresentationMode()`
- provide shared option helpers for `--json` and `--text`

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

The existing `EventDrivenController<TEvent>` in `ui/shared/event-driven-controller.ts` already covers most of the Ink presenter surface (`start`, `stop`, `complete`, `abort`, `fail`). The Ink presenter variant should wrap or evolve `EventDrivenController` rather than replacing it from scratch, since three workflow commands already depend on it.

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

Known bug to fix in this phase: `createIngestionInfrastructure` always mounts the Ink `IngestionMonitor` even in JSON mode, unlike `prices enrich` and `links run` which gate the controller on `isJsonMode`. The import command is the highest-priority target for this refactor because it is the only workflow that currently renders TUI in JSON mode.

Pseudo-code shape:

```ts
const mode = resolvePresentationMode(commandSpec, rawOptions);
const presenter = createWorkflowPresenter(mode, deps);
const handler = await createWorkflowHandler(ctx, db, { presenter });
await handler.execute(params);
```

### Migration Risk: JSON/TUI Business-Logic Divergence

The current `executeXxxJSON` / `executeXxxTUI` dual-function pattern sometimes contains different business logic between the two paths — not just different rendering. The presenter-injection model only works if presenter choice does not change business behavior. Before unifying any command's two paths into a single handler + injected presenter, audit both paths for logic differences and resolve them. Any divergence is a bug that must be fixed as a prerequisite, not deferred.

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

This is the highest-risk migration phase because prereq rebuilds sit underneath multiple top-level commands and can easily regress output-mode consistency. Do not start this phase until workflow presenters and command-level presentation resolution are already stable.

Recommended sub-plan:

1. Introduce a projection monitor contract that accepts `presentationMode` instead of `isJsonMode`.
2. Implement three monitor variants: Ink, line-oriented text-progress, and silent JSON-safe.
3. Migrate one command with projection prereqs first, preferably `cost-basis`, and verify each mode separately.
4. Only then fan the change out to `portfolio` and any other prereq-driven commands.

The projection monitor contract should follow this shape:

```ts
interface ProjectionMonitor {
  notifyRebuildStarted(projection: string): void;
  notifyRebuildProgress(projection: string, event: unknown): void;
  notifyRebuildCompleted(projection: string): void;
}
```

The three variants (Ink, text-progress, silent/JSON) implement this interface. The projection runtime receives a `ProjectionMonitor` instead of `isJsonMode: boolean`.

### Phase 5: Refactor Browse Commands

Update browse command registration and handlers to use the same shared resolver:

- `accounts view`
- `assets view`
- `transactions view`
- `links view`
- `prices view`
- `providers view`
- `blockchains view`
- `portfolio`
- `cost-basis`
- `balance view`

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
- `--text` is the only canonical human-readable override flag.
- `clear` never performs deletion in non-interactive contexts unless `--confirm` is present.
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
- Decision: keep `text` and `text-progress` as distinct internal renderer categories because snapshot output and workflow progress have different requirements.
- Decision: expose only `--text` as the canonical non-TUI override; do not standardize `--tui` unless a real forcing use case appears.
- Decision: `clear` fails closed in CI and other non-interactive contexts; preview without `--confirm` is an error path, not a silent no-op success.
- Decision: `destructive-review` remains a narrow intent reserved for review-gated safety flows, not a generic label for dangerous mutations.
- Decision: `clear --text` on an interactive terminal renders text preview + stdin confirmation prompt. It does not exit non-zero, because the user is present.
- Decision: `CommandPresentationSpec` is co-located with each command, not centralized in a registry map.
- Smell: `isJsonMode` is an underspecified abstraction and has spread too deeply into handlers and projection prereq code.
- Smell: `destructive-review` is still a category of one today, so the admission rule needs to stay explicit or future commands will get misclassified.
- Smell: the `executeXxxJSON` / `executeXxxTUI` dual-function pattern may hide business-logic divergence between modes. Each must be audited before unification.
- Smell: `createIngestionInfrastructure` always mounts the Ink `IngestionMonitor` even in JSON mode — the only workflow command with this bug.
- Naming issue: `textOverrideMode` was misleading because it can resolve to `text-progress`; `nonTuiOverrideMode` is more accurate.
- Smell: `assets exclusions` is a low-signal command name and likely does not match the rest of the surface.

### Resolved Decisions (from review)

- **`isInteractiveTerminal()` stderr:** Decided to check `stdin` + `stdout` only. stderr piping is a legitimate terminal use case.
- **`transactions export` intent:** Confirmed as `export`. Today's implementation is a non-interactive file writer. If a future version adds interactive format selection, reclassify at that time.

---

_Last updated: 2026-03-15_
