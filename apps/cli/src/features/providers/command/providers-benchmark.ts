import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  type CliCommandResult,
  type CliCompletion,
} from '../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { BenchmarkApp } from '../view/benchmark-components.jsx';
import { createBenchmarkState } from '../view/benchmark-state.js';

import type { BenchmarkResult } from './benchmark-tool.js';
import { withProviderBenchmarkCommandScope } from './providers-benchmark-command-scope.js';
import { buildConfigOverride } from './providers-benchmark-utils.js';
import { ProvidersBenchmarkCommandOptionsSchema } from './providers-option-schemas.js';
import { prepareProviderBenchmarkSession, runProviderBenchmark } from './run-providers-benchmark.js';

type ProvidersBenchmarkCommandOptions = z.infer<typeof ProvidersBenchmarkCommandOptionsSchema>;

class ProviderBenchmarkValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderBenchmarkValidationError';
  }
}

export function registerProvidersBenchmarkCommand(providersCommand: Command, appRuntime: CliAppRuntime): void {
  providersCommand
    .command('benchmark')
    .description('Benchmark API rate limits for a blockchain provider')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook providers benchmark --blockchain bitcoin --provider blockstream.info
  $ exitbook providers benchmark --blockchain ethereum --provider alchemy --skip-burst
  $ exitbook providers benchmark --blockchain bitcoin --provider mempool.space --rates "0.5,1,2"
  $ exitbook providers benchmark --blockchain solana --provider helius --json

Common Usage:
  - Test sustained per-second rates and per-minute burst limits
  - Get recommended rate limit configuration with 80% safety margin
  - Use --skip-burst to only test sustained rates (faster)
  - Use --rates to test custom rate progression
  - Use --json for automated config updates
`
    )
    .requiredOption('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum)')
    .requiredOption('--provider <name>', 'Provider to test (e.g., blockstream.info, etherscan)')
    .option('--max-rate <number>', 'Maximum rate to test in req/sec (default: 5)', '5')
    .option('--rates <rates>', 'Custom rates to test (comma-separated, e.g. "0.5,1,2,5")')
    .option('--num-requests <number>', 'Number of requests to send per rate test (default: 10)', '10')
    .option('--skip-burst', 'Skip burst limit testing (only test sustained rates)', false)
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeProvidersBenchmarkCommand(rawOptions, appRuntime));
}

async function executeProvidersBenchmarkCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'providers-benchmark',
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, ProvidersBenchmarkCommandOptionsSchema);
      }),
    action: async (context) => executeProvidersBenchmarkCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeProvidersBenchmarkCommandResult(
  ctx: CommandRuntime,
  options: ProvidersBenchmarkCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  const result =
    format === 'json'
      ? await buildProvidersBenchmarkJsonCompletion(ctx, options)
      : await buildProvidersBenchmarkTuiCompletion(ctx, options);

  return toProvidersBenchmarkCliResult(result);
}

async function buildProvidersBenchmarkJsonCompletion(
  ctx: CommandRuntime,
  options: ProvidersBenchmarkCommandOptions
): Promise<Result<CliCompletion, Error>> {
  return withProviderBenchmarkCommandScope(ctx, async (scope) => {
    const setupResult = await prepareProviderBenchmarkSession(scope, options);
    if (setupResult.isErr()) {
      return err(new ProviderBenchmarkValidationError(setupResult.error.message, { cause: setupResult.error }));
    }

    const { params, session, providerInfo } = setupResult.value;

    try {
      const benchmarkResult = await runProviderBenchmark(scope, session.provider, params);
      return ok(
        jsonSuccess(
          buildProvidersBenchmarkJsonResult({
            params,
            provider: {
              name: providerInfo.name,
              rateLimit: providerInfo.rateLimit,
            },
            result: benchmarkResult,
          })
        )
      );
    } catch (error) {
      return err(normalizeCommandError(error));
    }
  });
}

async function buildProvidersBenchmarkTuiCompletion(
  ctx: CommandRuntime,
  options: ProvidersBenchmarkCommandOptions
): Promise<Result<CliCompletion, Error>> {
  return withProviderBenchmarkCommandScope(ctx, async (scope) => {
    const setupResult = await prepareProviderBenchmarkSession(scope, options);
    if (setupResult.isErr()) {
      return err(new ProviderBenchmarkValidationError(setupResult.error.message, { cause: setupResult.error }));
    }

    const { params, session, providerInfo } = setupResult.value;
    const initialState = createBenchmarkState(params, providerInfo);

    ctx.onAbort(() => {
      /* empty */
    });

    try {
      await renderApp(() =>
        React.createElement(BenchmarkApp, {
          initialState,
          runBenchmark: async (onProgress) => runProviderBenchmark(scope, session.provider, params, onProgress),
        })
      );
    } catch (error) {
      return err(normalizeCommandError(error));
    }

    return ok(silentSuccess());
  });
}

function buildProvidersBenchmarkJsonResult(input: {
  params: {
    blockchain: string;
    provider: string;
  };
  provider: {
    name: string;
    rateLimit: unknown;
  };
  result: BenchmarkResult;
}) {
  return {
    blockchain: input.params.blockchain,
    provider: input.provider.name,
    currentRateLimit: input.provider.rateLimit,
    maxSafeRate: input.result.maxSafeRate,
    recommended: input.result.recommended,
    testResults: input.result.testResults,
    burstLimits: input.result.burstLimits,
    configOverride: buildConfigOverride(input.params.blockchain, input.provider.name, input.result.recommended),
  };
}

function toProvidersBenchmarkCliResult(result: Result<CliCompletion, Error>): CliCommandResult {
  if (result.isErr()) {
    return result.error instanceof ProviderBenchmarkValidationError
      ? cliErr(result.error, ExitCodes.INVALID_ARGS)
      : cliErr(result.error, ExitCodes.GENERAL_ERROR);
  }

  return ok(result.value);
}

function normalizeCommandError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
