# CLI Command Rework Phase 0

## Purpose

This document is the phase-0 planning artifact for the CLI command rework.

Goals:

- inventory every shipped CLI command and subcommand
- identify the current command-boundary patterns and where they compete
- define the expected end state so later migrations converge on one contract
- create a migration order that does not leave legacy boundary patterns behind

This document is intentionally iterative. It should be updated as command batches are reviewed.
Implementation notes and proving-ground adjustments should also be captured in [cli-command-rework-lessons-learned.md](/Users/joel/Dev/exitbook/docs/dev/cli-command-rework-lessons-learned.md).

## Why This Exists

The current CLI surface mixes several competing boundary patterns:

- `displayCliError(...)` as a formatter, writer, and hard exit primitive
- `parseCliCommandOptions(...)` and related helpers that terminate from inside parsing
- `withCliCommandErrorHandling(...)` as a second boundary wrapper
- ad hoc `try/catch` blocks around `runCommand(...)`
- `unwrapResult(...)` and newer `requireCliResult(...)` / `requireCliValue(...)` helpers that reintroduce throws for expected failures
- direct `ctx.exitCode = ...` writes for successful-but-nonzero outcomes
- direct `process.exit(...)` in prompts and destructive flows
- mixed text / json / tui branching done either before execution, inside execution, or inside deep helper layers

That fragmentation makes the CLI hard to reason about and easy to regress.

## Phase 0 Deliverables

Phase 0 does not migrate every command. It prepares the migration.

Required outputs:

1. A complete command inventory.
2. A shared description of current competing patterns.
3. A target command-boundary contract that is broad enough for browse, workflow, mutation, export, review, and prompt-first commands.
4. A command matrix listing current problems and expected final state.
5. A migration sequence that prevents new competing patterns from being introduced mid-stream.

## Proposed End-State Contract

This is the target state phase 0 is planning toward. It is not implemented yet.

### Boundary Rules

- Domain, workflow, and handler layers return `Result<T, Error>`.
- CLI adapter layers return `Result<CliCompletion, CliFailure>`.
- Expected user-facing failures are data, not exceptions.
- The outer CLI boundary is the only layer allowed to:
  - render a final JSON success payload
  - render a final text failure
  - choose a process exit code
- `runCommand(...)` continues to own runtime lifecycle and disposal.
- `with*CommandScope(...)` helpers continue to own scope assembly.
- Resource runtimes such as provider runtimes, ingestion runtimes, price runtimes, and event-driven controllers remain below the CLI boundary contract.

### Target Shared Types

Illustrative shape only:

```ts
type CliFailure = {
  exitCode: ExitCode;
  message: string;
  code: 'GENERAL_ERROR' | 'INVALID_ARGS' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'BLOCKED_PACKAGE' | 'CANCELLED';
  cause?: Error;
  details?: unknown;
};

type CliCompletion =
  | {
      outcome: 'rendered';
      render: () => Promise<void> | void;
      exitCode?: ExitCode;
    }
  | {
      outcome: 'no-op';
      exitCode?: ExitCode;
    };
```

### Non-Goals

- Do not replace `runCommand(...)` resource disposal in phase 0.
- Do not redesign existing TUIs in phase 0.
- Do not force every namespace into the browse pattern if the command is clearly a workflow or mutation.

## Global Smells To Eliminate

- parse helpers that exit instead of returning structured failures
- command helpers that throw for not-found, invalid-args, or validation cases
- scope helpers that catch typed CLI failures and wrap them into generic errors
- command files with duplicated `try/catch + displayCliError + outputSuccess`
- commands that print errors directly in TUI mode while JSON mode uses structured failures
- commands that manage successful nonzero exits informally through `ctx.exitCode` without a shared contract
- prompt cancellation paths that call `process.exit(...)` directly

## Baseline Metrics

These numbers are a phase-0 starting point and should be updated during the rework:

- `displayCliError(...)` references in `apps/cli/src/features` and `apps/cli/src/runtime`: `103`
- `withCliCommandErrorHandling(...)` references in `apps/cli/src/features`: `18`
- `unwrapResult(...)` references in `apps/cli/src/features`: `4`
- direct `process.exit(...)` outside the command runtime success/abort path:
  - [accounts-remove.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-remove.ts)
  - [cli-error.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-error.ts)
  - [prompts.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/prompts.ts)

