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
| Browse flags           | Narrow initial state; do not force text mode                  |
| Human text output      | Uses `text` or `text-progress` internally, selected by intent |
| Long-running workflows | One execution engine, multiple renderers                      |
| `--text`               | Canonical non-TUI override for human-readable output          |
| One-shot mutations     | Stay simple by default; no TUI unless explicitly justified    |
| `--json` + `--text`    | Mutually exclusive; CLI exits with validation error           |
| Acceptance scope       | Applies to the full currently registered CLI surface          |

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

This spec applies to the full currently registered runnable CLI surface, not only to TUI-heavy commands or to commands touched during an initial migration slice. The migration plan and acceptance criteria must therefore cover every currently registered runnable command.

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

This is intentional: the prereq rebuild is a workflow sub-operation with different rendering needs than the parent browse command. Phase 5 of the migration plan formalizes this by introducing a projection monitor contract.

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

The taxonomy table above is exhaustive for the current runnable CLI surface. Top-level namespace commands such as `accounts`, `assets`, `balance`, `blockchains`, `links`, `prices`, `providers`, and `transactions` are grouping commands, not standalone execution targets, so they are not assigned intents separately.

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

For `mutate` and `export` commands, `--text` is a no-op because these commands already default to `text` in all contexts. Implementations should accept the flag silently rather than erroring, but should not register special `--text` handling for these intents.

This spec does not standardize `--tui` as a canonical public flag. For commands where TUI is appropriate, it is already the default on an interactive terminal, so a force-TUI flag is redundant unless a concrete use case emerges later.

`--no-tui` is not the preferred surface because it describes implementation rather than output behavior. It may exist as a temporary compatibility alias for `--text` during migration, but it is not the canonical flag.

### Flag Conflicts

`--json` and `--text` are mutually exclusive. If both are passed, the CLI must exit with a validation error and a clear message. Silent precedence would mask user confusion.

### Resolution Algorithm

```ts
function resolvePresentationMode(spec: CommandPresentationSpec, options: RawOptions): PresentationMode {
  if (options.json === true && options.text === true) {
    throw new Error('--json and --text are mutually exclusive');
  }

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

This resolves the top-level command's presentation mode. Browse commands that trigger upstream projection rebuilds (e.g., `cost-basis`, `portfolio`) may internally use a `text-progress` presenter for those sub-operations even when the parent command resolves to `text`. The projection monitor contract in Phase 5 governs that behavior — the resolver above does not override it.

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
| `enrich`              | Fill gaps in existing domain data      |
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
  /** Identifies the command in diagnostics and logging; not used by the resolver. */
  commandId: string;
  intent: CommandIntent;
  interactiveDefaultMode: Extract<PresentationMode, 'tui' | 'text' | 'text-progress'>;
  nonTuiOverrideMode: Extract<PresentationMode, 'text' | 'text-progress'>;
  fallbackNonInteractiveMode: Extract<PresentationMode, 'text' | 'text-progress'>;
}
```

Each command must define its spec as a const export co-located with the command registration. The shared resolver consumes these directly — there is no central registry map. A registry is unnecessary because `resolvePresentationMode` receives the spec from the caller; it does not look it up by name.

For commands with fixed presentation behavior, use intent-based helper constructors to eliminate boilerplate:

```ts
function browsePresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'browse',
    interactiveDefaultMode: 'tui',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

function workflowPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'workflow',
    interactiveDefaultMode: 'tui',
    nonTuiOverrideMode: 'text-progress',
    fallbackNonInteractiveMode: 'text-progress',
  };
}

function mutatePresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'mutate',
    interactiveDefaultMode: 'text',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

function exportPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'export',
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

## Migration Plan

### Phase 1: Shared Presentation Primitives

Add a new shared presentation module family:

- `apps/cli/src/features/shared/presentation/`

Expected files:

- `presentation-mode.ts` — `PresentationMode`, `CommandIntent`
- `command-presentation.ts` — `CommandPresentationSpec`, intent-based helper constructors (`browsePresentationSpec`, `workflowPresentationSpec`, `mutatePresentationSpec`, `exportPresentationSpec`), `resolvePresentationMode()`
- `interactive-terminal.ts` — `isInteractiveTerminal()`

Also provide shared option helpers for `--json` and `--text`, including the mutual-exclusion validation.

Then retire or narrow:

- `apps/cli/src/features/shared/utils.ts`

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
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/balance/command/balance-handler.ts`

Known bug to fix in this phase: `createIngestionInfrastructure` always mounts the Ink `IngestionMonitor` even in JSON mode, unlike `prices enrich` and `links run` which gate the controller on `isJsonMode`. The import command is the highest-priority target for this refactor because it is the only workflow that currently renders TUI in JSON mode.

`balance refresh` must use the same presentation architecture as the other workflow commands. Do not introduce a balance-specific mode resolver, presenter contract, or parallel execution path. The command has scope-dependent result views (single-scope vs all-scope refresh), but scope affects the result shape, not presenter selection. Presenter selection must flow through the same `resolvePresentationMode()` and shared workflow presenter factory used by the rest of the workflow surface.

#### Prerequisite: JSON/TUI Business-Logic Divergence Audit

The current `executeXxxJSON` / `executeXxxTUI` dual-function pattern sometimes contains different business logic between the two paths — not just different rendering. The presenter-injection model only works if presenter choice does not change business behavior. Before unifying any command's two paths into a single handler + injected presenter, audit both paths for logic differences and resolve them. Any divergence is a bug that must be fixed as a prerequisite, not deferred.

Pseudo-code shape after migration:

```ts
const mode = resolvePresentationMode(commandSpec, rawOptions);
const presenter = createWorkflowPresenter(mode, deps);
const handler = await createWorkflowHandler(ctx, db, { presenter });
await handler.execute(params);
```

Exit criteria:

- each workflow command has one execution engine and presenter-selected rendering
- `balance refresh` uses the same shared presenter path as the other workflow commands
- no workflow command chooses business logic by `isJsonMode`

### Phase 4: Projection Prereqs

This is the highest-risk phase because prereq rebuilds sit underneath multiple top-level commands and can easily regress output-mode consistency. Do not start this phase until Phase 3 workflow presenters and command-level presentation resolution are stable.

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
  notifyRebuildFailed(projection: string, error: Error): void;
}
```

The three variants (Ink, text-progress, silent/JSON) implement this interface. The projection runtime receives a `ProjectionMonitor` instead of `isJsonMode: boolean`.

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
- non-interactive stdout redirection / CI-safe fallback behavior

No phase is complete until every command touched in that phase has explicit mode-coverage tests or an equivalent command-level verification checklist.

## Acceptance Criteria

- Every command has an explicit intent and presentation policy.
- The migration checklist (Appendix A) covers the full currently registered runnable CLI surface with no omissions.
- Browse commands with filters still open in TUI by default on an interactive terminal.
- Workflow commands can run with TUI, text-progress, or JSON without duplicating business logic.
- `balance refresh` uses the same shared workflow presenter architecture as the other workflow commands.
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
