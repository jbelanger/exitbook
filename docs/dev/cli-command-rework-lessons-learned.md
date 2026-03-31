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

## Phase 3: `accounts`

### What worked

- The browse/detail family fits the shared outcome contract without special casing.
  - Root browse parsing now uses the result-returning root parser and the shared boundary.
  - `accounts view` and bare `accounts` both route through the same browse execution path and return `CliCompletion`.

- Filtered-empty explorers need an explicit collapse rule.
  - The shared surface helper now requires `shouldCollapseEmptyExplorer`.
  - `accounts` only enables collapse when no selector or slice filter is active, so filtered-empty explorer states stay on TUI as required by the V3 surface spec.

- Preserving legacy semantic exit codes during `Result` conversion matters during migration.
  - Some lower helpers still return `CliCommandError` as `Err` data.
  - `createCliFailure(...)` now preserves that embedded exit code instead of flattening everything to the fallback code.

- Prompt cancellation can be modeled as completion.
  - `accounts remove` no longer calls `process.exit(0)` after a declined confirmation.
  - It now returns a normal text completion and lets the shared boundary remain the only owner of termination.

### Remaining cleanup

- `run-accounts-remove.ts` still emits `CliCommandError` as data for not-found.
  - That is localized and explicitly marked with `TODO(cli-rework)`.
  - The next cleanup pass should let remove-scope helpers carry `CliFailure` or another typed semantic failure directly.

## Phase 4: `clear`

### What worked

- A TUI-first command can still fit the shared boundary.
  - `clear` now parses under `runCliCommandBoundary(...)` and then routes to either terminal or TUI flow as data.
  - The default interactive path still opens the TUI, but the command entrypoint no longer owns any direct error rendering or exits.

- Interactive TUI rendering does not need to happen outside the runtime boundary.
  - `clear` needs a live `clearService` while the Ink app is mounted.
  - The right shape was to keep `renderApp(...)` inside the runtime scope and return `silentSuccess()` afterward, rather than forcing every command to render after `runCommand(...)` completes.

- Dead legacy branches are worth deleting during migration.
  - `clear-terminal.ts` had an unreachable confirmation prompt path because the top-level command already routed non-confirmed text mode into the TUI.
  - Removing that branch simplified the command and removed another deep cancellation path for free.

### Constraints confirmed

- Some commands need both output styles:
  - TUI path: render inside runtime, then return `silentSuccess()`.
  - Terminal path: return `CliCompletion` so JSON output and empty-result text still route through the shared boundary.

## Phase 5: Prompt cancellation cleanup

### What worked

- Prompt helpers should return user intent, not terminate the process.
  - `promptConfirmDecision(...)` now returns `'confirmed' | 'declined' | 'cancelled'`.
  - That keeps Ctrl+C localized as data and lets each command decide whether decline/cancel should be zero-success or `CANCELLED`.

- Local cancellation outcomes are better than generic failures for workflow seams.
  - `import` now returns a `{ kind: 'cancelled' }` outcome from the workflow helper path instead of manufacturing an error.
  - The command adapter maps that one known case to a cancelled completion without teaching the whole shared boundary about import-specific behavior.

- Removing the old helper was cleaner than carrying both APIs.
  - `handleCancellation(...)` and the boolean `promptConfirm(...)` wrapper would have kept two prompt contracts alive.
  - Migrating both `import` and `accounts remove` in the same pass avoided that split.

### Constraints confirmed

- Cancellation semantics still belong to the command, not the prompt helper.
  - `import` treats decline/cancel as a cancelled completion because the user explicitly aborted the workflow.
  - `accounts remove` now distinguishes decline from Ctrl+C:
    - decline stays a normal text completion
    - Ctrl+C becomes `CANCELLED`

## Phase 6: Workflow shell cleanup (`reprocess` + `prices enrich`)

### What worked

- Some legacy workflows only needed the boundary rewrite, not a deeper runtime redesign.
  - `reprocess` and `prices enrich` were both duplicating JSON/text shells around `runCommand(...)`.
  - Rewriting the entrypoints around `runCliCommandBoundary(...)` plus `captureCliRuntimeResult(...)` removed that duplication without touching the underlying runtime helpers.

