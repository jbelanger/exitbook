# CLI Command Rework Lessons Learned

## Phase 1: Shared Boundary + `profiles` proving ground

### What worked

- Keep resource lifecycle where it already belongs.
  - `runCommand(...)` remains the owner of database setup, cleanup, and SIGINT disposal.
  - The new command refactor should sit outside that layer, not compete with it.

- Separate outcome modeling from process termination.
  - Commands are easier to read when they return `Result<CliCompletion, CliFailure>` instead of calling `displayCliError(...)` inline.
  - The only place that should turn a failure into rendered output plus `process.exit(...)` is the boundary runner.

- Parse helpers need result-returning companions.
  - `parseCliCommandOptions(...)` and browse parsing wrappers are still useful compatibility shims.
  - The long-term seam is the new `*Result(...)` variants that return `CliFailure` instead of exiting.

- The smallest useful proving ground was a whole command family, not one command.
  - Migrating all `profiles` commands together exposed the shared shape cleanly.
  - Migrating a single command would have hidden whether the contract actually reduced repetition.

### What did not work

- Reusing `runtime.exitCode` inside the new path would have been a trap.
  - `runCommand(...)` still exits immediately when `runtime.exitCode !== 0`.
  - That bypasses any post-runtime boundary rendering.
  - For migrated commands, non-zero success should travel in `CliCompletion.exitCode` and be applied after rendering.

- Old tests were overfit to helper internals.
  - Existing command tests mocked `displayCliError(...)` directly.
  - After introducing the new boundary, those tests had to be rewritten around `exitCliFailure(...)` and shared output writing.

### Current constraints we should respect in the next phases

- Keep using generic `GENERAL_ERROR` exits where lower layers only return untyped `Error`.
  - `profiles` still surfaces not-found via plain error messages from services/repositories.
  - We should not infer semantic exit codes from string matching.
  - Better exit semantics need typed domain/application errors first.

- Do not migrate workflow/resource commands by copying the `profiles` shape blindly.
  - The boundary contract is reusable.
  - The resource/runtime layer should still stay command-specific where events, streaming progress, or cleanup ordering matter.

### Direction confirmed by this phase

- Shared contract modules:
  - `apps/cli/src/features/shared/cli-contract.ts`
  - `apps/cli/src/features/shared/cli-boundary.ts`

- Compatibility bridge:
  - Keep legacy wrappers like `parseCliCommandOptions(...)` for now, but implement them in terms of result-returning helpers.

- Next likely targets:
  - A simple parse-heavy command that is not profile-related.
  - One workflow command that uses a richer runtime/scope.
  - One non-zero-success command such as `cost-basis export`.

## Phase 2: `cost-basis export` + `import`

### What worked

- The same outer boundary works for preflight plus runtime execution.
  - `cost-basis export` needs option parsing, config validation, scope validation, and output-dir setup before the runtime-backed workflow.
  - `import` needs option parsing before the runtime-backed scope and monitor execution.
  - The reusable seam was a helper that captures a `CliCommandResult` from `runCommand(...)` without rendering it immediately.

- Non-zero success belongs in `CliCompletion`, not the runtime object.
  - `cost-basis export` now returns `BLOCKED_PACKAGE` after writing the package output.
  - `import --all --json` now returns its partial-failure payload first, then exits non-zero from the boundary.

- Silent success is a real command outcome.
  - `import` text mode often streams its own monitor or TUI and has nothing useful to print afterward.
  - Modeling that as `silentSuccess(...)` is cleaner than forcing late text output or mutating runtime state.

### New constraints confirmed

- We needed a runtime-result helper, not another wrapper that renders immediately.
  - `runCliRuntimeCommand(...)` is fine when the whole command lives inside the runtime scope.
  - Harder commands also need `captureCliRuntimeResult(...)` so preflight logic can stay under one outer boundary.

- Preflight validation should use semantic exit codes when we actually know the failure class.
  - `cost-basis export` now treats bad filing inputs and invalid filing scope as `VALIDATION_ERROR`.
  - That is better than letting throw bridges collapse them into `GENERAL_ERROR`.

### Current limits still visible

- `import` cancellation is still not ideal.
  - Prompt decline still becomes a plain `Error('Import cancelled by user')` from the lower helper path.
  - The command boundary can only treat that as a generic failure unless we introduce a typed cancellation result or error in the import flow.

- `CliOutputFormat` still lives in `command-options.ts`.
  - The boundary layer is now reused by more command families, so that type placement is looking increasingly wrong.

### Direction confirmed by this phase

- The shared contract is now proven against:
  - Simple mutations and lookups via `profiles`
  - Non-zero success with artifact output via `cost-basis export`
  - Runtime-heavy monitor-driven execution via `import`

- The next migrations should probably target:
  - `accounts`, because the browse/detail split now has a proven surrounding contract
  - `clear` or another prompt-first command, to finish the cancellation story
