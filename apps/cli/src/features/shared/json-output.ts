import { createSuccessResponse } from './cli-response.js';

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