- Workflow commands can stay simple when the runtime already owns presentation.
  - `prices enrich` text mode does not need post-run output; `silentSuccess()` is the correct completion.
  - `reprocess` only needs a small text completion when successful processing still produced warnings, so the post-run output stays local and explicit.

- Command tests are worth adding at the migration seam, even when runner tests already exist.
  - `run-reprocess.test.ts` already covered the runtime helper.
  - The new command tests caught the exact integration questions the runner tests could not: option parsing, boundary failures, JSON output, and text completion behavior.

### Constraints confirmed

- `captureCliRuntimeResult(...)` is the right helper when parsing happens outside the runtime but execution lives fully inside it.
  - That keeps parse failures in the shared boundary contract.
  - It also avoids dragging `runCommand(...)` details back into each command file.

## Phase 7: Small mutations on runtime-owned price helpers (`prices set` + `prices set-fx`)

### What worked

- Not every runtime helper needs a second adapter layer.
  - `withCommandPriceProviderRuntime(...)` can already carry a `Result<T, Error>` value through the callback.
  - That let `prices set` and `prices set-fx` drop the old `throw executeResult.error` bridge entirely.

- Small mutations still benefit from command-level tests.
  - The handler tests already covered validation and persistence.
  - The new command tests now cover boundary behavior: profile resolution, JSON output, and shared failure routing.

### Constraints confirmed

- The shared command boundary is still readable for small commands as long as completion helpers stay local.
  - `prices set` and `prices set-fx` each keep their text success rendering inline.
  - Extracting a generic helper here would have hidden the command contract more than it would have clarified it.

## Phase 8: `prices view` alignment

### What worked

- A TUI command with live mutation callbacks can still fit the shared boundary.
  - `prices view` needs a live price runtime while the app is mounted because the missing-price screen can save manual prices inline.
  - The right shape was the same as `clear`: render the app inside the runtime-owned section, then return `silentSuccess()` afterward.

- JSON and TUI modes can still share the same outer parse/boundary contract even when their inner execution shapes diverge.
  - JSON mode builds structured completion data.
  - TUI mode builds runtime-local state and render callbacks.

### Constraints confirmed

- Callback-local errors are a different problem than command-boundary errors.
  - `prices view` no longer uses legacy parse or boundary helpers.
  - The TUI callbacks still surface failures by rejecting inside the component flow, which is acceptable for now because the UI reducer already owns that interaction loop.

## Phase 9: `transactions` family alignment

### What worked

- Migrating a whole command family was cleaner than splitting a shared seam across phases.
  - `transactions view`, `transactions export`, and `transactions edit note` were all still using the legacy parse/error boundary.
  - Moving them together avoided leaving one family split across `displayCliError(...)` and `runCliCommandBoundary(...)`.

- Filters that feed later callbacks need to be validated once at the outer boundary and then carried forward as data.
  - `transactions view` had a hidden drift bug: the TUI export callback did not preserve the active `--since` filter.
  - Parsing `since`/`until` up front and threading the validated values into both the list query and the inline export callback fixed that without inventing callback-local parsing rules.

### Constraints confirmed

- Command ids should normalize during migration, even when the legacy JSON field was inconsistent.
  - `view-transactions` became `transactions-view` to match the current command naming convention used by the shared boundary.
  - That is a user-visible JSON change, so future migrations should make the rename explicit in tests and notes instead of leaving mixed ids around.

## Phase 10: `providers` family alignment

### What worked

- Not every TUI command needs a command runtime.
  - `providers view` reads from app configuration and a stats file, but it does not need the runtime lifecycle or cleanup hooks.
  - It fit cleanly on `runCliCommandBoundary(...)` alone, with `renderApp(...)` staying local and `silentSuccess()` marking the text path complete.

- Expected validation failures and real runtime failures can still be separated without falling back to throw-based control flow.
  - `providers benchmark` now classifies setup errors as invalid arguments and benchmark execution failures as general errors.
  - That split is handled locally before converting to `CliFailure`, which keeps the shared boundary simple.

### Constraints confirmed

