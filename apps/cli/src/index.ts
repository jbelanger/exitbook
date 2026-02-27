#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdapterRegistry, allBlockchainAdapters, allExchangeAdapters } from '@exitbook/ingestion';
import { flushLoggers, getLogger, initLogger, type LogLevel } from '@exitbook/logger';
import { FileSink } from '@exitbook/logger/file';
import { Command } from 'commander';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
export const CLI_VERSION = packageJson.version;

// Configure logger — LoggerImpl reads config dynamically, so loggers
// created during module loading (before this runs) still pick up sinks.
const validLevels = new Set<LogLevel>(['trace', 'debug', 'info', 'warn', 'error']);
const envLevel = process.env['LOGGER_LOG_LEVEL']?.toLowerCase();
const logLevel: LogLevel = validLevels.has(envLevel as LogLevel) ? (envLevel as LogLevel) : 'info';
const logPath = process.env['LOGGER_FILE_PATH'] ?? './data/logs/application.log';

initLogger({
  level: logLevel,
  sinks: [new FileSink({ path: logPath })],
});

// flush() is synchronous (BufferedSink.drain → appendFileSync), safe in 'exit' handler
process.on('exit', () => flushLoggers());

import { registerAccountsCommand } from './features/accounts/accounts.js';
import { registerBalanceCommand } from './features/balance/balance.js';
import { registerBlockchainsCommand } from './features/blockchains/blockchains.js';
import { registerClearCommand } from './features/clear/clear.js';
import { registerCostBasisCommand } from './features/cost-basis/cost-basis.js';
import { registerImportCommand } from './features/import/import.js';
import { registerLinksCommand } from './features/links/links.js';
import { registerPortfolioCommand } from './features/portfolio/portfolio.js';
import { registerPricesCommand } from './features/prices/prices.js';
import { registerProvidersCommand } from './features/providers/providers.js';
import { registerReprocessCommand } from './features/reprocess/reprocess.js';
import { registerTransactionsCommand } from './features/transactions/transactions.js';

// Construct registry once at startup — duplicate registrations throw at construction time
const adapterRegistry = new AdapterRegistry(allBlockchainAdapters, allExchangeAdapters);

const logger = getLogger('CLI');
const program = new Command();

async function main() {
  program.name('exitbook').description('Crypto transaction reconciliation and reports').version(CLI_VERSION);

  registerImportCommand(program, adapterRegistry);
  registerReprocessCommand(program, adapterRegistry);
  registerLinksCommand(program);
  registerAccountsCommand(program);
  registerTransactionsCommand(program);
  registerPricesCommand(program);
  registerClearCommand(program);
  registerCostBasisCommand(program);
  registerBalanceCommand(program);
  registerBlockchainsCommand(program, adapterRegistry);
  registerProvidersCommand(program, adapterRegistry);
  registerPortfolioCommand(program);

  await program.parseAsync();
}

// Only catch initialization errors (before commands run).
// All command errors MUST go through displayCliError() to ensure consistent
// JSON/text formatting and respect for --json flag. Global handlers would bypass
// this function and produce inconsistent output.
main().catch((error) => {
  logger.error(`CLI initialization failed: ${String(error)}`);
  flushLoggers();
  process.exit(1);
});
