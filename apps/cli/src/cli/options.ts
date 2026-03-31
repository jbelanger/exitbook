import { err, ok, type Result } from '@exitbook/foundation';
import { Command, type CommanderError } from 'commander';
import type { z } from 'zod';

import { ExitCodes, type ExitCode } from '../features/shared/exit-codes.js';

import { createCliFailure, type CliFailure } from './command.js';
import type { BrowseSurfaceSpec, ResolvedBrowsePresentation } from './presentation.js';
import { resolveBrowsePresentation } from './presentation.js';

export type CliOutputFormat = 'json' | 'text';

export interface CliBrowseRootInvocation {
  rawOptions: Record<string, unknown>;
  selector?: string | undefined;
}

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

export function detectCliTokenOutputFormat(tokens: string[] | undefined): CliOutputFormat {
  return tokens?.some((token) => token === '--json' || token.startsWith('--json=')) ? 'json' : 'text';
}

export function parseCliBrowseRootInvocationResult(
  tokens: string[] | undefined,
  registerBrowseOptions: (command: Command) => Command,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): Result<CliBrowseRootInvocation, CliFailure> {
  const parser = registerBrowseOptions(new Command())
    .argument('[selector]')
    .allowUnknownOption(false)
    .configureOutput({
      writeErr: () => undefined,
      writeOut: () => undefined,
    })
    .exitOverride();
  let selector: string | undefined;
  let rawOptions: Record<string, unknown> = {};

  parser.action((parsedSelector: string | undefined, parsedRawOptions: Record<string, unknown>) => {
    selector = parsedSelector;
    rawOptions = parsedRawOptions;
  });

  try {
    parser.parse(['node', 'command', ...(tokens ?? [])], { from: 'node' });
  } catch (error) {
    return createCliFailureResult(error, invalidExitCode);
  }

  return ok({
    selector,
    rawOptions,
  });
}

export function parseCliCommandOptionsResult<T>(
  rawOptions: unknown,
  schema: z.ZodType<T>,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): Result<T, CliFailure> {
  const parseResult = schema.safeParse(rawOptions);

  if (!parseResult.success) {
    return createCliFailureResult(
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      invalidExitCode
    );
  }

  return ok(parseResult.data);
}

export function parseCliBrowseOptionsResult<T>(
  rawOptions: unknown,
  schema: z.ZodType<T>,
  spec: BrowseSurfaceSpec,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): Result<{ options: T; presentation: ResolvedBrowsePresentation }, CliFailure> {
  const optionsResult = parseCliCommandOptionsResult(rawOptions, schema, invalidExitCode);

  if (optionsResult.isErr()) {
    return err(optionsResult.error);
  }

  try {
    return ok({
      presentation: resolveBrowsePresentation(spec, rawOptions),
      options: optionsResult.value,
    });
  } catch (error) {
    return createCliFailureResult(error, invalidExitCode);
  }
}

function toCliError(error: unknown): Error {
  if (isCommanderError(error)) {
    return new Error(error.message);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isCommanderError(error: unknown): error is CommanderError {
  return typeof error === 'object' && error !== null && 'code' in error && 'exitCode' in error && 'message' in error;
}

function createCliFailureResult(error: unknown, exitCode: ExitCode): Result<never, CliFailure> {
  return err(createCliFailure(toCliError(error), exitCode));
}
