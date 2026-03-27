/* eslint-disable unicorn/no-null -- Used in React component code */
import type { LinkingRunParams } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/foundation';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { runCommand } from '../../../runtime/command-runtime.js';
import { PromptFlow, type PromptStep } from '../../../ui/shared/prompt-flow.jsx';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { LinksRunCommandOptionsSchema } from './links-option-schemas.js';
import { runLinks } from './run-links.js';

/**
 * Command options validated by Zod at CLI boundary
 */
type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

/**
 * Build links run parameters from validated CLI options.
 */
function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): LinkingRunParams {
  return {
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

          const minConfidenceInput = answers[0] as string;
          const autoConfirmInput = answers[1] as string;
          const shouldProceed = answers[2] as boolean;

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
export function registerLinksRunCommand(linksCommand: Command, appRuntime: CliAppRuntime): void {
  linksCommand
    .command('run')
    .description('Run the linking algorithm to find matching transactions across sources')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links run
  $ exitbook links run --min-confidence 0.8
  $ exitbook links run --min-confidence 0.8 --auto-confirm-threshold 0.98
  $ exitbook links run --json

Notes:
  - --auto-confirm-threshold must be greater than or equal to --min-confidence.
  - In text mode, omitting both thresholds starts an interactive prompt flow.
`
    )
    .option('--min-confidence <score>', 'Minimum confidence threshold (0-1, default: 0.7)', parseFloat)
    .option('--auto-confirm-threshold <score>', 'Auto-confirm above this score (0-1, default: 0.95)', parseFloat)
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksRunCommand(rawOptions, appRuntime);
    });
}

async function executeLinksRunCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const { format, options } = parseCliCommandOptions('links-run', rawOptions, LinksRunCommandOptionsSchema);
  if (format === 'json') {
    await executeLinksRunJSON(options, appRuntime);
  } else {
    await executeLinksRunTUI(options, appRuntime);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeLinksRunJSON(options: LinksRunCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  const startTime = Date.now();
  const params = buildLinksRunParamsFromFlags(options);

  try {
    await runCommand(appRuntime, async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('links-run', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const result = await runLinks(
        ctx,
        {
          isJsonMode: true,
          profileId: profileResult.value.id,
          profileKey: profileResult.value.profileKey,
        },
        params
      );
      if (result.isErr()) {
        displayCliError('links-run', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      outputSuccess('links-run', result.value, { duration_ms: Date.now() - startTime });
    });
  } catch (error) {
    displayCliError(
      'links-run',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

// ─── TUI Mode ────────────────────────────────────────────────────────────────

async function executeLinksRunTUI(options: LinksRunCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    let params: LinkingRunParams;
    if (!options.minConfidence && !options.autoConfirmThreshold) {
      const prompted = await promptForLinksRunParams();
      if (!prompted) {
        console.log('Transaction linking cancelled.');
        return;
      }
      params = prompted;
    } else {
      params = buildLinksRunParamsFromFlags(options);
    }

    await runCommand(appRuntime, async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('links-run', profileResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const result = await runLinks(
        ctx,
        {
          isJsonMode: false,
          profileId: profileResult.value.id,
          profileKey: profileResult.value.profileKey,
        },
        params
      );
      if (result.isErr()) {
        displayCliError('links-run', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }
    });
  } catch (error) {
    displayCliError(
      'links-run',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}
