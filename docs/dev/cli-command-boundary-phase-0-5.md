# CLI Command Boundary Phase 0.5

## Purpose

Phase 0 completed the command migration onto one behavioral contract.
Phase 0.5 tightens the architecture around that contract so it is harder to bypass or reintroduce drift.

Primary goals:

- reduce the public command-boundary surface to the smallest clear set
- move CLI adapter concerns out of `apps/cli/src/features/shared`
- reduce file fragmentation across boundary, contract, output, and option parsing helpers
- add guardrails so command files cannot bypass the boundary casually
- track command-by-command progress and any issues encountered during the refactor

This is a refactor phase, not a surface-redesign phase.
We should simplify aggressively inside touched areas, but we should not widen scope into unrelated feature behavior changes unless a touched abstraction clearly becomes simpler by doing so.

## Working Rules

When a smell is found while touching code:

1. Fix it immediately if it is local, low-risk, and clearly in scope.
2. If it is real but should not be solved in the same change, add one of these markers in code:
   - `TODO(cli-phase-0-5): ...`
   - `REQUIRES_INVESTIGATION(cli-phase-0-5): ...`
3. Add or update the corresponding row in the issue log below.
4. Do not leave a competing pattern in place silently.

While working command-by-command:

- update the command progress table when a command starts and when it completes
- record any discovered issues in the issue log, even if they are deferred
- collapse needless helper layers, wrapper types, and duplicate files when that simplifies the touched slice
- do not preserve obsolete compatibility layers "just in case"

## Starting Point

The current contract is behaviorally correct, but the implementation still has architectural smells:

- three exported boundary helpers, with one internal-seeming helper still publicly available
- CLI adapter concerns spread across multiple files under `apps/cli/src/features/shared`
- weak enforcement: docs describe the rules, but command files can still bypass them unless a developer remembers the contract
- `features/shared` mixes true cross-feature helpers with host-level CLI infrastructure

Important lesson from the first phase-0.5 experiment:

- collapsing everything into one overloaded `runCliCommand(...)` did not remove the conceptual split
- it mostly replaced `action` / `run` / `prepare + run` with a different syntax
- that is not enough value for the churn, so phase 0.5 should not chase a one-helper abstraction

Refactor starting point:

- `apps/cli/src/features/shared/cli-boundary.ts`
- `apps/cli/src/features/shared/cli-contract.ts`
- `apps/cli/src/features/shared/cli-error.ts`
- `apps/cli/src/features/shared/cli-output-format.ts`
- `apps/cli/src/features/shared/command-options.ts`
- `apps/cli/src/features/shared/exit-codes.ts`
- `apps/cli/src/features/shared/json-output.ts`
- `apps/cli/src/features/shared/prompts.ts`
- `apps/cli/src/features/shared/presentation/browse-surface.ts`
- `apps/cli/src/features/shared/presentation/presentation-mode.ts`

## Phase 0.5 Target Architecture

### Public API

There should be two public boundary helpers and one private internal helper:

- `runCliCommandBoundary(...)` for commands that do not need a command runtime
- `runCliRuntimeCommand(...)` for commands that do need a command runtime
- `runCliRuntimeAction(...)` should be private/internal only

The goal is not “one function at all costs.”
The goal is the smallest public API that still makes command intent obvious.

### Ownership split

`runtime/` should keep lifecycle ownership:

- app runtime
- command runtime
- cleanup and abort handling
- live resource lifetime

CLI adapter concerns should move out of `features/shared`, but not all the way into `runtime/` if they are not runtime lifecycle concerns.

Preferred destination:

- `apps/cli/src/cli/`

Preferred file layout:

```text
apps/cli/src/cli/
  command.ts       - public boundary helpers, command result types, exit codes, output writing
  options.ts       - output-format detection, result-returning option parsing
  prompts.ts       - prompt decision helpers
  presentation.ts  - browse surface resolution / presentation-mode helpers
```

This is the target shape, not a mandatory exact file count.
If a touched area becomes clearly simpler with fewer files, collapsing is preferred over preserving artificial separation.

### Explicit non-goals

- do not move feature-specific business helpers into `apps/cli/src/cli/`
- do not redesign TUIs or change command semantics unless required by the boundary refactor
- do not move runtime lifecycle logic out of `apps/cli/src/runtime/command-runtime.ts`

## Public Contract Draft

The target public surface is intentionally small and explicit:

```ts
await runCliCommandBoundary({
  command,
  format,
  action: async () => Promise<CliCommandResult>,
});

await runCliRuntimeCommand({
  command,
  format,
  appRuntime,
  prepare?: async () => Result<TPrepared | CliRuntimeCompletionStep, CliFailure>,
  action: async ({ runtime, prepared }) => Promise<CliCommandResult>,
});
```

Important constraint:

- public API should stay at two helpers unless a later change proves one helper adds real clarity
- internal implementation may have private helpers
- command files should not import the private runtime helper directly

## Guardrails To Add

Phase 0.5 should add enforcement in `eslint.config.js` for `apps/cli/src/features/**/command/**/*.ts`:

