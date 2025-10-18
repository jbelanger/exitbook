#!/usr/bin/env node
import 'reflect-metadata';
import { closeDatabase, initializeDatabase } from '@exitbook/data';
import { initializeProviders } from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';
import { Command } from 'commander';

import { registerBalanceCommand } from './features/balance/balance.ts';
import { registerBenchmarkRateLimitCommand } from './features/benchmark-rate-limit/benchmark-rate-limit.ts';
import { registerClearCommand } from './features/clear/clear.ts';
import { registerExportCommand } from './features/export/export.ts';
import { registerImportCommand } from './features/import/import.ts';
import { registerLinkCommand } from './features/link/link.ts';
import { registerListBlockchainsCommand } from './features/list-blockchains/list-blockchains.ts';
import { registerPricesCommand } from './features/prices/prices.ts';
import { registerProcessCommand } from './features/process/process.ts';
import { registerViewCommand } from './features/view/view.ts';

// Initialize all providers at startup
initializeProviders();

const logger = getLogger('CLI');
const program = new Command();

async function main() {
  program
    .name('crypto-import')
    .description('Crypto transaction import and verification tool using CCXT')
    .version('1.0.0');

  // Import command - refactored with @clack/prompts (Phase 2)
  registerImportCommand(program);

  // Process command - refactored with @clack/prompts (Phase 3)
  registerProcessCommand(program);

  // Link command - transaction linking for cost basis propagation
  registerLinkCommand(program);

  // Clear command
  registerClearCommand(program);

  // Balance command - fetch live balances from exchanges/blockchains
  registerBalanceCommand(program);

  // Export command - refactored with @clack/prompts (Phase 3)
  registerExportCommand(program);

  // List blockchains command - refactored with @clack/prompts (Phase 3)
  registerListBlockchainsCommand(program);

  // Benchmark rate limit command - refactored with @clack/prompts (Phase 3)
  registerBenchmarkRateLimitCommand(program);

  // Prices command
  registerPricesCommand(program);

  // View command - unified inspection interface
  registerViewCommand(program);

  // Status command
  program
    .command('status')
    .description('Show system status and recent verification results')
    .action(async () => {
      try {
        logger.info('Database implementation: Kysely');

        const kyselyDb = await initializeDatabase();

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