- Command-level validation should not survive once the schema already owns it.
  - `providers view` was manually re-validating `--health` even though the Zod schema already enforced the enum.
  - Carrying both would have reintroduced two validation contracts for the same flag.

## Phase 11: `assets` review flows

### What worked

- TUI-local mutations can stay inside the command scope without inventing a second boundary.
  - `assets view` needs live review callbacks for exclude/include/confirm/clear while the app is mounted.
  - The clean shape was the same as `prices view`: build the view state inside the scope, let callback failures reject inside the UI loop, and return `silentSuccess()` when the app closes.

- Small sibling commands benefited from one shared override adapter.
  - `assets exclude`, `assets include`, `assets confirm`, and `assets clear-review` all had the same parse/scope/output shell.
  - Moving that shell into one shared command helper reduced repetition without hiding the command contract.

### Constraints confirmed

- Command helpers should build completions, not print directly.
  - The override helper now takes a completion builder instead of a side-effecting success callback.
  - That keeps JSON/text rendering at the shared boundary and avoids sneaking output logic back into command-local helpers.

## Phase 12: `balance` runtime-backed browse and refresh flows

### What worked

- Runtime-scoped TUI rendering can still fit the shared boundary cleanly.
  - `balance view` needs the runtime open long enough to rebuild projections before rendering.
  - `balance refresh` needs the runtime open while the verification stream is active and cleanup hooks are registered.
  - Both commands now convert scope results into `CliCompletion` values inside the runtime-owned section instead of returning to legacy try/catch shells.

- Command-level tests should cover at least one text path when runtime cleanup and rendering interact.
  - The old balance tests only covered JSON mode.
  - Adding focused text-mode assertions caught the new command seam without forcing a full UI test harness.

### Constraints confirmed

- Defensive invariants should stay local instead of becoming new shared error semantics.
  - A missing single-account view result after a successful stored-snapshot lookup would indicate broken command assumptions, not a normal lookup miss.
  - Treating that case as a generic command failure is cleaner than building a one-off `NOT_FOUND` bridge inside the TUI helper.

## Phase 13: `links` family alignment

### What worked

- Prompt-driven workflows need explicit outcomes, not `null` sentinels.
  - `links run` now distinguishes submitted params, cancellation, and invalid cross-field prompt input.
  - That kept prompt decline as a normal text completion while letting invalid prompted thresholds route through the same invalid-args boundary as flag validation.

- One family can still share a single outer command contract even when the inner presentation varies a lot.
  - `links run` mixes an Ink prompt with a runtime workflow.
  - `links view` mixes runtime-scoped TUI review callbacks with JSON browse output.
  - `links review` mixes spinners with a small text/json completion and localized text-only error rendering.
  - All three now use `runCliCommandBoundary(...)` without reintroducing throw-based command flow.

### Constraints confirmed

- Some text-only affordances still belong inside the command, not the shared boundary.
  - `links review` keeps its small Ink success/error flashes local because they are presentation details of that command family.
  - The important constraint is that those side effects happen before returning `CliCompletion` or `CliFailure`, not by bypassing the boundary entirely.

## Phase 14: `portfolio` + root `cost-basis` + final feature cleanup

### What worked

- The last command entrypoints fit the same contract without special casing.
  - `portfolio` now does JSON output and runtime-scoped TUI rendering through the shared boundary.
  - Root `cost-basis` now does the same, including prompt-driven parameter collection in text mode.

- JSON builders should return data, not write directly.
  - `cost-basis-json.ts` now builds the JSON payload instead of printing it.
  - That keeps command output flowing through the same success path as every other migrated command.

- Narrow feature-local errors are better than keeping one global CLI exception alive.
  - `accounts remove` no longer depends on `CliCommandError` for its not-found path.
  - A small accounts-local not-found error plus command-local mapping to `NOT_FOUND` kept the shared compatibility bridge from surviving longer than necessary.

### Constraints confirmed

- Finishing the feature migration before deleting compatibility wrappers is the right order.
  - After `portfolio` and root `cost-basis` moved, the only remaining legacy references were inside the shared compatibility layer itself, its tests, and stale comments/docs.
  - That makes the next cleanup phase focused and low-risk instead of interleaving feature migrations with shared helper removal.