- forbid direct `process.exit(...)`
- forbid importing `exitCliFailure(...)`
- forbid importing `outputSuccess(...)`
- forbid importing `runCommand(...)` directly into command entrypoint files
- forbid importing any private runtime-only helper directly from command entrypoints

The point is to make the wrong path harder than the right path.

## Workstreams

| Workstream                  | Start State                                           | Target End State                                                               | Status |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| Boundary API simplification | three exported helpers in `cli-boundary.ts`           | two public helpers; private runtime helper no longer imported by command files | Done   |
| Module relocation           | CLI boundary files live in `features/shared`          | CLI adapter infrastructure moved under `apps/cli/src/cli/`                     | Done   |
| File simplification         | contract/output/error/format spread across many files | fewer, clearer files with sharper ownership                                    | Done   |
| Lint guardrails             | docs only                                             | hard lint rules prevent bypass in command files                                | Done   |
| Documentation alignment     | wiring doc still describes the three-helper model     | wiring doc updated to the phase 0.5 end state                                  | Done   |
| Legacy file removal         | old `features/shared` boundary files still present    | obsolete files removed after migration completes                               | Done   |

## Command Progress

Status values:

- `Pending`
- `In Progress`
- `Done`
- `Blocked`

| Family       | Command                  | Kind                 | Phase 0.5 Status | Notes                                                                                              |
| ------------ | ------------------------ | -------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| accounts     | `accounts`               | browse root/detail   | Done             | migrated to public runtime helper with browse prepare                                              |
| accounts     | `accounts view`          | explorer             | Done             | migrated to public runtime helper with browse prepare                                              |
| accounts     | `accounts add`           | mutation             | Done             | migrated to public runtime helper with preflight                                                   |
| accounts     | `accounts update`        | mutation             | Done             | migrated to public runtime helper with preflight                                                   |
| accounts     | `accounts rename`        | mutation             | Done             | migrated to public runtime helper with preflight                                                   |
| accounts     | `accounts remove`        | destructive mutation | Done             | migrated to public runtime helper with prompt flow                                                 |
| assets       | `assets view`            | review browse        | Done             | migrated to public runtime helper with runtime-backed TUI                                          |
| assets       | `assets confirm`         | review mutation      | Done             | migrated through local override helper on public runtime helper                                    |
| assets       | `assets clear-review`    | review mutation      | Done             | migrated through local override helper on public runtime helper                                    |
| assets       | `assets exclude`         | review mutation      | Done             | migrated through local override helper on public runtime helper                                    |
| assets       | `assets include`         | review mutation      | Done             | migrated through local override helper on public runtime helper                                    |
| assets       | `assets exclusions`      | review list          | Done             | migrated to public runtime helper with preflight                                                   |
| balance      | `balance view`           | browse/read          | Done             | migrated to public runtime helper with preflight                                                   |
| balance      | `balance refresh`        | workflow             | Done             | migrated to public runtime helper with preflight                                                   |
| blockchains  | `blockchains view`       | browse catalog       | Done             | migrated to `apps/cli/src/cli/` public boundary                                                    |
| clear        | `clear`                  | destructive workflow | Done             | entrypoint migrated to public runtime helper; text and TUI flows now stay runtime-backed internals |
| cost-basis   | `cost-basis`             | analysis workflow    | Done             | prompt-first cancellation now short-circuits through `prepare` on the public runtime helper        |
| cost-basis   | `cost-basis export`      | export workflow      | Done             | migrated to public runtime helper with preflight                                                   |
| import       | `import`                 | workflow             | Done             | migrated to public runtime helper with preflight                                                   |
| links        | `links run`              | workflow             | Done             | prompt-first cancellation now short-circuits through `prepare` on the public runtime helper        |
| links        | `links view`             | browse/review        | Done             | migrated to public runtime helper with preflight                                                   |
| links        | `links gaps`             | browse/review        | Done             | migrated to public runtime helper with preflight                                                   |
| links        | `links confirm`          | review mutation      | Done             | migrated to public runtime helper with preflight                                                   |
| links        | `links reject`           | review mutation      | Done             | migrated to public runtime helper with preflight                                                   |
| portfolio    | `portfolio`              | analysis workflow    | Done             | migrated to public runtime helper with preflight                                                   |
| prices       | `prices view`            | browse/explorer      | Done             | migrated to public runtime helper with preflight                                                   |
| prices       | `prices enrich`          | workflow             | Done             | migrated to public runtime helper with preflight                                                   |
| prices       | `prices set`             | mutation             | Done             | migrated to public runtime helper with preflight                                                   |
| prices       | `prices set-fx`          | mutation             | Done             | migrated to public runtime helper with preflight                                                   |
| profiles     | `profiles list`          | admin list           | Done             | migrated to `apps/cli/src/cli/` public runtime helper                                              |
| profiles     | `profiles add`           | admin mutation       | Done             | migrated to `apps/cli/src/cli/` public runtime helper                                              |
| profiles     | `profiles rename`        | admin mutation       | Done             | migrated to `apps/cli/src/cli/` public runtime helper                                              |
| profiles     | `profiles switch`        | admin mutation       | Done             | migrated to `apps/cli/src/cli/` public runtime helper                                              |
| profiles     | `profiles current`       | admin detail         | Done             | migrated to `apps/cli/src/cli/` public runtime helper                                              |
| providers    | `providers view`         | browse catalog       | Done             | migrated to `apps/cli/src/cli/` public boundary                                                    |
| providers    | `providers benchmark`    | workflow             | Done             | migrated to public runtime helper with preflight                                                   |
| reprocess    | `reprocess`              | workflow             | Done             | migrated to public runtime helper with preflight                                                   |
| transactions | `transactions view`      | browse/explorer      | Done             | migrated to public runtime helper with preflight                                                   |
| transactions | `transactions edit note` | mutation             | Done             | migrated to public runtime helper with preflight                                                   |
| transactions | `transactions export`    | export               | Done             | migrated to public runtime helper with preflight                                                   |

