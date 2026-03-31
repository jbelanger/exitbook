import { createSuccessResponse } from './response.js';

/**
 * Output a success response in JSON format.
 * Writes to stdout and does NOT exit.
 */
export function outputSuccess<T>(command: string, data: T, metadata?: Record<string, unknown>): void {
  const response = createSuccessResponse(command, data, metadata);
  console.log(JSON.stringify(response, undefined, 2));
}
