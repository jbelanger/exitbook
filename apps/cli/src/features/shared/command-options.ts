import type { z } from 'zod';

import { getCliCommandErrorExitCode } from './cli-command-error.js';
import { displayCliError } from './cli-error.js';
import { ExitCodes, type ExitCode } from './exit-codes.js';
import type { BrowseSurfaceSpec, ResolvedBrowsePresentation } from './presentation/browse-surface.js';
import { resolveBrowsePresentation } from './presentation/browse-surface.js';

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

export function detectCliOutputFormat(rawOptions: unknown): CliOutputFormat {
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

export function parseCliBrowseOptions<T>(
  command: string,
  rawOptions: unknown,
  schema: z.ZodType<T>,
  spec: BrowseSurfaceSpec,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): { options: T; presentation: ResolvedBrowsePresentation } {
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

  let presentation: ResolvedBrowsePresentation;
  try {
    presentation = resolveBrowsePresentation(spec, rawOptions);
  } catch (error) {
    displayCliError(command, toCliError(error), invalidExitCode, format);
  }

  return {
    presentation,
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
    displayCliError(command, toCliError(error), getCliCommandErrorExitCode(error) ?? exitCode, format);
  }
}