Phase-0 completion does not require those numbers to reach zero, but phase-0 planning must define how each one will be driven to one final pattern.

## Current Boundary Map

| Helper / Primitive                                                                                                                                                          | Current Role                                                                  | Problem                                                               | Phase-0 Decision                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [command-runtime.ts](/Users/joel/Dev/exitbook/apps/cli/src/runtime/command-runtime.ts) `runCommand(...)`                                                                    | owns command runtime, cleanup, abort hooks, and final `ctx.exitCode` handling | currently also calls `process.exit(...)` for successful nonzero exits | keep as lifecycle primitive for now; do not redesign in first migration batch |
| [command-options.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/command-options.ts) `parseCliCommandOptions(...)`                                                | parse + validate command options                                              | exits during parse instead of returning failures                      | replace with parse-to-`Result` API                                            |
| [command-options.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/command-options.ts) `parseCliBrowseRootInvocation(...)`                                          | emulates browse root parsing around Commander limits                          | same exit-from-parse issue                                            | keep idea, change contract to return `Result`                                 |
| [command-options.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/command-options.ts) `withCliCommandErrorHandling(...)`                                           | outer error wrapper for some commands                                         | creates a second competing boundary style                             | replace with one final boundary runner                                        |
| [cli-error.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-error.ts) `displayCliError(...)`                                                                   | formats, writes, and exits                                                    | too much power in one helper; hard to test and compose                | split into pure formatting/writing plus outer termination choice              |
| [json-output.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/json-output.ts) `outputSuccess(...)`                                                                 | prints JSON success payload                                                   | separate success-only path competes with `displayCliError(...)`       | absorb into shared completion writer                                          |
| [result-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/result-utils.ts) `unwrapResult(...)`                                                                | converts `Result` to throw                                                    | reintroduces exception-based flow                                     | remove from command-layer usage                                               |
| [cli-command-error.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-command-error.ts) `CliCommandError`                                                        | exception type for carrying exit code                                         | encourages typed expected failures to travel as exceptions            | do not expand; shrink usage over time                                         |
| [prompts.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/prompts.ts) `promptConfirmDecision(...)`                                                                 | prompt confirmation helper                                                    | historically hid cancellation by exiting from deep helper             | return explicit prompt decision and let commands own cancellation semantics   |
| [accounts-command-helpers.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-command-helpers.ts) `requireCliResult(...)` / `requireCliValue(...)` | recent coercion helpers                                                       | localized version of the same throw smell                             | delete after replacing with typed adapters                                    |

## Command Inventory

The table below must remain exhaustive.

Scope note:

- the inventory tracks terminal command shapes that perform work or present state
- grouping-only nodes such as `transactions edit` are described through their terminal children and are not counted as standalone terminal actions unless they execute directly

