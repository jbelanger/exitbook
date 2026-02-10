import { createErrorResponse, createSuccessResponse, exitCodeToErrorCode } from './cli-response.js';
import type { ExitCode } from './exit-codes.js';

/**
 * Output a success response in JSON format.
 * Writes to stdout and does NOT exit.
 *
 * @example
 * ```typescript
 * outputSuccess('import', { imported: 100, skipped: 5 }, { duration_ms: 1234 });
 * ```
 */
export function outputSuccess<T>(command: string, data: T, metadata?: Record<string, unknown>): void {
  const response = createSuccessResponse(command, data, metadata);
  console.log(JSON.stringify(response, undefined, 2));
}

/**
 * Output an error response in JSON format and exit.
 * Writes to stdout (not stderr) so callers can parse the JSON response.
 *
 * @example
 * ```typescript
 * outputError('import', new Error('Invalid address'), ExitCodes.INVALID_ARGS);
 * // Exits with code 2
 * ```
 */
export function outputError(command: string, error: Error, exitCode: ExitCode): never {
  const errorCode = exitCodeToErrorCode(exitCode);
  const response = createErrorResponse(command, error, errorCode);

  // In JSON mode, write to stdout (not stderr) so callers can parse the response
  console.log(JSON.stringify(response, undefined, 2));
  process.exit(exitCode);
}
