#!/usr/bin/env node

// IMPORTANT: This import must come first to configure environment before any other imports
import './env-setup.js';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeProviders } from '@exitbook/blockchain-providers';
import { registerAllBlockchains, registerAllExchanges } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { Command } from 'commander';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
export const CLI_VERSION = packageJson.version;

import { registerAccountsCommand } from './features/accounts/accounts.js';
import { registerBalanceCommand } from './features/balance/balance.js';
import { registerBlockchainsCommand } from './features/blockchains/blockchains.js';
import { registerClearCommand } from './features/clear/clear.js';
import { registerCostBasisCommand } from './features/cost-basis/cost-basis.js';
import { registerImportCommand } from './features/import/import.js';
import { registerLinksCommand } from './features/links/links.js';
import { registerPricesCommand } from './features/prices/prices.js';
import { registerReprocessCommand } from './features/process/process.js';
import { registerProvidersCommand } from './features/providers/providers.js';
import { registerTransactionsCommand } from './features/transactions/transactions.js';

// Initialize all providers at startup
initializeProviders();

// Initialize blockchain and exchange adapters
registerAllBlockchains();
registerAllExchanges();

const logger = getLogger('CLI');
const program = new Command();

async function main() {
  program.name('exitbook').description('Crypto transaction reconciliation and reports').version(CLI_VERSION);

  registerImportCommand(program);
  registerReprocessCommand(program);
  registerLinksCommand(program);
  registerAccountsCommand(program);
  registerTransactionsCommand(program);
  registerPricesCommand(program);
  registerClearCommand(program);
  registerCostBasisCommand(program);
  registerBalanceCommand(program);
  registerBlockchainsCommand(program);
  registerProvidersCommand(program);

  await program.parseAsync();
}

// Only catch initialization errors (before commands run).
// All command errors MUST go through displayCliError() or outputError() to ensure
// consistent JSON/text formatting and respect for --json flag. Global handlers would
// bypass these functions and violate financial correctness by producing inconsistent output.
main().catch((error) => {
  logger.error(`CLI initialization failed: ${String(error)}`);
  process.exit(1);
});
