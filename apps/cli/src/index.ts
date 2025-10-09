#!/usr/bin/env node
import 'reflect-metadata';
import { closeDatabase, initializeDatabase } from '@exitbook/data';
import {
  initializeProviders,
  BlockchainProviderManager,
  ProviderRegistry,
  loadExplorerConfig,
} from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';
import { Command } from 'commander';

import { registerExportCommand } from './features/export/export.ts';
import { registerImportCommand } from './features/import/import.ts';
import { registerListBlockchainsCommand } from './features/list-blockchains/list-blockchains.ts';
import { registerProcessCommand } from './features/process/process.ts';
import { registerVerifyCommand } from './features/verify/verify.ts';

// Initialize all providers at startup
initializeProviders();

const logger = getLogger('CLI');
const program = new Command();

// Command option types
interface StatusOptions {
  clearDb?: boolean | undefined;
}

async function main() {
  program
    .name('crypto-import')
    .description('Crypto transaction import and verification tool using CCXT')
    .version('1.0.0');

  // Import command - refactored with @clack/prompts (Phase 2)
  registerImportCommand(program);

  // Process command - refactored with @clack/prompts (Phase 3)
  registerProcessCommand(program);

  // Verify command - refactored with @clack/prompts (Phase 3)
  registerVerifyCommand(program);

  // Export command - refactored with @clack/prompts (Phase 3)
  registerExportCommand(program);

  // List blockchains command - refactored with @clack/prompts (Phase 3)
  registerListBlockchainsCommand(program);

  // Status command
  program
    .command('status')
    .description('Show system status and recent verification results')
    .option('--clear-db', 'Clear and reinitialize database before status')
    .action(async (options: StatusOptions) => {
      try {
        logger.info('Database implementation: Kysely');

        const kyselyDb = await initializeDatabase(options.clearDb);

        // For now, use a simplified stats approach with Kysely
        // TODO: Implement proper Kysely stats queries
        const stats = {
          totalSources: 0,
          totalExternalTransactions: 0,
          totalImportSessions: 0,
          totalTransactions: 0,
          transactionsBySource: [],
        };
        logger.info('Kysely stats queries not yet implemented - showing placeholder values');

        logger.info('\nSystem Status');
        logger.info('================');
        logger.info(`Total transactions: ${stats.totalTransactions}`);
        logger.info(`Total sources: ${stats.totalSources}`);
        logger.info(`Total import sessions: ${stats.totalImportSessions}`);

        if (stats.transactionsBySource.length > 0) {
          logger.info('\n📈 Transactions by Source:');
          for (const { count, source } of stats.transactionsBySource) {
            logger.info(`  ${String(source)}: ${String(count)}`);
          }
        }

        // Close database connections
        await closeDatabase(kyselyDb);

        process.exit(0);
      } catch (error) {
        logger.error(`Status check failed: ${String(error)}`);
        process.exit(1);
      }
    });

  // Benchmark rate limits command
  program
    .command('benchmark-rate-limit')
    .description('Benchmark API rate limits for a blockchain provider')
    .requiredOption('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum)')
    .requiredOption('--provider <name>', 'Provider to test (e.g., blockstream.info, etherscan)')
    .option('--max-rate <number>', 'Maximum rate to test in req/sec (default: 5)', '5')
    .option('--rates <rates>', 'Custom rates to test (comma-separated, e.g. "0.5,1,2,5")')
    .option('--num-requests <number>', 'Number of requests to send per rate test (default: 10)', '10')
    .option('--skip-burst', 'Skip burst limit testing (only test sustained rates)', false)
    .action(
      async (options: {
        blockchain: string;
        maxRate: string;
        numRequests?: string;
        provider: string;
        rates?: string;
        skipBurst: boolean;
      }) => {
        try {
          let customRates: number[] | undefined;

          if (options.rates) {
            customRates = options.rates.split(',').map((r) => parseFloat(r.trim()));
            if (customRates.some((r) => isNaN(r) || r <= 0)) {
              logger.error('Invalid rates. All values must be positive numbers.');
              process.exit(1);
            }
            logger.info(`Using custom rates: ${customRates.join(', ')} req/sec`);
          }

          const maxRate = parseFloat(options.maxRate);
          if (isNaN(maxRate) || maxRate <= 0) {
            logger.error('Invalid max-rate value. Must be a positive number.');
            process.exit(1);
          }

          const numRequests = options.numRequests ? parseInt(options.numRequests, 10) : 10;
          if (isNaN(numRequests) || numRequests <= 0) {
            logger.error('Invalid num-requests value. Must be a positive integer.');
            process.exit(1);
          }

          logger.info(`Starting rate limit benchmark for ${options.blockchain}`);
          logger.info('=============================\n');

          const explorerConfig = loadExplorerConfig();
          const providerManager = new BlockchainProviderManager(explorerConfig);

          // Auto-register providers
          const providers = providerManager.autoRegisterFromConfig(options.blockchain, options.provider);

          if (providers.length === 0) {
            logger.error(`Provider '${options.provider}' not found for blockchain: ${options.blockchain}`);
            logger.info('\nAvailable providers:');
            const allProviders = ProviderRegistry.getAllProviders();
            const blockchainProviders = allProviders.filter((p) => p.blockchain === options.blockchain);
            if (blockchainProviders.length > 0) {
              blockchainProviders.forEach((p) => logger.info(`  - ${p.name}`));
            } else {
              logger.info(`  No providers registered for ${options.blockchain}`);
              logger.info('\nAvailable blockchains:');
              const blockchains = [...new Set(allProviders.map((p) => p.blockchain))];
              blockchains.forEach((bc) => logger.info(`  - ${bc}`));
            }
            process.exit(1);
          }

          const provider = providers[0]!;
          logger.info(`Testing provider: ${provider.name}`);
          logger.info(`Current rate limit: ${JSON.stringify(provider.rateLimit)}`);
          logger.info(`Requests per test: ${numRequests}`);
          logger.info(`Burst testing: ${options.skipBurst ? 'disabled' : 'enabled'}\n`);

          const result = await provider.benchmarkRateLimit(maxRate, numRequests, !options.skipBurst, customRates);

          logger.info('\n=============================');
          logger.info('Benchmark Results');
          logger.info('=============================\n');

          logger.info('Sustained Rate Test Results:');
          result.testResults.forEach((test: { rate: number; responseTimeMs?: number; success: boolean }) => {
            const status = test.success ? '✅' : '❌';
            const avgTime = test.responseTimeMs ? ` (avg ${test.responseTimeMs.toFixed(0)}ms)` : '';
            logger.info(`  ${status} ${test.rate} req/sec${avgTime}`);
          });

          if (result.burstLimits) {
            logger.info('\nBurst Limit Test Results:');
            result.burstLimits.forEach((test: { limit: number; success: boolean }) => {
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
          logger.info(
            JSON.stringify(
              {
                [options.blockchain]: {
                  overrides: {
                    [provider.name]: {
                      rateLimit: result.recommended,
                    },
                  },
                },
              },
              undefined,
              2
            )
          );

          providerManager.destroy();
          process.exit(0);
        } catch (error) {
          logger.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      }
    );

  await program.parseAsync();
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${String(reason)}`);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(`Stack: ${error.stack}`);
  process.exit(1);
});

main().catch((error) => {
  logger.error(`CLI failed: ${String(error)}`);
  process.exit(1);
});
