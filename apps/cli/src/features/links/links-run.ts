/* eslint-disable unicorn/no-null -- Used in React component code */
import type { LinkingRunParams } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { PromptFlow, type PromptStep } from '../../ui/shared/PromptFlow.js';
import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { LinksRunCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import { createLinksRunHandler } from './links-run-handler.js';

/**
 * Command options validated by Zod at CLI boundary
 */
type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

/**
 * Build links run parameters from validated CLI options.
 */
function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): LinkingRunParams {
  return {
    dryRun: options.dryRun ?? false,
    minConfidenceScore: parseDecimal(options.minConfidence?.toString() ?? '0.7'),
    autoConfirmThreshold: parseDecimal(options.autoConfirmThreshold?.toString() ?? '0.95'),
  };
}

/**
 * Prompt user for links run parameters in interactive mode using Ink.
 */
async function promptForLinksRunParams(): Promise<LinkingRunParams | null> {
  return new Promise<LinkingRunParams | null>((resolve) => {
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
            console.error('\u26A0 Error: Auto-confirm threshold must be >= minimum confidence score');
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
  const isJson = isJsonMode(rawOptions);

  // Validate options at CLI boundary
  const parseResult = LinksRunCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'links-run',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
  }

  const options = parseResult.data;
  const startTime = Date.now();

  try {
    let params: LinkingRunParams;
    if (!options.dryRun && !options.minConfidence && !options.autoConfirmThreshold && !options.json) {
      const result = await promptForLinksRunParams();
      if (!result) {
        console.log('Transaction linking cancelled.');
        return;
      }
      params = result;
    } else {
      params = buildLinksRunParamsFromFlags(options);
    }

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handler = createLinksRunHandler(ctx, database, {
        dryRun: params.dryRun,
        isJsonMode: !!options.json,
      });

      if (!options.json) {
        ctx.onAbort(() => handler.abort());
      }

      const result = await handler.execute(params);

      if (result.isErr()) {
        if (options.json) {
          displayCliError('links-run', result.error, ExitCodes.GENERAL_ERROR, 'json');
        } else {
          ctx.exitCode = ExitCodes.GENERAL_ERROR;
        }
        return;
      }

      if (options.json) {
        const duration_ms = Date.now() - startTime;
        outputSuccess('links-run', result.value, { duration_ms });
      }
    });
  } catch (error) {
    displayCliError(
      'links-run',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      isJson ? 'json' : 'text'
    );
  }
}
