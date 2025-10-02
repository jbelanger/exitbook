#!/usr/bin/env node
import path from 'node:path';

import { BalanceRepository, BalanceService, type BalanceVerificationResult, BalanceVerifier } from '@exitbook/balance';
import 'reflect-metadata';
import { closeDatabase, initializeDatabase, type StoredTransaction } from '@exitbook/data';
import {
  BlockchainProviderManager,
  DefaultNormalizer,
  TransactionIngestionService,
  ImportSessionRepository,
  RawDataRepository,
  TransactionRepository,
  ImporterFactory,
  ProcessorFactory,
  ProviderRegistry,
  type ProviderInfo,
} from '@exitbook/import';
import { getLogger } from '@exitbook/shared-logger';
import { loadExplorerConfig } from '@exitbook/shared-utils';
import { Command } from 'commander';

const logger = getLogger('CLI');
const program = new Command();

// Command option types
interface VerifyOptions {
  blockchain?: string | undefined;
  clearDb?: boolean | undefined;
  exchange?: string | undefined;
  report?: boolean | undefined;
}

interface StatusOptions {
  clearDb?: boolean | undefined;
}

interface ExportOptions {
  clearDb?: boolean | undefined;
  exchange?: string | undefined;
  format?: string | undefined;
  output?: string | undefined;
  since?: string | undefined;
}

interface ImportOptions {
  address?: string | undefined;
  blockchain?: string | undefined;
  clearDb?: boolean | undefined;
  csvDir?: string | undefined;
  exchange?: string | undefined;
  process?: boolean | undefined;
  provider?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
}

interface ProcessOptions {
  all?: boolean | undefined;
  blockchain?: string | undefined;
  clearDb?: boolean | undefined;
  exchange?: string | undefined;
  session?: string | undefined;
  since?: string | undefined;
}

