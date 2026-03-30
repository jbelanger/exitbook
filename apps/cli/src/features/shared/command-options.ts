import { err, ok, type Result } from '@exitbook/foundation';
import { Command, type CommanderError } from 'commander';
import type { z } from 'zod';

import { getCliCommandErrorExitCode } from './cli-command-error.js';
import type { CliFailure } from './cli-contract.js';
import { createCliFailure } from './cli-contract.js';
import { displayCliError } from './cli-error.js';
import { ExitCodes, type ExitCode } from './exit-codes.js';
import type { BrowseSurfaceSpec, ResolvedBrowsePresentation } from './presentation/browse-surface.js';
import { resolveBrowsePresentation } from './presentation/browse-surface.js';

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

/**
 * TODO(cli-rework): Legacy compatibility wrapper that still exits during
 * parsing. Verify whether this is still needed once callers migrate to
 * `parseCliBrowseRootInvocationResult(...)`.
 * @deprecated Prefer the `*Result(...)` parse helpers in new migrations.
 */
export function parseCliBrowseRootInvocation(
  command: string,
  tokens: string[] | undefined,
  registerBrowseOptions: (command: Command) => Command,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): CliBrowseRootInvocation {
  const format = detectCliTokenOutputFormat(tokens);
  const invocationResult = parseCliBrowseRootInvocationResult(tokens, registerBrowseOptions, invalidExitCode);

  if (invocationResult.isErr()) {
    displayCliError(command, invocationResult.error.error, invocationResult.error.exitCode, format);
  }

  return invocationResult.value;
}

export function parseCliBrowseRootInvocationResult(
  tokens: string[] | undefined,
  registerBrowseOptions: (command: Command) => Command,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): Result<CliBrowseRootInvocation, CliFailure> {
  // Why this exists:
  // a browse root like `accounts [selector] [options]` also acts as the parent
  // namespace for subcommands like `accounts view` and `accounts add`. Commander
  // cannot express that shape cleanly without parent options bleeding into
  // subcommands, so the real root command captures raw tokens and this throwaway
  // parser re-applies strict browse option parsing only when the bare root form
  // is actually invoked.
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

/**
 * TODO(cli-rework): Legacy compatibility wrapper that still exits during
 * parsing. Verify whether this is still needed once callers migrate to
 * `parseCliCommandOptionsResult(...)`.
 * @deprecated Prefer the `*Result(...)` parse helpers in new migrations.
 */
export function parseCliCommandOptions<T>(
  command: string,
  rawOptions: unknown,
  schema: z.ZodType<T>,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): { format: CliOutputFormat; options: T } {
  const format = detectCliOutputFormat(rawOptions);
  const optionsResult = parseCliCommandOptionsResult(rawOptions, schema, invalidExitCode);

  if (optionsResult.isErr()) {
    displayCliError(command, optionsResult.error.error, optionsResult.error.exitCode, format);
  }

  return {
    format,
    options: optionsResult.value,
  };
}

/**
 * TODO(cli-rework): Legacy compatibility wrapper that still exits during
 * parsing. Verify whether this is still needed once callers migrate to
 * `parseCliBrowseOptionsResult(...)`.
 * @deprecated Prefer the `*Result(...)` parse helpers in new migrations.
 */
export function parseCliBrowseOptions<T>(
  command: string,
  rawOptions: unknown,
  schema: z.ZodType<T>,
  spec: BrowseSurfaceSpec,
  invalidExitCode: ExitCode = ExitCodes.INVALID_ARGS
): { options: T; presentation: ResolvedBrowsePresentation } {
  const format = detectCliOutputFormat(rawOptions);
  const browseOptionsResult = parseCliBrowseOptionsResult(rawOptions, schema, spec, invalidExitCode);

  if (browseOptionsResult.isErr()) {
    displayCliError(command, browseOptionsResult.error.error, browseOptionsResult.error.exitCode, format);
  }

  return browseOptionsResult.value;
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

function detectCliTokenOutputFormat(tokens: string[] | undefined): CliOutputFormat {
  return tokens?.some((token) => token === '--json' || token.startsWith('--json=')) ? 'json' : 'text';
}

function isCommanderError(error: unknown): error is CommanderError {
  return typeof error === 'object' && error !== null && 'code' in error && 'exitCode' in error && 'message' in error;
}

/**
 * TODO(cli-rework): Legacy throw-based boundary wrapper kept for compatibility
 * with commands that still rely on `CliCommandError`. Verify whether this is
 * still needed once all commands use `runCliCommandBoundary(...)`.
 * @deprecated Prefer `runCliCommandBoundary(...)` / `runCliRuntimeCommand(...)`
 * and `CliFailure` results.
 */
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

function createCliFailureResult(error: unknown, exitCode: ExitCode): Result<never, CliFailure> {
  return err(createCliFailure(toCliError(error), exitCode));
}
