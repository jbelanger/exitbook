import pc from 'picocolors';

import { createCliFailure, type CliFailure } from './cli-contract.js';
import { createErrorResponse, exitCodeToErrorCode } from './cli-response.js';
import type { ExitCode } from './exit-codes.js';

/**
 * Tips shown after error messages, keyed by error code.
 */
const ERROR_TIPS: Record<string, string> = {
  INVALID_ARGS: 'Check your command arguments and try again. Run with --help for usage information.',
  AUTHENTICATION_ERROR:
    'Check your API credentials in the .env file or pass them as arguments (--api-key YOUR_KEY --api-secret YOUR_SECRET).',
  NOT_FOUND: 'The requested resource was not found. Double-check the name or ID and try again.',
  RATE_LIMIT:
    'You have exceeded the API rate limit. Wait a few minutes and try again, or configure rate limits in blockchain-explorers.json.',
};

/**
 * Display a CLI error and exit.
 *
 * Centralized error handling for CLI commands.
 * - Text mode: formatted error to stderr with contextual tips
 * - JSON mode: structured JSON error to stdout
 *
 * TODO(cli-rework): Legacy compatibility wrapper for commands that still exit
 * from deep helper layers. Verify whether this can be deleted once command
 * migrations route failures through `runCliCommandBoundary(...)` /
 * `exitCliFailure(...)`.
 * @deprecated Prefer returning `CliFailure` data and letting the shared
 * boundary own rendering and termination.
 */
export function displayCliError(command: string, error: Error, exitCode: ExitCode, format: 'json' | 'text'): never {
  return exitCliFailure(command, createCliFailure(error, exitCode), format);
}

export function writeCliFailure(command: string, failure: CliFailure, format: 'json' | 'text'): void {
  const code = exitCodeToErrorCode(failure.exitCode);

  if (format === 'json') {
    console.log(JSON.stringify(createErrorResponse(command, failure.error, code, failure.details), undefined, 2));
    return;
  }

  process.stderr.write(`\n${pc.red('✗')} Error: ${failure.error.message}\n`);

  const tip = ERROR_TIPS[code];
  if (tip) {
    process.stderr.write(`\n${pc.dim(tip)}\n`);
  }

  // In development, show full stack trace
  if (process.env['NODE_ENV'] === 'development' && failure.error.stack) {
    process.stderr.write(`\n${pc.dim(failure.error.stack)}\n\n`);
  }
}

export function exitCliFailure(command: string, failure: CliFailure, format: 'json' | 'text'): never {
  writeCliFailure(command, failure, format);
  process.exit(failure.exitCode);
}
