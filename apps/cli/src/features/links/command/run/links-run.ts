/* eslint-disable unicorn/no-null -- Used in React component code */
import type { LinkingRunParams } from '@exitbook/accounting/linking';
import { ok, parseDecimal, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import {
  cliErr,
  completeCliRuntime,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliFailure,
} from '../../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../../cli/options.js';
import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { PromptFlow, type PromptStep } from '../../../../ui/shared/prompt-flow.jsx';
import { resolveCommandProfile } from '../../../profiles/profile-resolution.js';
import { ExitCodes } from '../../../shared/exit-codes.js';
import { LinksRunCommandOptionsSchema } from '../links-option-schemas.js';

import { runLinks } from './run-links.js';

type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

type LinksRunPromptOutcome =
  | { kind: 'submitted'; params: LinkingRunParams }
  | { kind: 'cancelled' }
  | { kind: 'invalid'; message: string };

type PreparedLinksRunCommand =
  | { mode: 'json'; params: LinkingRunParams; startTime: number }
  | { mode: 'text'; params: LinkingRunParams };

function hasExplicitLinksRunThresholds(options: LinksRunCommandOptions): boolean {
  return options.minConfidence !== undefined || options.autoConfirmThreshold !== undefined;
}

function normalizeThresholdInput(input: string, fallback: string): string {
  return input.trim() === '' ? fallback : input;
}

function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): LinkingRunParams {
  return {
    minConfidenceScore: parseDecimal(options.minConfidence?.toString() ?? '0.7'),
    autoConfirmThreshold: parseDecimal(options.autoConfirmThreshold?.toString() ?? '0.95'),
  };
}

async function promptForLinksRunParams(): Promise<LinksRunPromptOutcome> {
  return new Promise<LinksRunPromptOutcome>((resolve) => {
    const steps: PromptStep[] = [
      {
        type: 'text',
        props: {
          message: 'Minimum confidence score (0-1):',
          placeholder: '0.7',
          validate: (value) => {
            if (!value) return;
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
            if (!value) return;
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
            resolve({ kind: 'cancelled' });
            return;
          }

          const normalizedMinConfidence = normalizeThresholdInput(minConfidenceInput, '0.7');
          const normalizedAutoConfirm = normalizeThresholdInput(autoConfirmInput, '0.95');
          const minConfidence = Number(normalizedMinConfidence);
          const autoConfirm = Number(normalizedAutoConfirm);
          if (autoConfirm < minConfidence) {
            resolve({
              kind: 'invalid',
              message: 'Auto-confirm threshold must be >= minimum confidence score',
            });
            return;
          }

          resolve({
            kind: 'submitted',
            params: {
              minConfidenceScore: parseDecimal(normalizedMinConfidence),
              autoConfirmThreshold: parseDecimal(normalizedAutoConfirm),
            },
          });
        },
        onCancel: () => {
          unmount();
          resolve({ kind: 'cancelled' });
        },
      })
    );
  });
}

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
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand<PreparedLinksRunCommand>({
    command: 'links-run',
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, LinksRunCommandOptionsSchema);

        if (format === 'json') {
          return {
            mode: 'json',
            params: buildLinksRunParamsFromFlags(options),
            startTime: Date.now(),
          } satisfies PreparedLinksRunCommand;
        }

        const params = yield* await resolveLinksRunParams(options);

        if (params === null) {
          return completeCliRuntime(textSuccess(() => console.log('Transaction linking cancelled.')));
        }

        return {
          mode: 'text',
          params,
        } satisfies PreparedLinksRunCommand;
      }),
    action: async ({ runtime, prepared }) => executePreparedLinksRunCommand(runtime, prepared),
  });
}

async function executePreparedLinksRunCommand(
  ctx: CommandRuntime,
  prepared: PreparedLinksRunCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const result = yield* toCliResult(
      await runLinks(
        ctx,
        {
          format: prepared.mode,
          profileId: profile.id,
          profileKey: profile.profileKey,
        },
        prepared.params
      ),
      ExitCodes.GENERAL_ERROR
    );

    if (prepared.mode === 'json') {
      return jsonSuccess(result, { duration_ms: Date.now() - prepared.startTime });
    }

    return silentSuccess();
  });
}

async function resolveLinksRunParams(
  options: LinksRunCommandOptions
): Promise<Result<LinkingRunParams | null, CliFailure>> {
  if (hasExplicitLinksRunThresholds(options)) {
    return ok(buildLinksRunParamsFromFlags(options));
  }

  const outcome = await promptForLinksRunParams();

  if (outcome.kind === 'cancelled') {
    return ok(null);
  }

  if (outcome.kind === 'invalid') {
    return cliErr(new Error(outcome.message), ExitCodes.INVALID_ARGS);
  }

  return ok(outcome.params);
}