| Family       | Command Shape            | Category                                | Current Pattern                                                    | Current Problems                                                                                | Expected End State                                                                                        |
| ------------ | ------------------------ | --------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| accounts     | `accounts`               | browse root                             | browse root parsing + shared browse presentation                   | in migration; still mixes parse helper exits, browse-specific helpers, and throw-based coercion | bare noun static list via shared browse boundary contract                                                 |
| accounts     | `accounts <name>`        | browse detail                           | browse root parsing + selector resolution                          | selector resolution and failure typing still unstable                                           | bare selector static detail with shared not-found semantics                                               |
| accounts     | `accounts view [name]`   | browse explorer                         | shared browse presentation + TUI fallback                          | empty-explorer and selector error semantics not fully correct yet                               | reusable browse explorer contract with static fallback rules from spec                                    |
| accounts     | `accounts add`           | mutation                                | parsed options + `runCommand` + output/throw mix                   | recent migration introduced throw-based coercion helpers                                        | pure CLI adapter returning typed completion/failure                                                       |
| accounts     | `accounts update`        | mutation                                | parsed options + `runCommand` + output/throw mix                   | same as add; not-found uses throw helper                                                        | same mutation contract as add                                                                             |
| accounts     | `accounts rename`        | mutation                                | parsed options + `runCommand` + output/throw mix                   | same smell; still uses boundary-local throw for missing renamed name                            | same mutation contract as add                                                                             |
| accounts     | `accounts remove`        | destructive mutation                    | parsed options + scope wrapper + prompt + direct exit              | confirmation flow and scope wrapper currently distort failure typing                            | destructive mutation contract with typed cancel/confirm/failure outcomes                                  |
| assets       | `assets view`            | review browse                           | explicit text/json split + `runCommand` + inline TUI callbacks     | root still requires `view`; command mixes view loading and action callbacks                     | namespace should move to browse-family rules or be explicitly exempt with one clear pattern               |
| assets       | `assets confirm`         | review mutation                         | small command helper wrapper                                       | needs classification against shared mutation contract                                           | one-line mutation command on shared boundary                                                              |
| assets       | `assets clear-review`    | review mutation                         | small command helper wrapper                                       | same as confirm                                                                                 | one-line mutation command on shared boundary                                                              |
| assets       | `assets exclude`         | review mutation                         | small command helper wrapper                                       | same as confirm                                                                                 | one-line mutation command on shared boundary                                                              |
| assets       | `assets include`         | review mutation                         | small command helper wrapper                                       | same as confirm                                                                                 | one-line mutation command on shared boundary                                                              |
| assets       | `assets exclusions`      | review list                             | explicit text/json split                                           | root namespace and list shape do not yet align with browse-v3 rules                             | either browse-family migration or explicit stable exception documented                                    |
| balance      | `balance view`           | browse/read                             | explicit text/json split + scope helper                            | likely browse-family candidate but still subcommand-only                                        | bare noun/list/detail/view rules decided and applied consistently                                         |
| balance      | `balance refresh`        | workflow with TUI/json branches         | scope helper + workflow runtime + event relay + inline output      | multiple execution shapes inside one file; no shared workflow completion contract               | workflow boundary contract that supports text-progress, TUI single-scope, JSON, and success-with-metadata |
| blockchains  | `blockchains view`       | browse catalog                          | `withCliCommandErrorHandling` + inline validation + TUI/json split | likely browse-family candidate but only `view` exists; validation still exits from helper layer | bare noun static list plus shared browse explorer rule, or documented exception if TUI-only               |
| clear        | `clear`                  | destructive workflow/review             | parse helper + choose TUI vs terminal flow                         | direct cancellation exits and split flow orchestration                                          | one destructive-flow boundary with typed preview/confirm/cancel/result outcomes                           |
| cost-basis   | `cost-basis`             | analysis workflow with prompt-first TUI | parse + unwrap + prompt + spinner + TUI/json split                 | `unwrapResult` and mixed prompt/execution boundary patterns                                     | prompt-first workflow contract with typed prompt cancel and final completion                              |
| cost-basis   | `cost-basis export`      | export workflow                         | parse + unwrap + filesystem + success-with-nonzero exit            | blocked-package success path is informal                                                        | export contract that supports success payload plus explicit nonzero exit                                  |
| import       | `import`                 | workflow                                | duplicated text/json command bodies around `runCommand`            | strong candidate for shared workflow runner; partial-failure exit is ad hoc                     | workflow contract with headless vs progress presentation and partial-failure exit                         |
| links        | `links run`              | workflow with prompt-first text mode    | parse + prompt + `runCommand` + duplicated json/text branches      | another prompt-first workflow with inline profile resolution                                    | same workflow contract as import, with preflight prompt stage                                             |
| links        | `links view`             | browse/review                           | large bespoke text/json split                                      | browse-family candidate but currently custom                                                    | converge on browse contract if viable                                                                     |
| links        | `links gaps`             | browse/review                           | large bespoke text/json split                                      | same as links view                                                                              | converge on browse contract if viable                                                                     |
| links        | `links confirm <id>`     | review mutation                         | parse + spinner + render short-lived result UI                     | bespoke review command pattern                                                                  | review mutation contract with optional transient presenter                                                |
| links        | `links reject <id>`      | review mutation                         | same as confirm                                                    | same as confirm                                                                                 | same as confirm                                                                                           |
| portfolio    | `portfolio`              | analysis TUI/json                       | parse + normalize + spinner + TUI/json split                       | similar to cost-basis, but no prompt stage                                                      | analysis workflow contract with optional TUI renderer                                                     |
| prices       | `prices view`            | browse/explorer + mutation callbacks    | hybrid custom command with deep inline error printing              | likely browse-family candidate but currently bespoke and throw-prone inside callbacks           | shared browse contract plus typed callback error handling                                                 |
| prices       | `prices enrich`          | workflow                                | scope helper + runtime helper + duplicated json/text shells        | strong shared workflow candidate                                                                | workflow boundary contract with runtime-owned cleanup                                                     |
| prices       | `prices set`             | mutation                                | older command-local error pattern                                  | likely easy migration once mutation contract exists                                             | pure mutation contract                                                                                    |
| prices       | `prices set-fx`          | mutation                                | older command-local error pattern                                  | same as prices set                                                                              | pure mutation contract                                                                                    |
| profiles     | `profiles list`          | admin list                              | simple text/json command                                           | older direct `displayCliError` pattern                                                          | small command on shared mutation/list boundary                                                            |
| profiles     | `profiles add`           | admin mutation                          | simple text/json command                                           | same as list                                                                                    | small command on shared mutation/list boundary                                                            |
| profiles     | `profiles rename`        | admin mutation                          | simple text/json command                                           | same as list                                                                                    | small command on shared mutation/list boundary                                                            |
| profiles     | `profiles switch`        | admin mutation/context                  | simple text/json command                                           | same as list                                                                                    | small command on shared mutation/list boundary                                                            |
| profiles     | `profiles current`       | admin detail                            | simple text/json command                                           | same as list                                                                                    | small command on shared mutation/list boundary                                                            |
| providers    | `providers view`         | browse catalog                          | `withCliCommandErrorHandling` + inline validation + TUI/json split | likely browse-family candidate but only `view` exists                                           | bare noun static list plus shared browse explorer rule, or documented exception                           |
| providers    | `providers benchmark`    | workflow / live benchmark               | TUI/json split + benchmark-specific session prep                   | input validation and benchmark outcomes use command-local pattern                               | workflow contract that supports live TUI session or headless JSON                                         |
| reprocess    | `reprocess`              | workflow                                | duplicated text/json shells around `runCommand`                    | very close to import/prices-enrich pattern                                                      | workflow contract with optional warning summary and structured JSON                                       |
| transactions | `transactions view`      | browse/explorer + export callback       | custom TUI/json split + inline `ctx.exitCode` writes               | browse-family candidate but currently bespoke                                                   | shared browse contract plus typed callback/export outcomes                                                |
| transactions | `transactions edit note` | mutation                                | nested subcommand + local parse/error pattern                      | likely easy migration once mutation contract exists                                             | pure mutation contract                                                                                    |
| transactions | `transactions export`    | export command                          | custom export flow                                                 | needs export outcome contract and no direct exits from parse/errors                             | export contract with typed file-write outcome                                                             |

