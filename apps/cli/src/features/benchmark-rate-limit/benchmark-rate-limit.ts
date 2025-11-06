import { BlockchainProviderManager } from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';

import { BenchmarkRateLimitHandler } from './benchmark-rate-limit-handler.js';
import type { BenchmarkRateLimitCommandOptions } from './benchmark-rate-limit-utils.js';
import { buildConfigOverride } from './benchmark-rate-limit-utils.js';

const logger = getLogger('BenchmarkRateLimitCommand');

interface ExtendedBenchmarkRateLimitCommandOptions extends BenchmarkRateLimitCommandOptions {
  json?: boolean | undefined;
}

/**
 * Result data for benchmark-rate-limit command (JSON mode).
 */
interface BenchmarkRateLimitCommandResult {
  blockchain: string;
  provider: string;
  currentRateLimit: unknown;
  maxSafeRate: number;
  recommended: {
    burstLimit?: number | undefined;
    requestsPerSecond: number;
  };
  testResults: {
    rate: number;
    responseTimeMs?: number | undefined;
    success: boolean;
  }[];
  burstLimits?:
    | {
        limit: number;
        success: boolean;
      }[]
    | undefined;
  configOverride: ReturnType<typeof buildConfigOverride>;
}

/**
 * Register the benchmark-rate-limit command.
 */
export function registerBenchmarkRateLimitCommand(program: Command): void {
  program
    .command('benchmark-rate-limit')
    .description('Benchmark API rate limits for a blockchain provider')
    .requiredOption('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum)')
    .requiredOption('--provider <name>', 'Provider to test (e.g., blockstream.info, etherscan)')
    .option('--max-rate <number>', 'Maximum rate to test in req/sec (default: 5)', '5')
    .option('--rates <rates>', 'Custom rates to test (comma-separated, e.g. "0.5,1,2,5")')
    .option('--num-requests <number>', 'Number of requests to send per rate test (default: 10)', '10')
    .option('--skip-burst', 'Skip burst limit testing (only test sustained rates)', false)
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedBenchmarkRateLimitCommandOptions) => {
      await executeBenchmarkRateLimitCommand(options);
    });
}

/**
 * Execute the benchmark-rate-limit command.
 */
async function executeBenchmarkRateLimitCommand(options: ExtendedBenchmarkRateLimitCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Create handler and execute
    const handler = new BenchmarkRateLimitHandler();

    const result = await handler.execute(options, BlockchainProviderManager);

    if (result.isErr()) {
      handler.destroy();
      output.error('benchmark-rate-limit', result.error, ExitCodes.INVALID_ARGS);
      return;
    }

    const { params, provider, result: benchmarkResult } = result.value;

    // Display in text mode
    if (output.isTextMode()) {
      displayTextOutput(params, provider, benchmarkResult);
    }

    // Prepare result data for JSON mode
    const resultData: BenchmarkRateLimitCommandResult = {
      blockchain: params.blockchain,
      provider: provider.name,
      currentRateLimit: provider.rateLimit,
      maxSafeRate: benchmarkResult.maxSafeRate,
      recommended: benchmarkResult.recommended,
      testResults: benchmarkResult.testResults,
      burstLimits: benchmarkResult.burstLimits,
      configOverride: buildConfigOverride(params.blockchain, provider.name, benchmarkResult.recommended),
    };

    // Output success
    output.success('benchmark-rate-limit', resultData);

    handler.destroy();
    process.exit(0);
  } catch (error) {
    output.error(
      'benchmark-rate-limit',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR
    );
  }
}

/**
 * Display output in text mode.
 */
function displayTextOutput(
  params: { blockchain: string; customRates?: number[] | undefined; numRequests: number; skipBurst: boolean },
  provider: { name: string; rateLimit: unknown },
  result: {
    burstLimits?: { limit: number; success: boolean }[] | undefined;
    maxSafeRate: number;
    recommended: { burstLimit?: number | undefined; requestsPerSecond: number };
    testResults: { rate: number; responseTimeMs?: number | undefined; success: boolean }[];
  }
): void {
  logger.info(`Starting rate limit benchmark for ${params.blockchain}`);
  logger.info('=============================\n');

  logger.info(`Testing provider: ${provider.name}`);
  logger.info(`Current rate limit: ${JSON.stringify(provider.rateLimit)}`);
  logger.info(`Requests per test: ${params.numRequests}`);
  logger.info(`Burst testing: ${params.skipBurst ? 'disabled' : 'enabled'}`);

  if (params.customRates) {
    logger.info(`Custom rates: ${params.customRates.join(', ')} req/sec`);
  }

  logger.info('');
  logger.info('\n=============================');
  logger.info('Benchmark Results');
  logger.info('=============================\n');

  logger.info('Sustained Rate Test Results:');
  result.testResults.forEach((test) => {
    const status = test.success ? '✅' : '❌';
    const avgTime = test.responseTimeMs ? ` (avg ${test.responseTimeMs.toFixed(0)}ms)` : '';
    logger.info(`  ${status} ${test.rate} req/sec${avgTime}`);
  });

  if (result.burstLimits) {
    logger.info('\nBurst Limit Test Results:');
    result.burstLimits.forEach((test) => {
      const status = test.success ? '✅' : '❌';
      logger.info(`  ${status} ${test.limit} req/min`);
    });
  }

  logger.info(`\nMaximum safe sustained rate: ${result.maxSafeRate} req/sec`);
  logger.info('\nRecommended configuration (80% safety margin):');
  logger.info(JSON.stringify(result.recommended, undefined, 2));

  logger.info('\n📝 To update the configuration, edit:');
  logger.info('   apps/cli/config/blockchain-explorers.json');
  logger.info(`\nExample override for ${provider.name}:`);
  logger.info(JSON.stringify(buildConfigOverride(params.blockchain, provider.name, result.recommended), undefined, 2));
}
