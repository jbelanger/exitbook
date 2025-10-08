/**
 * Semantic exit codes for the CLI.
 * Following POSIX conventions and best practices.
 */
export const ExitCodes = {
  /** Successful execution */
  SUCCESS: 0,

  /** General error (catch-all) */
  GENERAL_ERROR: 1,

  /** Invalid command arguments or options */
  INVALID_ARGS: 2,

  /** Authentication or credentials error */
  AUTHENTICATION_ERROR: 3,

  /** Resource not found (file, address, session, etc.) */
  NOT_FOUND: 4,

  /** Rate limit exceeded */
  RATE_LIMIT: 5,

  /** Network or connectivity error */
  NETWORK_ERROR: 6,

  /** Database error */
  DATABASE_ERROR: 7,

  /** Validation error (data validation failed) */
  VALIDATION_ERROR: 8,

  /** Operation cancelled by user */
  CANCELLED: 9,

  /** Timeout error */
  TIMEOUT: 10,

  /** Configuration error */
  CONFIG_ERROR: 11,

  /** Permission denied */
  PERMISSION_DENIED: 13,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

/**
 * Exit the process with a specific exit code.
 * Use this instead of process.exit() for better tracking.
 */
export function exitWithCode(code: ExitCode): never {
  process.exit(code);
}