## Pattern Buckets

These buckets will drive the migration order.

### Bucket A: Browse Families

Candidates:

- `accounts`
- `transactions view`
- `links view`
- `links gaps`
- `assets view`
- `prices view`
- `providers view`
- `blockchains view`
- `balance view`

Shared target:

- command shape chooses static list, static detail, or explorer
- JSON shape follows semantic target, not the human surface
- not-found and invalid-args paths are shared across static and TUI forms
- explorer fallback rules are centralized and spec-compliant

### Bucket B: Small Mutations

Candidates:

- `accounts add`
- `accounts update`
- `accounts rename`
- `profiles add`
- `profiles rename`
- `profiles switch`
- `transactions edit note`
- `prices set`
- `prices set-fx`
- `assets confirm`
- `assets clear-review`
- `assets exclude`
- `assets include`

Shared target:

- parse to `Result`
- execute to `Result`
- return a `CliCompletion`
- no expected-flow throws

### Bucket C: Workflows

Candidates:

- `import`
- `reprocess`
- `prices enrich`
- `links run`
- `balance refresh`
- `providers benchmark`

Shared target:

- preflight stage for prompts or parameter collection when needed
- execution stage wrapped by `runCommand(...)`
- runtime/resource cleanup remains inside existing runtime helpers
- final output selected by one boundary contract
- partial-success or warning exit codes are first-class

