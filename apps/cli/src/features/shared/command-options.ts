import type { z } from 'zod';

import { displayCliError } from './cli-error.js';
import { ExitCodes, type ExitCode } from './exit-codes.js';

export type CliOutputFormat = 'json' | 'text';

function hasBooleanJsonFlag(value: unknown): value is { json?: boolean | undefined } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('json' in value)) {
    return true;
  }

  return typeof (value as { json: unknown }).json === 'boolean';
}

function detectCliOutputFormat(rawOptions: unknown): CliOutputFormat {
  return hasBooleanJsonFlag(rawOptions) && rawOptions.json === true ? 'json' : 'text';
}

export function parseCliCommandOptions<T>(
  command: string,
  rawOptions: unknown,
  schema: z.ZodType<T>,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): { format: CliOutputFormat; options: T } {
  const format = detectCliOutputFormat(rawOptions);
  const parseResult = schema.safeParse(rawOptions);

  if (!parseResult.success) {
    displayCliError(
      command,
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      invalidExitCode,
      format
    );
  }

  return {
    format,
    options: parseResult.data,
  };
}

function toCliError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function withCliCommandErrorHandling(
  command: string,
  format: CliOutputFormat,
  action: () => Promise<void>,
  exitCode: ExitCode = ExitCodes.GENERAL_ERROR
): Promise<void> {
  try {
    await action();
  } catch (error) {
    displayCliError(command, toCliError(error), exitCode, format);
  }
}