## Issue Log

Track every meaningful smell or investigation discovered during phase 0.5.

| ID       | Scope               | Marker                 | Description                                                                                                                                                                                                                                                                   | Status |
| -------- | ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P0.5-001 | boundary API        | TODO                   | Public boundary surface is now two helpers in `apps/cli/src/cli/command.ts`, with `runCliRuntimeAction(...)` kept private to the module.                                                                                                                                      | Closed |
| P0.5-002 | module ownership    | TODO                   | CLI adapter infrastructure moved out of `features/shared` and now lives under `apps/cli/src/cli/`.                                                                                                                                                                            | Closed |
| P0.5-003 | enforcement         | TODO                   | ESLint now blocks command files from importing shared CLI boundary/helpers, calling `runCommand(...)`, or calling `process.exit(...)` directly.                                                                                                                               | Closed |
| P0.5-004 | documentation       | TODO                   | `docs/code-assistants/cli-command-wiring.md` now documents the phase 0.5 two-helper model and the prompt-first `prepare` short-circuit path.                                                                                                                                  | Closed |
| P0.5-005 | file layout         | REQUIRES_INVESTIGATION | Browse surface helpers moved into `apps/cli/src/cli/presentation.ts`. Keep the follow-up question open only for whether adjacent presentation-specific helpers should join that module or stay feature-local.                                                                 | Closed |
| P0.5-006 | output modeling     | REQUIRES_INVESTIGATION | Decide whether `cli-response.ts` survives as a separate file or is folded into a smaller command/output module.                                                                                                                                                               | Open   |
| P0.5-007 | scope discipline    | TODO                   | Feature-local helpers stayed feature-local during the boundary move; only CLI adapter infrastructure moved into `apps/cli/src/cli/`.                                                                                                                                          | Closed |
| P0.5-008 | boundary experiment | REQUIRES_INVESTIGATION | A one-helper `runCliCommand(...)` experiment did not materially simplify the model. Do not resume that direction unless a later design proves clear value.                                                                                                                    | Closed |
| P0.5-009 | overload ergonomics | REQUIRES_INVESTIGATION | Prepared-runtime calls can require an explicit generic parameter for stable overload resolution. `assets exclusions` needed that extra annotation; if more commands hit the same edge, adjust the public helper shape instead of normalizing extra ceremony in command files. | Open   |
| P0.5-010 | bridge module       | TODO                   | `apps/cli/src/cli/command.ts`, `apps/cli/src/cli/options.ts`, `apps/cli/src/cli/prompts.ts`, and `apps/cli/src/cli/presentation.ts` now own real implementation, and the obsolete `features/shared` boundary files have been removed.                                         | Closed |
| P0.5-011 | prompt-first flows  | REQUIRES_INVESTIGATION | Prompt-first flows now short-circuit cleanly through `completeCliRuntime(...)` from `prepare`, so command files no longer import the private runtime helper directly.                                                                                                         | Closed |

## Suggested Execution Order

1. Create the new `apps/cli/src/cli/` module with the target public API.
2. Add or stage the lint rules that will protect the end state.
3. Migrate low-variance commands first:
   - `profiles`
   - `blockchains view`
   - `providers view`
4. Migrate no-runtime and simple runtime commands next:
   - `prices set`
   - `prices set-fx`
   - `transactions edit note`
5. Migrate preflight-plus-runtime commands:
   - `import`
   - `cost-basis export`
   - `transactions export`
6. Migrate browse/TUI-heavy commands in coherent family batches:
   - `accounts`
   - `prices view`
   - `transactions view`
   - `links`
   - `assets`
   - `balance`
7. Remove superseded files from `apps/cli/src/features/shared`.
8. Update the CLI wiring guide to match the final architecture.

## Definition Of Done

Phase 0.5 is done when all of the following are true:

- command files use only the approved public boundary helpers
- command files do not import the private runtime helper directly
- no command file imports old boundary-specific files from `apps/cli/src/features/shared`
- CLI adapter infrastructure no longer lives under `apps/cli/src/features/shared`
- lint rules prevent the most obvious bypasses
- the command progress table is fully marked `Done`
- open issue-log entries are either resolved or intentionally deferred with explicit markers
- the resulting file layout is smaller and clearer than the current one, not merely moved around