### Bucket D: Export / File Writers

Candidates:

- `transactions export`
- `cost-basis export`

Shared target:

- typed file-write outcomes
- explicit success-with-nonzero exit support
- no `unwrapResult(...)`

### Bucket E: Destructive / Review Flows

Candidates:

- `clear`
- `accounts remove`
- `links confirm`
- `links reject`

Shared target:

- explicit preview / confirm / cancel / execute states
- cancel is not a process-level escape hatch from deep helpers
- review result UIs are presenters, not control-flow primitives

## Migration Constraints

- Do not introduce new `require*` helpers that turn `Result` into expected-flow throws.
- Do not add more command-local `try/catch + displayCliError + outputSuccess` shells.
- Do not let scope helpers erase typed CLI failures.
- Do not migrate a family halfway if that leaves two boundary styles in the same namespace.
- Prefer shared adapters over command-specific helpers whenever two commands want the same boundary behavior.

## Detailed Migration Phases

The steps below are written as implementation guidance, not just sequencing.

### Phase 1: Build The Shared Boundary Core

Goal:

- introduce the final command-boundary contract without changing runtime disposal

Files to add:

- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-failure.ts`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-completion.ts`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-boundary.ts`

Files to reshape:

- [command-options.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/command-options.ts)
- [cli-error.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-error.ts)
- [json-output.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/json-output.ts)
- [prompts.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/prompts.ts)

Work items:

1. Define `CliFailure`.
2. Define `CliCompletion`.
3. Implement one boundary runner, tentatively `runCliBoundary(...)`.
4. Split error handling into:
   - pure formatter
   - pure writer
   - outer termination decision
5. Change parse helpers to return `Result<Parsed, CliFailure>`.
6. Add compatibility wrappers only if needed to keep the repo building during migration.

Pseudo-code target:

```ts
const parsed = parseCliOptionsResult(commandId, rawOptions, schema);
if (parsed.isErr()) {
  return runCliBoundary(commandId, err(parsed.error));
}

