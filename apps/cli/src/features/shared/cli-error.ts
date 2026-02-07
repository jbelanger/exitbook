import pc from 'picocolors';

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
 * Replaces OutputManager.error() for Ink-based commands.
 * - Text mode: formatted error to stderr with contextual tips
 * - JSON mode: structured JSON error to stdout
 */
export function displayCliError(command: string, error: Error, exitCode: ExitCode, format: 'json' | 'text'): never {
  const code = exitCodeToErrorCode(exitCode);

  if (format === 'json') {
    console.log(JSON.stringify(createErrorResponse(command, error, code), undefined, 2));
  } else {
    process.stderr.write(`\n${pc.red('✗')} Error: ${error.message}\n`);

    const tip = ERROR_TIPS[code];
    if (tip) {
      process.stderr.write(`\n${pc.dim(tip)}\n`);
    }

    // In development, show full stack trace
    if (process.env['NODE_ENV'] === 'development' && error.stack) {
      process.stderr.write(`\n${pc.dim(error.stack)}\n\n`);
    }
  }

  process.exit(exitCode);
}
