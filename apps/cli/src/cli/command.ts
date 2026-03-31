import { err, type Result } from '@exitbook/foundation';

import {
  runCliCommandBoundary as runSharedCliCommandBoundary,
  runCliRuntimeAction,
  runCliRuntimeCommand as runSharedCliRuntimeCommand,
} from '../features/shared/cli-boundary.js';
import {
  cliErr,
  createCliFailure,
  jsonSuccess,
  silentSuccess,
  textSuccess,
  toCliResult,
  toCliValue,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
  type CliJsonOutput,
  type CliNoOutput,
  type CliOutput,
  type CliTextOutput,
} from '../features/shared/cli-contract.js';
import { ExitCodes, type ExitCode } from '../features/shared/exit-codes.js';
import type { CliAppRuntime } from '../runtime/app-runtime.js';
import type { CommandRuntime } from '../runtime/command-runtime.js';

import type { CliOutputFormat } from './options.js';

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

interface CliPreparedRuntimeCommandOptions<TPrepared> extends CliRuntimeCommandBaseOptions {
  prepare: () => Promise<Result<TPrepared, CliFailure>>;
  action: (context: CliPreparedRuntimeContext<TPrepared>) => Promise<CliCommandResult>;
}

export async function runCliCommandBoundary(options: CliCommandBoundaryOptions): Promise<void> {
  await runSharedCliCommandBoundary(options);
}

// TODO(cli-phase-0-5): Inline shared boundary implementation here after command migrations complete.
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
    await runSharedCliRuntimeCommand({
      command: options.command,
      format: options.format,
      appRuntime: options.appRuntime,
      unexpectedErrorExitCode: options.unexpectedErrorExitCode,
      action: options.action,
    });
    return;
  }

  await runSharedCliCommandBoundary({
    command: options.command,
    format: options.format,
    unexpectedErrorExitCode: options.unexpectedErrorExitCode,
    action: async () => {
      const preparedResult = await options.prepare();

      if (preparedResult.isErr()) {
        return err(preparedResult.error);
      }

      return runCliRuntimeAction({
        command: options.command,
        appRuntime: options.appRuntime,
        unexpectedErrorExitCode: options.unexpectedErrorExitCode,
        action: async (runtime) => options.action({ runtime, prepared: preparedResult.value }),
      });
    },
  });
}

export { cliErr, createCliFailure, ExitCodes, jsonSuccess, silentSuccess, textSuccess, toCliResult, toCliValue };

export type {
  CliCommandResult,
  CliCompletion,
  CliFailure,
  CliJsonOutput,
  CliNoOutput,
  CliOutput,
  CliTextOutput,
  ExitCode,
};
