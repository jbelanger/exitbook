import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { wrapError } from '@exitbook/foundation';
import { flushLoggers, getLogger, initLogger, type LogLevel } from '@exitbook/logger';
import { FileSink } from '@exitbook/logger';
import { Command } from 'commander';

import { registerAccountsCommand } from './features/accounts/command/accounts.js';
import { registerAssetsCommand } from './features/assets/command/assets.js';
import { registerBlockchainsCommand } from './features/blockchains/command/blockchains.js';
import { registerClearCommand } from './features/clear/command/clear.js';
import { registerCostBasisCommand } from './features/cost-basis/command/cost-basis.js';
import { registerImportCommand } from './features/import/command/import.js';
import { registerIssuesCommand } from './features/issues/command/issues.js';
import { registerLinksCommand } from './features/links/command/links.js';
import { registerPortfolioCommand } from './features/portfolio/command/portfolio.js';
import { registerPricesCommand } from './features/prices/command/prices.js';
import { registerProfilesCommand } from './features/profiles/command/profiles.js';
import { registerProvidersCommand } from './features/providers/command/providers.js';
import { registerReprocessCommand } from './features/reprocess/command/reprocess.js';
import { registerTransactionsCommand } from './features/transactions/command/transactions.js';
import { createCliAppRuntime } from './runtime/app-runtime.js';

const logger = getLogger('cli');

function readCliVersion(): string {
  const filename = fileURLToPath(import.meta.url);
  const packageJsonPath = join(dirname(filename), '../package.json');

  try {
    const packageJson: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    if (
      typeof packageJson === 'object' &&
      packageJson !== null &&
      'version' in packageJson &&
      typeof packageJson.version === 'string'
    ) {
      return packageJson.version;
    }
  } catch (error) {
    const wrappedError = wrapError(error, `Failed to read CLI version from ${packageJsonPath}`);
    if (wrappedError.isErr()) {
      logger.warn({ error: wrappedError.error, packageJsonPath }, 'Falling back to development CLI version');
    }
    return '0.0.0';
  }

  logger.warn(
    { packageJsonPath },
    'CLI package metadata missing string version; falling back to development CLI version'
  );
  return '0.0.0';
}

function configureCliLogger(): void {
  const validLevels = new Set<LogLevel>(['trace', 'debug', 'info', 'warn', 'error']);
  const envLevel = process.env['LOGGER_LOG_LEVEL']?.toLowerCase();
  const logLevel: LogLevel = validLevels.has(envLevel as LogLevel) ? (envLevel as LogLevel) : 'info';
  const logPath = process.env['LOGGER_FILE_PATH'] ?? './data/logs/application.log';

  initLogger({
    level: logLevel,
    sinks: [new FileSink({ path: logPath })],
  });
}

function createProgram(): Command {
  const program = new Command();
  const appRuntime = createCliAppRuntime();

  program
    .name('exitbook')
    .description('Track crypto activity across accounts, reconcile it, and produce tax-ready reports')
    .version(readCliVersion())
    .showSuggestionAfterError()
    .showHelpAfterError()
    .addHelpText(
      'after',
      `
Start Here:
  $ exitbook accounts add kraken-main --exchange kraken --api-key KEY --api-secret SECRET
  $ exitbook import kraken-main
  $ exitbook prices enrich
  $ exitbook portfolio

Command Journeys:
  Workspace setup      profiles, accounts, blockchains, providers
  Sync and rebuild     import, reprocess, links run, prices enrich, accounts refresh
  Review and resolve   issues, transactions explore, links explore, assets explore, accounts explore
  Analyze and export   portfolio, cost-basis, transactions export, cost-basis export
  Cleanup and recovery clear

Notes:
  - Use the active profile as your workspace boundary. See "exitbook profiles --help".
  - Add --json when you need machine-readable output.
`
    );

  registerImportCommand(program, appRuntime);
  registerProfilesCommand(program);
  registerReprocessCommand(program, appRuntime);
  registerIssuesCommand(program);
  registerLinksCommand(program, appRuntime);
  registerAccountsCommand(program, appRuntime);
  registerAssetsCommand(program);
  registerTransactionsCommand(program);
  registerPricesCommand(program, appRuntime);
  registerClearCommand(program);
  registerCostBasisCommand(program, appRuntime);
  registerBlockchainsCommand(program, appRuntime);
  registerProvidersCommand(program, appRuntime);
  registerPortfolioCommand(program, appRuntime);

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  configureCliLogger();
  process.on('exit', () => flushLoggers());

  const program = createProgram();
  await program.parseAsync(argv);
}