async function main() {
  program
    .name('crypto-import')
    .description('Crypto transaction import and verification tool using CCXT')
    .version('1.0.0');

  // Verify command
  program
    .command('verify')
    .description('Verify calculated balances from imported transaction data')
    .option('--exchange <name>', 'Exchange name to verify (e.g., kraken, coinbase)')
    .option('--blockchain <name>', 'Blockchain name to verify (e.g., bitcoin, ethereum)')
    .option('--report', 'Generate detailed verification report')
    .option('--clear-db', 'Clear and reinitialize database before verification')
    .action(async (options: VerifyOptions) => {
      try {
        logger.info('Starting balance verification');

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        const balanceRepository = new BalanceRepository(database);
        const balanceService = new BalanceService(balanceRepository);
        const verifier = new BalanceVerifier(balanceService);

        const sourceName = options.exchange || options.blockchain;
        if (!sourceName) {
          logger.error(
            'Either --exchange or --blockchain is required. Examples: --exchange kraken, --blockchain bitcoin'
          );
          process.exit(1);
        }

        if (options.exchange && options.blockchain) {
          logger.error('Cannot specify both --exchange and --blockchain. Choose one.');
          process.exit(1);
        }

        const results = await verifier.verifyBalancesForSource(sourceName);

        displayVerificationResults(results);

        if (options.report) {
          const report = verifier.generateReport(results);
          const reportPath = path.join(process.cwd(), 'data', 'verification-report.md');
          await import('node:fs').then((fs) => fs.promises.writeFile(reportPath, report));
          logger.info(`Verification report generated: ${reportPath}`);
        }

        await closeDatabase(database);
        process.exit(0);
      } catch (error) {
        logger.error(`Verification failed: ${String(error)}`);
        process.exit(1);
      }
    });

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

  // Export command
  program
    .command('export')
    .description('Export transactions to CSV or JSON')
    .option('--format <type>', 'Export format (csv|json)', 'csv')
    .option('--exchange <name>', 'Export from specific exchange only')
    .option('--since <date>', 'Export transactions since date (YYYY-MM-DD, timestamp, or 0 for all history)')
    .option('--output <file>', 'Output file path')
    .option('--clear-db', 'Clear and reinitialize database before export')
    .action(async (options: ExportOptions) => {
      try {
        logger.info('Starting export');

        const database = await initializeDatabase(options.clearDb);

        let since: number | undefined;
        if (options.since) {
          since = new Date(options.since).getTime();
          if (isNaN(since)) {
            logger.error('Invalid date format. Use YYYY-MM-DD');
            process.exit(1);
          }
        }

        const transactionRepository = new TransactionRepository(database);
        const transactionsResult = await transactionRepository.getTransactions(options.exchange, since);

        if (transactionsResult.isErr()) {
          logger.error(`Failed to retrieve transactions: ${transactionsResult.error.message}`);
          throw transactionsResult.error;
        }

        const transactions = transactionsResult.value;

        const outputPath =
          options.output || path.join(process.cwd(), 'data', `transactions.${options.format || 'csv'}`);

        if ((options.format || 'csv') === 'csv') {
          const csv = convertToCSV(transactions);
          await import('node:fs').then((fs) => fs.promises.writeFile(outputPath, csv));
        } else {
          const json = convertToJSON(transactions);
          await import('node:fs').then((fs) => fs.promises.writeFile(outputPath, json));
        }

        logger.info(`\n💾 Exported ${transactions.length} transactions to: ${outputPath}`);

        await closeDatabase(database);
        process.exit(0);
      } catch (error) {
        logger.error(`Export failed: ${String(error)}`);
        process.exit(1);
      }
    });

  // Import command - new ETL workflow
  program
    .command('import')
    .description('Import raw data from external sources (blockchain or exchange)')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, coinbase, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, polkadot, bittensor)')
    .option('--csv-dir <path>', 'CSV directory for exchange sources')
    .option('--address <address>', 'Wallet address for blockchain source')
    .option('--provider <name>', 'Blockchain provider for blockchain sources')
    .option('--since <date>', 'Import data since date (YYYY-MM-DD, timestamp, or 0 for all history)')
    .option('--until <date>', 'Import data until date (YYYY-MM-DD or timestamp)')
    .option('--process', 'Process data after import (combined import+process pipeline)')
    .option('--clear-db', 'Clear and reinitialize database before import')
    .action(async (options: ImportOptions) => {
      try {
        // Validate required parameters
        const sourceName = options.exchange || options.blockchain;
        if (!sourceName) {
          logger.error(
            'Either --exchange or --blockchain is required. Examples: --exchange kraken, --blockchain bitcoin'
          );
          process.exit(1);
        }

        if (options.exchange && options.blockchain) {
          logger.error('Cannot specify both --exchange and --blockchain. Choose one.');
          process.exit(1);
        }

        const sourceType = options.exchange ? 'exchange' : 'blockchain';
        logger.info(`Starting data import from ${sourceName} (${sourceType})`);

        // Validate parameters based on source type
        if (sourceType === 'exchange' && !options.csvDir) {
          logger.error('--csv-dir is required for exchange sources');
          process.exit(1);
        }

        if (sourceType === 'blockchain' && !options.address) {
          logger.error('--address is required for blockchain sources');
          process.exit(1);
        }

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        // Load explorer config for blockchain sources
        const explorerConfig = loadExplorerConfig();

        const transactionRepository = new TransactionRepository(database);
        const rawDataRepository = new RawDataRepository(database);
        const sessionRepository = new ImportSessionRepository(database);
        const providerManager = new BlockchainProviderManager(explorerConfig);
        const importerFactory = new ImporterFactory(providerManager);
        const processorFactory = new ProcessorFactory();
        const normalizer = new DefaultNormalizer();

        const ingestionService = new TransactionIngestionService(
          rawDataRepository,
          sessionRepository,
          transactionRepository,
          importerFactory,
          processorFactory,
          normalizer
        );

        try {
          // Parse options
          const since = options.since
            ? isNaN(Number(options.since))
              ? new Date(options.since).getTime()
              : parseInt(options.since)
            : undefined;
          const until = options.until
            ? isNaN(Number(options.until))
              ? new Date(options.until).getTime()
              : parseInt(options.until)
            : undefined;

          const importParams: {
            address?: string | undefined;
            csvDirectories?: string[] | undefined;
            providerId?: string | undefined;
            since?: number | undefined;
            until?: number | undefined;
          } = { since, until };

          // Set parameters based on source type
          if (sourceType === 'exchange') {
            importParams.csvDirectories = options.csvDir ? [options.csvDir] : undefined;
          } else {
            importParams.address = options.address;
            importParams.providerId = options.provider;
          }

          // Import raw data
          const importResult = await ingestionService.importFromSource(sourceName, sourceType, importParams);

          if (importResult.isErr()) {
            logger.error(`Import failed: ${importResult.error.message}`);
            throw importResult.error;
          }

          const importData = importResult.value;
          logger.info(`Import completed: ${importData.imported} items imported`);
          logger.info(`Session ID: ${importData.importSessionId}`);

          // Process data if --process flag is provided
          if (options.process) {
            logger.info('Processing imported data to universal format');

            const processResultOrError = await ingestionService.processRawDataToTransactions(sourceName, sourceType, {
              importSessionId: importData.importSessionId,
            });

            if (processResultOrError.isErr()) {
              logger.error(`Processing failed: ${processResultOrError.error.message}`);
              throw processResultOrError.error;
            }

            const processResult = processResultOrError.value;

            if (processResult.errors.length > 0) {
              logger.error('Processing errors:');
              processResult.errors.slice(0, 5).forEach((error) => logger.error(`  ${error}`));
              if (processResult.errors.length > 5) {
                logger.error(`  ... and ${processResult.errors.length - 5} more errors`);
              }
            }
          }
        } finally {
          // Cleanup provider manager resources
          providerManager.destroy();
          await closeDatabase(database);
        }

        // Exit successfully
        process.exit(0);
      } catch (error) {
        logger.error(`Import failed: ${String(error)}`);
        console.error(error);
        process.exit(1);
      }
    });

  // Process command - new ETL workflow
  program
    .command('process')
    .description('Transform raw imported data to universal transaction format')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, coinbase, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, polkadot, bittensor)')
    .option('--session <id>', 'Import session ID to process')
    .option('--since <date>', 'Process data since date (YYYY-MM-DD or timestamp)')
    .option('--all', 'Process all pending raw data for this source')
    .option('--clear-db', 'Clear and reinitialize database before processing')
    .action(async (options: ProcessOptions) => {
      try {
        // Validate required parameters
        const sourceName = options.exchange || options.blockchain;
        if (!sourceName) {
          logger.error(
            'Either --exchange or --blockchain is required. Examples: --exchange kraken, --blockchain bitcoin'
          );
          process.exit(1);
        }

        if (options.exchange && options.blockchain) {
          logger.error('Cannot specify both --exchange and --blockchain. Choose one.');
          process.exit(1);
        }

        const sourceType = options.exchange ? 'exchange' : 'blockchain';
        logger.info(`Starting data processing from ${sourceName} (${sourceType}) to universal format`);

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        // Load explorer config for blockchain sources
        const explorerConfig = loadExplorerConfig();

        const transactionRepository = new TransactionRepository(database);
        const rawDataRepository = new RawDataRepository(database);
        const sessionRepository = new ImportSessionRepository(database);
        const providerManager = new BlockchainProviderManager(explorerConfig);
        const importerFactory = new ImporterFactory(providerManager);
        const processorFactory = new ProcessorFactory();
        const normalizer = new DefaultNormalizer();

        const ingestionService = new TransactionIngestionService(
          rawDataRepository,
          sessionRepository,
          transactionRepository,
          importerFactory,
          processorFactory,
          normalizer
        );

        try {
          // Parse filters
          const filters: { createdAfter?: number; importSessionId?: number } = {};

          if (options.session) {
            filters.importSessionId = parseInt(options.session, 10);
          }

          if (options.since) {
            const sinceTimestamp = isNaN(Number(options.since))
              ? new Date(options.since).getTime()
              : parseInt(options.since);
            filters.createdAfter = Math.floor(sinceTimestamp / 1000); // Convert to seconds for database
          }

          const resultOrError = await ingestionService.processRawDataToTransactions(sourceName, sourceType, filters);

          if (resultOrError.isErr()) {
            logger.error(`Processing failed: ${resultOrError.error.message}`);
            throw resultOrError.error;
          }

          const result = resultOrError.value;

          if (result.errors.length > 0) {
            logger.error('Processing errors:');
            result.errors.slice(0, 5).forEach((error) => logger.error(`  ${error}`));
            if (result.errors.length > 5) {
              logger.error(`  ... and ${result.errors.length - 5} more errors`);
            }
          }
        } finally {
          // Cleanup provider manager resources
          providerManager.destroy();
          await closeDatabase(database);
        }

        // Exit successfully
        process.exit(0);
      } catch (error) {
        logger.error(`Processing failed: ${String(error)}`);
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

  // List blockchains command
  program
    .command('list-blockchains')
    .description('List all available blockchains')
    .action(async () => {
      try {
        logger.info('Available Blockchains:');
        logger.info('=============================');
        logger.info('');
        logger.info('For detailed provider information, run: pnpm run blockchain-providers:list');
        logger.info('');

        const processorFactory = new ProcessorFactory();

        const supportedBlockchains = await processorFactory.getSupportedSources('blockchain');

        // Get all providers and group by blockchain
        const allProviders = ProviderRegistry.getAllProviders();
        const providersByBlockchain = allProviders.reduce(
          (acc: Record<string, string[]>, provider: ProviderInfo) => {
            if (!acc[provider.blockchain]) {
              acc[provider.blockchain] = [];
            }
            (acc[provider.blockchain] ??= []).push(provider.name);
            return acc;
          },
          {} as Record<string, string[]>
        );

        for (const blockchainName of supportedBlockchains) {
          logger.info(`⛓️  ${blockchainName.toUpperCase()}`);
          const providers = providersByBlockchain[blockchainName] || [];
          if (providers.length > 0) {
            logger.info(`   Providers: ${providers.join(', ')}`);
          } else {
            logger.info('   Providers: (none registered)');
          }
          logger.info('');
        }

        logger.info(`Total blockchains: ${supportedBlockchains.length}`);
        logger.info('');
        logger.info('Usage examples:');
        logger.info('  crypto-import import --blockchain bitcoin --address 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
        logger.info('  crypto-import import --blockchain ethereum --address 0x742d35Cc...');

        process.exit(0);
      } catch (error) {
        logger.error(`Failed to list blockchains: ${String(error)}`);
        process.exit(1);
      }
    });

  await program.parseAsync();
}

function displayVerificationResults(results: BalanceVerificationResult[]): void {
  const logger = getLogger('CLI');
  logger.info('\nBalance Verification Results');
  logger.info('================================');

  for (const result of results) {
    logger.info(`\n${result.source} - ${result.status.toUpperCase()}`);

    if (result.error) {
      logger.error(`  Error: ${result.error}`);
      continue;
    }

    // Special handling for CSV adapters (indicated by note about CSV adapter)
    if (result.note && result.note.includes('CSV adapter')) {
      logger.info(`  Calculated Balances Summary (${result.summary.totalCurrencies} currencies)`);

      // Show all non-zero calculated balances for CSV adapters
      const significantBalances = result.comparisons
        .filter((c) => Math.abs(c.calculatedBalance) > 0.00000001)
        .sort((a, b) => Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance));

      if (significantBalances.length > 0) {
        logger.info('  Current balances:');
        for (const balance of significantBalances.slice(0, 25)) {
          // Show top 25
          const formattedBalance = balance.calculatedBalance.toFixed(8).replace(/\.?0+$/, '');
          logger.info(`    ${balance.currency}: ${formattedBalance}`);
        }

        if (significantBalances.length > 25) {
          logger.info(`    ... and ${significantBalances.length - 25} more currencies`);
        }

        // Show zero balances count if any
        const zeroBalances = result.comparisons.length - significantBalances.length;
        if (zeroBalances > 0) {
          logger.info(`  Zero balances: ${zeroBalances} currencies`);
        }
      } else {
        logger.info('  No significant balances found');
      }

      logger.info(`  Note: ${result.note}`);
    } else {
      // Standard live balance verification display
      logger.info(`  Currencies: ${result.summary.totalCurrencies}`);
      logger.info(`  Matches: ${result.summary.matches}`);
      logger.info(`  Warnings: ${result.summary.warnings}`);
      logger.info(`  Mismatches: ${result.summary.mismatches}`);

      // Show calculated balances for significant currencies
      // For blockchain verifications (status warning, live balance always 0), show all currencies with transactions
      // For exchange verifications, only show non-zero balances
      const isBlockchainVerification =
        result.status === 'warning' && result.comparisons.every((c) => c.liveBalance === 0);
      const significantBalances = result.comparisons
        .filter(
          (c) =>
            isBlockchainVerification ||
            Math.abs(c.calculatedBalance) > 0.00000001 ||
            Math.abs(c.liveBalance) > 0.00000001
        )
        .sort((a, b) => Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance))
        .slice(0, 10); // Show top 10

      if (significantBalances.length > 0) {
        logger.info('  Calculated vs Live Balances:');
        for (const balance of significantBalances) {
          const calc = balance.calculatedBalance.toFixed(8).replace(/\.?0+$/, '');
          const live = balance.liveBalance.toFixed(8).replace(/\.?0+$/, '');
          const status = balance.status === 'match' ? '✓' : balance.status === 'warning' ? '⚠' : '✗';
          logger.info(`    ${balance.currency}: ${calc} (calc) | ${live} (live) ${status}`);
        }
      }

      // Show top issues
      const issues = result.comparisons.filter((c) => c.status !== 'match').slice(0, 3);
      if (issues.length > 0) {
        logger.info('  Top issues:');
        for (const issue of issues) {
          logger.info(`    ${issue.currency}: ${issue.difference.toFixed(8)} (${issue.percentageDiff.toFixed(2)}%)`);
        }
      }
    }
  }
}

function convertToCSV(transactions: StoredTransaction[]): string {
  if (transactions.length === 0) return '';

  const headers = [
    'id',
    'source',
    'operation_category',
    'operation_type',
    'timestamp',
    'datetime',
    'primary_asset',
    'primary_amount',
    'primary_direction',
    'total_fee',
    'price',
    'price_currency',
    'status',
  ];
  const csvLines = [headers.join(',')];

  for (const tx of transactions) {
    // Format datetime properly
    const datetime =
      tx.transaction_datetime || (tx.transaction_datetime ? new Date(tx.transaction_datetime).toISOString() : '');

    const values = [
      tx.id || '',
      tx.source_id || '',
      tx.operation_category || '',
      tx.operation_type || '',
      tx.transaction_datetime || '',
      datetime,
      tx.movements_primary_asset || '',
      tx.movements_primary_amount || '',
      tx.movements_primary_direction || '',
      tx.fees_total || '',
      tx.price || '',
      tx.price_currency || '',
      tx.transaction_status || '',
    ];

    // Escape values that contain commas
    const escapedValues = values.map((value) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Proper check done
      const stringValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
    });

    csvLines.push(escapedValues.join(','));
  }

  return csvLines.join('\n');
}

function convertToJSON(transactions: StoredTransaction[]): string {
  if (transactions.length === 0) return '[]';

  const processedTransactions = transactions.map((tx) => {
    return {
      id: tx.id,
      source_id: tx.source_id,
      datetime: tx.transaction_datetime,
      status: tx.transaction_status,
      operation: {
        category: tx.operation_category,
        type: tx.operation_type,
      },
      movements: {
        primary: {
          asset: tx.movements_primary_asset,
          amount: tx.movements_primary_amount,
          direction: tx.movements_primary_direction,
        },
        inflows: tx.movements_inflows,
        outflows: tx.movements_outflows,
      },
      fees: {
        total: tx.fees_total,
        network: tx.fees_network,
        platform: tx.fees_platform,
      },
      price: tx.price,
      price_currency: tx.price_currency,
      blockchain: {
        name: tx.blockchain_name,
        block_height: tx.blockchain_block_height,
        transaction_hash: tx.blockchain_transaction_hash,
        is_confirmed: tx.blockchain_is_confirmed,
      },
      verified: tx.verified,
      created_at: tx.created_at,
    };
  });

  return JSON.stringify(processedTransactions, undefined, 2);
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