return runCliBoundary(
  commandId,
  runCommand(appRuntime, async (ctx) => executeCommand(ctx, parsed.value))
);
```

Acceptance criteria:

- no new command introduced after this phase should call `displayCliError(...)` directly
- parse helpers no longer call `process.exit(...)`

### Phase 2: Migrate One Browse Family End-To-End

Recommended proving ground:

- `accounts`

Files:

- [accounts.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts.ts)
- [accounts-browse-command.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-command.ts)
- [accounts-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-browse-support.ts)
- [accounts-add.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-add.ts)
- [accounts-update.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-update.ts)
- [accounts-rename.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-rename.ts)
- [accounts-remove.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-remove.ts)
- [accounts-remove-command-scope.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-remove-command-scope.ts)

Work items:

1. Remove throw-based coercion helpers.
2. Make selector resolution return typed not-found vs general failures.
3. Make browse presentation assembly return `Result`.
4. Keep static list/detail/explorer decision in one place.
5. Make destructive cancel a typed completion, not a deep exit.

Acceptance criteria:

- `accounts` becomes the browse reference implementation
- no direct `displayCliError(...)` inside accounts command files
- no `requireCliResult(...)` / `requireCliValue(...)`

### Phase 3: Migrate One Workflow Family With Resource Lifecycles

Recommended proving grounds:

- `prices enrich`
- `import`

Files:

- [prices-enrich.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/prices/command/prices-enrich.ts)
- [prices-enrich-command-scope.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/prices/command/prices-enrich-command-scope.ts)
- [run-prices-enrich.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/prices/command/run-prices-enrich.ts)
- [import.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/import/command/import.ts)
- [import-command-scope.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/import/command/import-command-scope.ts)
- [run-import.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/import/command/run-import.ts)

Work items:

1. Keep runtime cleanup in `runCommand(...)`, `withIngestionRuntime(...)`, and `withCliPriceEnrichmentRuntime(...)`.
2. Move JSON/text branching to the outer CLI boundary layer where possible.
3. Represent partial-failure exits as explicit completion state, not incidental `ctx.exitCode` writes scattered through command code.
4. Preserve prompt-first preflight behavior where needed.

Acceptance criteria:

- one workflow family proves that the boundary contract works with monitors, event buses, and abort hooks
- no resource cleanup logic is copied upward into the CLI boundary wrapper

### Phase 4: Migrate Analysis And Export Commands

Targets:

- `cost-basis`
- `cost-basis export`
- `portfolio`
- `transactions export`

Files:

- [cost-basis.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/cost-basis/command/cost-basis.ts)
- [cost-basis-export.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/cost-basis/command/cost-basis-export.ts)
- [portfolio.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/portfolio/command/portfolio.ts)
- [transactions-export.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/command/transactions-export.ts)

Work items:

1. remove `unwrapResult(...)` from command entrypoints
2. represent prompt cancellation explicitly
3. support success-with-nonzero exit for blocked or partial-success export states

Acceptance criteria:

- export commands no longer rely on throws for validation or scope setup
- successful nonzero exit commands use one explicit completion contract

### Phase 5: Converge Remaining Small Mutations And Admin Commands

Targets:

- `profiles *`
- `prices set`
- `prices set-fx`
- `transactions edit note`
- `assets confirm`
- `assets clear-review`
- `assets exclude`
- `assets include`

Work items:

1. replace the older direct `displayCliError(...)` pattern
2. standardize text and JSON success handling
3. shrink command files to parse -> execute -> complete

Acceptance criteria:

- small mutation commands become the simplest examples in the repo
- these commands no longer carry custom boundary shells

### Phase 6: Finish Browse Convergence

Targets:

- `transactions view`
- `links view`
- `links gaps`
- `prices view`
- `providers view`
- `blockchains view`
- `balance view`
- decide whether `assets view` joins the browse contract or stays a documented review-surface exception

Work items:

1. decide command-shape policy per family
2. either migrate to noun / noun selector / noun view or document a permanent exception
3. remove inline `console.error(...)` + `ctx.exitCode = ...` TUI error handling

Acceptance criteria:

- browse families no longer have bespoke surface-selection logic spread across files
- every browse family either follows the same contract or has an explicit documented reason not to

### Phase 7: Final Cleanup

Files expected to shrink or disappear:

- [cli-error.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-error.ts)
- [json-output.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/json-output.ts)
- [result-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/result-utils.ts)
- [cli-command-error.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-command-error.ts)
- [accounts-command-helpers.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/accounts/command/accounts-command-helpers.ts)

Exit criteria:

- one boundary contract remains
- no competing parse/error/output helpers remain in command entrypoints
- doc table can mark every command as migrated or intentionally exempt

## Definition Of Done

The rework is done only when all of the following are true:

- every command in the matrix has been reviewed and migrated or explicitly exempted
- no command entrypoint uses `unwrapResult(...)`
- no command entrypoint uses `requireCliResult(...)` or equivalent throw coercion
- no command entrypoint calls `displayCliError(...)` directly
- no feature command helper calls `process.exit(...)` directly
- expected failures travel as data, not exceptions
- successful nonzero exit states are explicit in the command completion contract
- browse commands do not carry bespoke surface-selection logic unless documented as an exception
- prompt-first and workflow commands use the same outer boundary style as browse and mutation commands

## Review Checklist For Every Command Migration

- Does parsing return data or does it exit?
- Does not-found stay typed as not-found all the way out?
- Does the command use throws only for true programmer/invariant failures?
- Does one outer boundary choose final render and exit code?
- Does JSON mode avoid TUI-only logic and side effects?
- Does text mode avoid JSON-only payload builders leaking into the flow?
- Are prompt cancellation and partial-success exits represented explicitly?
- If the command opens resources or controllers, are they still owned by `runCommand(...)` and runtime helpers rather than the CLI boundary wrapper?

## Next Steps

1. Treat this document as the source of truth for the phase-1 implementation kickoff.
2. Start phase 1 by introducing the shared boundary core in `apps/cli/src/features/shared/`.
3. Use `accounts`, `prices enrich` or `import`, and `cost-basis export` as the first proving-ground commands before broader rollout.
