import { err, ok, type Result } from '@exitbook/foundation';

import type { ExitCode } from './exit-codes.js';

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

export function normalizeCliError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
