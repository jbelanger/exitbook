import type { ExitCode } from './exit-codes.js';

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
