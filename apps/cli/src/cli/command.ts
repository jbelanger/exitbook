import { err, ok, type Result } from '@exitbook/foundation';

import type { CliAppRuntime } from '../runtime/app-runtime.js';
import { CommandRuntime, runCommand } from '../runtime/command-runtime.js';

import { exitCliFailure } from './error.js';
import { ExitCodes, type ExitCode } from './exit-codes.js';
import type { CliOutputFormat } from './options.js';
import { outputSuccess } from './output.js';

interface CliCommandBoundaryOptions {
  command: string;
  format: CliOutputFormat;
  action: () => Promise<CliCommandResult>;
  unexpectedErrorExitCode?: ExitCode | undefined;
}

interface CliRuntimeCommandBaseOptions {
  command: string;
  format: CliOutputFormat;
  appRuntime?: CliAppRuntime | undefined;
  unexpectedErrorExitCode?: ExitCode | undefined;
}

interface CliSimpleRuntimeCommandOptions extends CliRuntimeCommandBaseOptions {
  action: (runtime: CommandRuntime) => Promise<CliCommandResult>;
}

interface CliPreparedRuntimeContext<TPrepared> {
  prepared: TPrepared;
  runtime: CommandRuntime;
}

const CLI_RUNTIME_PREPARATION_MARKER = Symbol('CliRuntimePreparation');

interface CliRuntimeCompletionStep {
  readonly [CLI_RUNTIME_PREPARATION_MARKER]: 'complete';
  readonly completion: CliCompletion;
}

interface CliPreparedRuntimeCommandOptions<TPrepared> extends CliRuntimeCommandBaseOptions {
  prepare: () => Promise<Result<TPrepared | CliRuntimeCompletionStep, CliFailure>>;
  action: (context: CliPreparedRuntimeContext<TPrepared>) => Promise<CliCommandResult>;
}

interface CliRuntimeActionOptions {
  command: string;
  action: (runtime: CommandRuntime) => Promise<CliCommandResult>;
  appRuntime?: CliAppRuntime | undefined;
  unexpectedErrorExitCode?: ExitCode | undefined;
}

export interface CliFailure {
  error: Error;
  exitCode: ExitCode;
  details?: unknown;
}

export interface CliJsonOutput {
  kind: 'json';
  data: unknown;
  metadata?: Record<string, unknown> | undefined;
}

export interface CliTextOutput {
  kind: 'text';
  render: () => void | Promise<void>;
}

export interface CliNoOutput {
  kind: 'none';
}

export type CliOutput = CliJsonOutput | CliTextOutput | CliNoOutput;

export interface CliCompletion {
  exitCode?: ExitCode | undefined;
  output?: CliOutput | undefined;
}

export type CliCommandResult = Result<CliCompletion, CliFailure>;

export function createCliFailure(error: unknown, exitCode: ExitCode, details?: unknown): CliFailure {
  const failure: CliFailure = {
    error: normalizeCliError(error),
    exitCode,
  };

  if (details !== undefined) {
    failure.details = details;
  }

  return failure;
}

export function cliErr<T = never>(error: unknown, exitCode: ExitCode, details?: unknown): Result<T, CliFailure> {
  return err(createCliFailure(error, exitCode, details));
}

export function toCliResult<T>(result: Result<T, Error>, exitCode: ExitCode, details?: unknown): Result<T, CliFailure> {
  if (result.isErr()) {
    return err(createCliFailure(result.error, exitCode, details));
  }

  return ok(result.value);
}

export function toCliValue<T>(
  value: T | undefined,
  error: unknown,
  exitCode: ExitCode,
  details?: unknown
): Result<T, CliFailure> {
  if (value === undefined) {
    return err(createCliFailure(error, exitCode, details));
  }

  return ok(value);
}

export function jsonSuccess(data: unknown, metadata?: Record<string, unknown>, exitCode?: ExitCode): CliCompletion {
  return {
    exitCode,
    output: {
      kind: 'json',
      data,
      metadata,
    },
  };
}

export function textSuccess(render: () => void | Promise<void>, exitCode?: ExitCode): CliCompletion {
  return {
    exitCode,
    output: {
      kind: 'text',
      render,
    },
  };
}

export function silentSuccess(exitCode?: ExitCode): CliCompletion {
  return {
    exitCode,
    output: {
      kind: 'none',
    },
  };
}

export function completeCliRuntime(completion: CliCompletion): CliRuntimeCompletionStep {
  return {
    [CLI_RUNTIME_PREPARATION_MARKER]: 'complete',
    completion,
  };
}

