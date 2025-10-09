import * as p from '@clack/prompts';
import { getLogger } from '@exitbook/shared-logger';
import pc from 'picocolors';

import type { CLIResponse } from './cli-response.ts';
import { createErrorResponse, createSuccessResponse, exitCodeToErrorCode } from './cli-response.ts';
import { ExitCodes, type ExitCode } from './exit-codes.js';

const logger = getLogger('OutputManager');

export type OutputFormat = 'json' | 'text';

/**
 * OutputManager handles formatting and displaying CLI output.
 * Supports both human-readable text output and machine-readable JSON.
 */
export class OutputManager {
  private startTime: number = Date.now();

  constructor(private format: OutputFormat = 'text') {}

  /**
   * Check if output is in JSON mode.
   */
  isJsonMode(): boolean {
    return this.format === 'json';
  }

  /**
   * Check if output is in text mode.
   */
  isTextMode(): boolean {
    return this.format === 'text';
  }

  /**
   * Output a success response.
   */
  success<T>(command: string, data: T, metadata?: Record<string, unknown>): void {
    const duration_ms = Date.now() - this.startTime;
    const response = createSuccessResponse(command, data, {
      duration_ms,
      ...metadata,
    });

    if (this.format === 'json') {
      console.log(JSON.stringify(response, undefined, 2));
    } else {
      this.displayTextSuccess(response);
    }
  }

  /**
   * Output an error response and exit.
   */
  error(command: string, error: Error, exitCode: ExitCode = ExitCodes.GENERAL_ERROR): never {
    const errorCode = exitCodeToErrorCode(exitCode);
    const response = createErrorResponse(command, error, errorCode);

    if (this.format === 'json') {
      console.error(JSON.stringify(response, undefined, 2));
    } else {
      this.displayTextError(error, errorCode);
    }

    process.exit(exitCode);
  }

  /**
   * Display a spinner (only in text mode).
   */
  spinner(): ReturnType<typeof p.spinner> | undefined {
    if (this.format === 'json') {
      return undefined;
    }
    return p.spinner();
  }

  /**
   * Display an intro message (only in text mode).
   */
  intro(message: string): void {
    if (this.format === 'text') {
      p.intro(pc.bgCyan(pc.black(` ${message} `)));
    }
  }

  /**
   * Display an outro message (only in text mode).
   */
  outro(message: string): void {
    if (this.format === 'text') {
      p.outro(pc.green(message));
    }
  }

  /**
   * Display a note (only in text mode).
   */
  note(message: string, title?: string): void {
    if (this.format === 'text') {
      p.note(message, title);
    }
  }

  /**
   * Display a log message (only in text mode).
   */
  log(message: string): void {
    if (this.format === 'text') {
      p.log.message(message);
    }
  }

  /**
   * Display a warning (only in text mode).
   */
  warn(message: string): void {
    if (this.format === 'text') {
      p.log.warn(pc.yellow(message));
    } else {
      // In JSON mode, warnings go to stderr as structured logs
      logger.warn(message);
    }
  }

  /**
   * Display progress information (only in text mode, goes to stderr in JSON mode).
   */
  progress(message: string, current?: number, total?: number): void {
    if (this.format === 'text') {
      if (current !== undefined && total !== undefined) {
        const percentage = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
        p.log.message(`${message} [${bar}] ${percentage}%`);
      } else {
        p.log.message(message);
      }
    } else {
      // In JSON mode, send progress to stderr so it doesn't interfere with JSON output
      console.error(
        JSON.stringify({
          type: 'progress',
          message,
          current,
          total,
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  /**
   * Display success in text format.
   */
  private displayTextSuccess<T>(response: CLIResponse<T>): void {
    // Override for specific command types
    // Subclasses or command handlers can customize this
    logger.info(`Command '${response.command}' completed successfully`);
  }

  /**
   * Display error in text format.
   */
  private displayTextError(error: Error, code: string): void {
    p.log.error(`${pc.red('Error')}: ${error.message}`);

    if (code === 'INVALID_ARGS') {
      p.note('Check your command arguments and try again.\nRun with --help for usage information.', 'Tip');
    } else if (code === 'AUTHENTICATION_ERROR') {
      p.note(
        'Check your API credentials in the .env file or pass them as arguments.\nExample: --api-key YOUR_KEY --api-secret YOUR_SECRET',
        'How to fix'
      );
    } else if (code === 'NOT_FOUND') {
      p.note('The requested resource was not found.\nDouble-check the name or ID and try again.', 'Tip');
    } else if (code === 'RATE_LIMIT') {
      p.note(
        'You have exceeded the API rate limit.\nWait a few minutes and try again, or configure rate limits in blockchain-explorers.json',
        'How to fix'
      );
    }

    // Show stack trace in development
    if (process.env.NODE_ENV === 'development' && error.stack) {
      logger.debug(`Stack trace:\n${error.stack}`);
    }
  }
}
