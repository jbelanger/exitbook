/* eslint-disable unicorn/no-null -- Used in React component code */
import { TransactionLinkRepository } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { configureLogger, getLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { LinksRunController } from '../../ui/links/index.js';
import { PromptFlow, type PromptStep } from '../../ui/shared/PromptFlow.js';
import { displayCliError } from '../shared/cli-error.js';
import { createSuccessResponse } from '../shared/cli-response.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { LinksRunCommandOptionsSchema } from '../shared/schemas.js';

import type { LinkingEvent } from './events.js';
import type { LinksRunHandlerParams } from './links-run-handler.js';
import { LinksRunHandler } from './links-run-handler.js';

const logger = getLogger('links-run');

/**
 * Command options validated by Zod at CLI boundary
 */
type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

/**
 * Build links run parameters from validated CLI options.
 */
function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): LinksRunHandlerParams {
  return {
    dryRun: options.dryRun ?? false,
    minConfidenceScore: parseDecimal(options.minConfidence?.toString() ?? '0.7'),
    autoConfirmThreshold: parseDecimal(options.autoConfirmThreshold?.toString() ?? '0.95'),
  };
}

/**
 * Prompt user for links run parameters in interactive mode using Ink.
 */
async function promptForLinksRunParams(): Promise<LinksRunHandlerParams | null> {
  return new Promise<LinksRunHandlerParams | null>((resolve) => {
    const steps: PromptStep[] = [
      {
        type: 'confirm',
        props: {
          message: 'Run in dry-run mode (preview matches without saving)?',
          initialValue: false,
        },
      },
      {
        type: 'text',
        props: {
          message: 'Minimum confidence score (0-1):',
          placeholder: '0.7',
          validate: (value) => {
            if (!value) return; // Allow empty for default
            const num = Number(value);
            if (Number.isNaN(num) || num < 0 || num > 1) {
              return 'Must be a number between 0 and 1';
            }
          },
        },
      },
      {
        type: 'text',
        props: {
          message: 'Auto-confirm threshold (0-1):',
          placeholder: '0.95',
          validate: (value) => {
            if (!value) return; // Allow empty for default
            const num = Number(value);
            if (Number.isNaN(num) || num < 0 || num > 1) {
              return 'Must be a number between 0 and 1';
            }
          },
        },
      },
      {
        type: 'confirm',
        props: {
          message: 'Start transaction linking?',
          initialValue: true,
        },
      },
    ];

    const { unmount } = render(
      React.createElement(PromptFlow, {
        title: 'exitbook links-run',
        steps,
        onComplete: (answers) => {
          unmount();

          const dryRun = answers[0] as boolean;
          const minConfidenceInput = answers[1] as string;
          const autoConfirmInput = answers[2] as string;
          const shouldProceed = answers[3] as boolean;

          if (!shouldProceed) {
            resolve(null);
            return;
          }

          // Validate auto-confirm >= min confidence
          const minConfidence = Number(minConfidenceInput);
          const autoConfirm = Number(autoConfirmInput);
          if (autoConfirm < minConfidence) {
            console.error('\n⚠ Error: Auto-confirm threshold must be >= minimum confidence score');
            resolve(null);
            return;
          }

          resolve({
            dryRun,
            minConfidenceScore: parseDecimal(minConfidenceInput),
            autoConfirmThreshold: parseDecimal(autoConfirmInput),
          });
        },
        onCancel: () => {
          unmount();
          resolve(null);
        },
      })
    );
  });
}

/**
 * Register the links run subcommand.
 */
export function registerLinksRunCommand(linksCommand: Command): void {
  linksCommand
    .command('run')
    .description('Run the linking algorithm to find matching transactions across sources')
    .option('--dry-run', 'Show matches without saving to database')
    .option('--min-confidence <score>', 'Minimum confidence threshold (0-1, default: 0.7)', parseFloat)
    .option('--auto-confirm-threshold <score>', 'Auto-confirm above this score (0-1, default: 0.95)', parseFloat)
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksRunCommand(rawOptions);
    });
}

/**
 * Execute the links run command.
 */
async function executeLinksRunCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary
  const parseResult = LinksRunCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'links-run',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJsonMode ? 'json' : 'text'
    );
  }

  const options = parseResult.data;
  const startTime = Date.now();

  try {
    let params: LinksRunHandlerParams;
    if (!options.dryRun && !options.minConfidence && !options.autoConfirmThreshold && !options.json) {
      const result = await promptForLinksRunParams();
      if (!result) {
        console.log('\nTransaction linking cancelled');
        return;
      }
      params = result;
    } else {
      params = buildLinksRunParamsFromFlags(options);
    }

    // Configure logger for JSON mode or text mode
    configureLogger({
      mode: options.json ? 'json' : 'text',
      verbose: false,
      sinks: {
        ui: false,
        structured: options.json ? 'off' : 'file', // Logs to file in text mode, keeps console clean
      },
    });

    const { OverrideStore } = await import('@exitbook/data');
    const database = await initializeDatabase();
    const transactionRepository = new TransactionRepository(database);
    const linkRepository = new TransactionLinkRepository(database);
    const overrideStore = new OverrideStore();

    // JSON mode - run without UI
    if (options.json) {
      const handler = new LinksRunHandler(transactionRepository, linkRepository, overrideStore);

      try {
        const result = await handler.execute(params);

        await closeDatabase(database);
        resetLoggerContext();

        if (result.isErr()) {
          displayCliError('links-run', result.error, ExitCodes.GENERAL_ERROR, 'json');
          return;
        }

        const duration_ms = Date.now() - startTime;
        const response = createSuccessResponse('links-run', result.value, { duration_ms });
        console.log(JSON.stringify(response, undefined, 2));
      } catch (error) {
        await closeDatabase(database);
        resetLoggerContext();
        throw error;
      }
      return;
    }

    // Ink TUI mode
    const eventBus = new EventBus<LinkingEvent>({
      onError: (err) => {
        logger.error({ err }, 'EventBus error');
      },
    });
    const controller = new LinksRunController(eventBus, params.dryRun);

    // Handle Ctrl-C gracefully
    const abortHandler = () => {
      process.off('SIGINT', abortHandler);
      controller.abort();
      controller.stop().catch(() => {
        /* ignore cleanup errors on abort */
      });
      closeDatabase(database).catch((_err) => {
        /* ignore cleanup errors on abort */
      });
      resetLoggerContext();
      process.exit(130);
    };
    process.on('SIGINT', abortHandler);

    controller.start();

    const handler = new LinksRunHandler(transactionRepository, linkRepository, overrideStore, eventBus);

    try {
      const result = await handler.execute(params);

      await closeDatabase(database);
      resetLoggerContext();
      process.off('SIGINT', abortHandler);

      if (result.isErr()) {
        controller.fail(result.error.message);
        await controller.stop();
        process.exit(ExitCodes.GENERAL_ERROR);
      } else {
        controller.complete();
        await controller.stop();
        // Success path exits naturally after event loop drains.
      }
    } catch (error) {
      await closeDatabase(database);
      resetLoggerContext();
      process.off('SIGINT', abortHandler);
      controller.fail(error instanceof Error ? error.message : String(error));
      await controller.stop();
      process.exit(ExitCodes.GENERAL_ERROR);
    }
  } catch (error) {
    resetLoggerContext();
    displayCliError(
      'links-run',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      isJsonMode ? 'json' : 'text'
    );
  }
}
