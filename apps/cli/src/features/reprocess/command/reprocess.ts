import { ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  hasAccountSelector,
  getAccountSelectorErrorExitCode,
  resolveRequiredOwnedAccountSelector,
} from '../../accounts/account-selector.js';
import { createCliAccountLifecycleService } from '../../accounts/account-service.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { ReprocessCommandOptionsSchema } from './reprocess-option-schemas.js';
import { runReprocess, type ReprocessResultWithMetrics } from './run-reprocess.js';

type ReprocessCommandOptions = z.infer<typeof ReprocessCommandOptionsSchema>;

interface ReprocessCommandResult {
  status: 'success' | 'warning';
  reprocess: {
    counts: {
      failed?: number | undefined;
      processed: number;
    };
    processingErrors?: string[] | undefined;
    runStats?: import('@exitbook/observability').MetricsSummary | undefined;
  };
  meta: {
    timestamp: string;
  };
}

export function registerReprocessCommand(program: Command, appRuntime: CliAppRuntime): void {
  program
    .command('reprocess')
    .description('Rebuild derived data from saved raw imports')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook reprocess
  $ exitbook reprocess --account-name kraken-main
  $ exitbook reprocess --account-ref 6f4c0d1a2b
  $ exitbook reprocess --json

Notes:
  - Use this after processing logic changes, projection resets, or failed derived-data rebuilds.
  - Reprocess uses stored raw imports only. Run "exitbook import" first if raw data itself is stale.
`
    )
    .option('--account-name <name>', 'Reprocess only a specific named account')
    .option('--account-ref <ref>', 'Reprocess only a specific account fingerprint prefix')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeReprocessCommand(rawOptions, appRuntime));
}

async function executeReprocessCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'reprocess',
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, ReprocessCommandOptionsSchema);
      }),
    action: async (context) => executeReprocessCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeReprocessCommandResult(
  ctx: CommandRuntime,
  options: ReprocessCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const selectedAccountIdResult = await resolveSelectedReprocessAccountId(ctx, options);
    if (selectedAccountIdResult.isErr()) {
      return yield* cliErr(
        selectedAccountIdResult.error,
        getAccountSelectorErrorExitCode(selectedAccountIdResult.error)
      );
    }

    const result = yield* toCliResult(
      await runReprocess(ctx, { format }, { accountId: selectedAccountIdResult.value }),
      ExitCodes.GENERAL_ERROR
    );

    return buildReprocessCompletion(result, format);
  });
}

async function resolveSelectedReprocessAccountId(
  ctx: CommandRuntime,
  options: ReprocessCommandOptions
): Promise<Result<number | undefined, Error>> {
  if (!hasAccountSelector(options)) {
    return ok(undefined);
  }

  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* await resolveCommandProfile(ctx, database);
    const selection = yield* await resolveRequiredOwnedAccountSelector(
      createCliAccountLifecycleService(database),
      profile.id,
      options,
      'Reprocess requires --account-name or --account-ref'
    );

    return selection.account.id;
  });
}

function buildReprocessCompletion(result: ReprocessResultWithMetrics, format: CliOutputFormat) {
  if (format === 'json') {
    return jsonSuccess(buildReprocessResult(result));
  }

  if (result.errors.length === 0) {
    return silentSuccess();
  }

  return textSuccess(() => {
    process.stderr.write('\nFirst 5 processing errors:\n');
    for (const error of result.errors.slice(0, 5)) {
      process.stderr.write(`  • ${error}\n`);
    }
  });
}

function buildReprocessResult(result: ReprocessResultWithMetrics): ReprocessCommandResult {
  return {
    status: result.errors.length > 0 ? 'warning' : 'success',
    reprocess: {
      counts: {
        processed: result.processed,
        ...(result.failed > 0 ? { failed: result.failed } : {}),
      },
      processingErrors: result.errors.slice(0, 5),
      runStats: result.runStats,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}