export async function runCliCommandBoundary({
  command,
  format,
  action,
  unexpectedErrorExitCode = ExitCodes.GENERAL_ERROR,
}: CliCommandBoundaryOptions): Promise<void> {
  let result: CliCommandResult;

  try {
    result = await action();
  } catch (error) {
    exitCliFailure(command, createCliFailure(error, unexpectedErrorExitCode), format);
  }

  if (result.isErr()) {
    exitCliFailure(command, result.error, format);
  }

  try {
    await renderCliCompletion(command, result.value);
  } catch (error) {
    exitCliFailure(command, createCliFailure(error, unexpectedErrorExitCode), format);
  }

  if (result.value.exitCode !== undefined && result.value.exitCode !== ExitCodes.SUCCESS) {
    process.exit(result.value.exitCode);
  }
}

// REQUIRES_INVESTIGATION(cli-phase-0-5): Prepared-runtime calls can require an explicit generic in some command
// entrypoints for clean overload resolution. Revisit if this keeps spreading during migration.
export async function runCliRuntimeCommand(options: CliSimpleRuntimeCommandOptions): Promise<void>;
export async function runCliRuntimeCommand<TPrepared>(
  options: CliPreparedRuntimeCommandOptions<TPrepared>
): Promise<void>;
export async function runCliRuntimeCommand<TPrepared>(
  options: CliSimpleRuntimeCommandOptions | CliPreparedRuntimeCommandOptions<TPrepared>
): Promise<void> {
  if (!('prepare' in options)) {
    const runtimeOptions: CliSimpleRuntimeCommandOptions = options;

    await runCliCommandBoundary({
      command: runtimeOptions.command,
      format: runtimeOptions.format,
      unexpectedErrorExitCode: runtimeOptions.unexpectedErrorExitCode,
      action: async () =>
        runCliRuntimeAction({
          command: runtimeOptions.command,
          appRuntime: runtimeOptions.appRuntime,
          unexpectedErrorExitCode: runtimeOptions.unexpectedErrorExitCode,
          action: runtimeOptions.action,
        }),
    });
    return;
  }

  const preparedOptions: CliPreparedRuntimeCommandOptions<TPrepared> = options;

  await runCliCommandBoundary({
    command: preparedOptions.command,
    format: preparedOptions.format,
    unexpectedErrorExitCode: preparedOptions.unexpectedErrorExitCode,
    action: async () => {
      const preparedResult = await preparedOptions.prepare();

      if (preparedResult.isErr()) {
        return err(preparedResult.error);
      }

      const preparedValue = preparedResult.value;

      if (isCliRuntimeCompletionStep(preparedValue)) {
        return ok(preparedValue.completion);
      }

      return runCliRuntimeAction({
        command: preparedOptions.command,
        appRuntime: preparedOptions.appRuntime,
        unexpectedErrorExitCode: preparedOptions.unexpectedErrorExitCode,
        action: async (runtime: CommandRuntime) => preparedOptions.action({ runtime, prepared: preparedValue }),
      });
    },
  });
}

async function runCliRuntimeAction(options: CliRuntimeActionOptions): Promise<CliCommandResult> {
  const command = options.command;
  const runtimeAction: (runtime: CommandRuntime) => Promise<CliCommandResult> = options.action;
  const appRuntime = options.appRuntime;
  const unexpectedErrorExitCode = options.unexpectedErrorExitCode ?? ExitCodes.GENERAL_ERROR;
  let result: CliCommandResult | undefined;

  const captureResult = async (runtime: CommandRuntime) => {
    result = await runtimeAction(runtime);
  };

  if (appRuntime === undefined) {
    await runCommand(captureResult);
  } else {
    await runCommand(appRuntime, captureResult);
  }

  return (
    result ?? err(createCliFailure(new Error(`Command '${command}' returned no outcome`), unexpectedErrorExitCode))
  );
}

async function renderCliCompletion(command: string, completion: CliCompletion): Promise<void> {
  if (completion.output === undefined || completion.output.kind === 'none') {
    return;
  }

  if (completion.output.kind === 'json') {
    outputSuccess(command, completion.output.data, completion.output.metadata);
    return;
  }

  await completion.output.render();
}

function normalizeCliError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isCliRuntimeCompletionStep<TPrepared>(
  value: TPrepared | CliRuntimeCompletionStep
): value is CliRuntimeCompletionStep {
  return (
    typeof value === 'object' &&
    value !== null &&
    CLI_RUNTIME_PREPARATION_MARKER in value &&
    value[CLI_RUNTIME_PREPARATION_MARKER] === 'complete'
  );
}

export { ExitCodes };

export type { ExitCode };
