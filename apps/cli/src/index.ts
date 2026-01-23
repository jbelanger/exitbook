#!/usr/bin/env node
import 'reflect-metadata';
import { initializeProviders } from '@exitbook/blockchain-providers';
import { registerAllBlockchains, registerAllExchanges } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { Command } from 'commander';

import { registerAccountsCommand } from './features/accounts/accounts.js';
import { registerBalanceCommand } from './features/balance/balance.js';
import { registerBenchmarkRateLimitCommand } from './features/benchmark-rate-limit/benchmark-rate-limit.js';
import { registerClearCommand } from './features/clear/clear.js';
import { registerCostBasisCommand } from './features/cost-basis/cost-basis.js';
import { registerExportCommand } from './features/export/export.js';
import { registerGapsCommand } from './features/gaps/gaps.js';
import { registerImportCommand } from './features/import/import.js';
import { registerLinksCommand } from './features/links/links.js';
import { registerListBlockchainsCommand } from './features/list-blockchains/list-blockchains.js';
import { registerPricesCommand } from './features/prices/prices.js';
import { registerReprocessCommand } from './features/process/process.js';
import { registerTransactionsCommand } from './features/transactions/transactions.js';

// Initialize all providers at startup
initializeProviders();

// Initialize blockchain and exchange adapters
registerAllBlockchains();
registerAllExchanges();

const logger = getLogger('CLI');
const program = new Command();

async function main() {
  program.name('exitbook').description('Crypto transaction reconciliation and reports').version('1.0.0');

  registerImportCommand(program);
  registerReprocessCommand(program);
  registerLinksCommand(program);
  registerGapsCommand(program);
  registerAccountsCommand(program);
  registerTransactionsCommand(program);
  registerPricesCommand(program);
  registerClearCommand(program);
  registerCostBasisCommand(program);
  registerBalanceCommand(program);
  registerExportCommand(program);
  registerListBlockchainsCommand(program);
  registerBenchmarkRateLimitCommand(program);

  await program.parseAsync();
}

// Only catch initialization errors (before commands run).
// All command errors MUST go through OutputManager.error() to ensure consistent
// JSON/text formatting and respect for --json flag. Global handlers would bypass
// OutputManager and violate financial correctness by producing inconsistent output.
main().catch((error) => {
  logger.error(`CLI initialization failed: ${String(error)}`);
  process.exit(1);
});
