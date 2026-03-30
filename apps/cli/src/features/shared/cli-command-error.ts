import type { ExitCode } from './exit-codes.js';

/**
 * TODO(cli-rework): Legacy exception type for throw-based CLI boundaries.
 * Verify whether this is still needed once commands stop signaling expected
 * failures via exceptions.
 * @deprecated Prefer `CliFailure` result data over exception-based control
 * flow for expected CLI failures.
 */
export class CliCommandError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliCommandError';
    this.exitCode = exitCode;
  }
}

export function getCliCommandErrorExitCode(error: unknown): ExitCode | undefined {
  return error instanceof CliCommandError ? error.exitCode : undefined;
}
