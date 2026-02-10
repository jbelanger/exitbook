// Command registration for benchmark providers subcommand

import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { configureLogger, getLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { BenchmarkRateLimitHandler } from '../benchmark-rate-limit/benchmark-rate-limit-handler.js';
import { buildConfigOverride } from '../benchmark-rate-limit/benchmark-rate-limit-utils.js';
import { displayCliError } from '../shared/cli-error.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { ProvidersBenchmarkCommandOptionsSchema } from '../shared/schemas.js';

import { BenchmarkApp } from './components/benchmark-components.js';
import { createBenchmarkState } from './components/benchmark-state.js';

const logger = getLogger('providers-benchmark');

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof ProvidersBenchmarkCommandOptionsSchema>;

/**
 * Register the providers benchmark subcommand.
 */
export function registerProvidersBenchmarkCommand(providersCommand: Command): void {
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
    .action(async (rawOptions: unknown) => {
      await executeProvidersBenchmarkCommand(rawOptions);
    });
}

/**
 * Execute the providers benchmark command.
 */
async function executeProvidersBenchmarkCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = ProvidersBenchmarkCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'providers-benchmark',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;

  // Configure logger
  configureLogger({
    mode: isJsonMode ? 'json' : 'text',
    verbose: false,
    sinks: isJsonMode ? { ui: false, structured: 'file' } : { ui: false, structured: 'file' },
  });

  if (isJsonMode) {
    await executeProvidersBenchmarkJSON(options);
  } else {
    await executeProvidersBenchmarkTUI(options);
  }
  resetLoggerContext();
}

/**
 * Execute providers benchmark in JSON mode
 */
async function executeProvidersBenchmarkJSON(options: CommandOptions): Promise<void> {
  const output = new OutputManager('json');
  const handler = new BenchmarkRateLimitHandler();

  try {
    const result = await handler.execute(options, BlockchainProviderManager);

    if (result.isErr()) {
      resetLoggerContext();
      output.error('providers-benchmark', result.error, ExitCodes.INVALID_ARGS);
      return;
    }

    const { params, provider, result: benchmarkResult } = result.value;

    const resultData = {
      blockchain: params.blockchain,
      provider: provider.name,
      currentRateLimit: provider.rateLimit,
      maxSafeRate: benchmarkResult.maxSafeRate,
      recommended: benchmarkResult.recommended,
      testResults: benchmarkResult.testResults,
      burstLimits: benchmarkResult.burstLimits,
      configOverride: buildConfigOverride(params.blockchain, provider.name, benchmarkResult.recommended),
    };

    output.json('providers-benchmark', resultData);

    await handler.destroy();
  } catch (error) {
    resetLoggerContext();
    output.error(
      'providers-benchmark',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR
    );
  }
}

/**
 * Execute providers benchmark in TUI mode
 */
async function executeProvidersBenchmarkTUI(options: CommandOptions): Promise<void> {
  const handler = new BenchmarkRateLimitHandler();
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;

  // SIGINT handler
  const handleSigint = () => {
    logger.info('Received SIGINT, cleaning up...');
    (async () => {
      await handler.destroy();
      if (inkInstance) {
        inkInstance.unmount();
      }
      process.exit(130);
    })().catch((error) => {
      logger.error({ error }, 'Error during SIGINT cleanup');
      process.exit(1);
    });
  };

  process.on('SIGINT', handleSigint);

  try {
    // Setup phase
    const setupResult = handler.setup(options, BlockchainProviderManager);

    if (setupResult.isErr()) {
      displayCliError('providers-benchmark', setupResult.error, ExitCodes.INVALID_ARGS, 'text');
    }

    const { params, provider, providerInfo } = setupResult.value;

    // Create initial state
    const initialState = createBenchmarkState(params, providerInfo);

    // Render TUI
    inkInstance = render(
      React.createElement(BenchmarkApp, {
        initialState,
        runBenchmark: async (onProgress) => {
          return handler.runBenchmark(provider, params, onProgress);
        },
      })
    );

    // Wait for exit
    await inkInstance.waitUntilExit();

    // Cleanup
    process.off('SIGINT', handleSigint);
    await handler.destroy();
  } catch (error) {
    process.off('SIGINT', handleSigint);
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore unmount errors */
      }
    }
    await handler.destroy();
    process.exit(ExitCodes.GENERAL_ERROR);
  }
}
