import { err } from '@exitbook/foundation';

import type { CliAppRuntime } from '../../runtime/app-runtime.js';
import { CommandRuntime, runCommand } from '../../runtime/command-runtime.js';

import type { CliCommandResult, CliCompletion } from './cli-contract.js';
import { createCliFailure } from './cli-contract.js';
import { exitCliFailure } from './cli-error.js';
import type { CliOutputFormat } from './cli-output-format.js';
import { ExitCodes, type ExitCode } from './exit-codes.js';
import { outputSuccess } from './json-output.js';

interface CliBoundaryOptions {
  command: string;
  format: CliOutputFormat;
  action: () => Promise<CliCommandResult>;
  unexpectedErrorExitCode?: ExitCode | undefined;
}

interface CliRuntimeBoundaryOptions {
  command: string;
  format: CliOutputFormat;
  action: (runtime: CommandRuntime) => Promise<CliCommandResult>;
  appRuntime?: CliAppRuntime | undefined;
  unexpectedErrorExitCode?: ExitCode | undefined;
}

export async function runCliCommandBoundary({
  command,
  format,
  action,
  unexpectedErrorExitCode = ExitCodes.GENERAL_ERROR,
}: CliBoundaryOptions): Promise<void> {
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

export async function captureCliRuntimeResult({
  command,
  action,
  appRuntime,
  unexpectedErrorExitCode = ExitCodes.GENERAL_ERROR,
}: Omit<CliRuntimeBoundaryOptions, 'format'>): Promise<CliCommandResult> {
  let result: CliCommandResult | undefined;

  const captureResult = async (runtime: CommandRuntime) => {
    result = await action(runtime);
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

export async function runCliRuntimeCommand({
  command,
  format,
  action,
  appRuntime,
  unexpectedErrorExitCode = ExitCodes.GENERAL_ERROR,
}: CliRuntimeBoundaryOptions): Promise<void> {
  await runCliCommandBoundary({
    command,
    format,
    unexpectedErrorExitCode,
    action: async () => captureCliRuntimeResult({ command, action, appRuntime, unexpectedErrorExitCode }),
  });
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
