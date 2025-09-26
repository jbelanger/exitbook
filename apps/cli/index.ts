#!/usr/bin/env node
import path from 'node:path';

import { type BalanceVerificationResult, BalanceVerifier } from '@crypto/balance';
import 'reflect-metadata';
import { BalanceService } from '@crypto/balance/src/app/services/balance-service';
import { BalanceRepository } from '@crypto/balance/src/infrastructure/persistence/balance-repository';
import type { StoredTransaction } from '@crypto/data';
import { Database } from '@crypto/data';
import { BlockchainProviderManager, TransactionIngestionService, TransactionRepository } from '@crypto/import';
import { getLogger } from '@crypto/shared-logger';
import { initializeDatabase, loadExplorerConfig } from '@crypto/shared-utils';
import { Command } from 'commander';

const logger = getLogger('CLI');
const program = new Command();

// Command option types
interface VerifyOptions {
  blockchain?: string;
  exchange?: string;
  report?: boolean;
}

interface StatusOptions {
  clearDb?: boolean;
  config?: string;
}

interface ExportOptions {
  clearDb?: boolean;
  exchange?: string;
  format?: string;
  output?: string;
  since?: string;
}

interface ImportOptions {
  address?: string;
  blockchain?: string;
  clearDb?: boolean;
  config?: string;
  csvDir?: string;
  exchange?: string;
  process?: boolean;
  provider?: string;
  since?: string;
  until?: string;
}

interface ProcessOptions {
  all?: boolean;
  blockchain?: string;
  clearDb?: boolean;
  config?: string;
  exchange?: string;
  session?: string;
  since?: string;
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
    .action(async (options: VerifyOptions) => {
      try {
        logger.info('Starting balance verification');

        // Initialize database
        const database = await initializeDatabase();

        const balanceRepository = new BalanceRepository(database['db']);
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

        const results = await verifier.verifyExchangeById(sourceName);

        displayVerificationResults(results);

        if (options.report) {
          const report = verifier.generateReport(results);
          const reportPath = path.join(process.cwd(), 'data', 'verification-report.md');
          await import('node:fs').then((fs) => fs.promises.writeFile(reportPath, report));
          logger.info(`Verification report generated: ${reportPath}`);
        }

        await database.close();
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
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before status')
    .action(async (options: StatusOptions) => {
      try {
        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          logger.info('Database cleared and reinitialized');
        }
        const stats = await database.getStats();

        logger.info('\nSystem Status');
        logger.info('================');
        logger.info(`Total transactions: ${stats.totalTransactions}`);
        logger.info(`Total exchanges: ${stats.totalExchanges}`);
        logger.info(`Total import sessions: ${stats.totalImportSessions}`);
        logger.info(`Total verifications: ${stats.totalVerifications}`);
        logger.info(`Total snapshots: ${stats.totalSnapshots}`);

        if (stats.transactionsByExchange.length > 0) {
          logger.info('\n📈 Transactions by Exchange:');
          for (const { count, exchange } of stats.transactionsByExchange) {
            logger.info(`  ${exchange}: ${count}`);
          }
        }

        // Show recent verification results
        const balanceRepository = new BalanceRepository(database['db']);
        const latestVerifications = await balanceRepository.getLatestVerifications();
        if (latestVerifications.length > 0) {
          logger.info('\n🔍 Latest Balance Verifications:');
          const groupedByExchange = latestVerifications.reduce(
            (acc: Record<string, typeof latestVerifications>, v) => {
              if (!acc[v.exchange]) acc[v.exchange] = [];
              acc[v.exchange].push(v);
              return acc;
            },
            {} as Record<string, typeof latestVerifications>
          );

          for (const [exchange, verifications] of Object.entries(groupedByExchange)) {
            const matches = (verifications).filter((v) => v.status === 'match').length;
            const total = (verifications).length;
            const status = matches === total ? '✅' : '⚠️';
            logger.info(`  ${status} ${exchange}: ${matches}/${total} balances match`);
          }
        }

        await database.close();
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

        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          logger.info('Database cleared and reinitialized');
        }

        let since: number | undefined;
        if (options.since) {
          since = new Date(options.since).getTime();
          if (isNaN(since)) {
            logger.error('Invalid date format. Use YYYY-MM-DD');
            process.exit(1);
          }
        }

        const transactionRepository = new TransactionRepository(database['db']);
        const transactions = await transactionRepository.getTransactions(options.exchange, since);

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

        await database.close();
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
    .option('--config <path>', 'Path to configuration file')
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

        // Create dependencies directly without adapter bridges
        const { RawDataRepository } = await import(
          '@crypto/import/src/infrastructure/persistence/raw-data-repository.ts'
        );
        const { ImportSessionRepository } = await import(
          '@crypto/import/src/infrastructure/persistence/import-session-repository.ts'
        );
        const { ImporterFactory } = await import(
          '@crypto/import/src/infrastructure/shared/importers/importer-factory.ts'
        );
        const { ProcessorFactory } = await import(
          '@crypto/import/src/infrastructure/shared/processors/processor-factory.ts'
        );

        const transactionRepository = new TransactionRepository(database['db']);
        const rawDataRepository = new RawDataRepository(database['db']);
        const sessionRepository = new ImportSessionRepository(database['db']);
        const providerManager = new BlockchainProviderManager(explorerConfig);
        const importerFactory = new ImporterFactory(providerManager);
        const processorFactory = new ProcessorFactory();

        const ingestionService = new TransactionIngestionService(
          rawDataRepository,
          sessionRepository,
          transactionRepository,
          importerFactory,
          processorFactory
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

          logger.info(`Import completed: ${importResult.imported} items imported`);
          logger.info(`Session ID: ${importResult.importSessionId}`);

          // Process data if --process flag is provided
          if (options.process) {
            logger.info('Processing imported data to universal format');

            const processResult = await ingestionService.processAndStore(sourceName, sourceType, {
              importSessionId: importResult.importSessionId,
            });

            logger.info(`Processing completed: ${processResult.processed} processed, ${processResult.failed} failed`);

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
          await database.close();
        }

        // Exit successfully
        process.exit(0);
      } catch (error) {
        logger.error(`Import failed: ${String(error)}`);
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
    .option('--config <path>', 'Path to configuration file')
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

        // Create dependencies directly without adapter bridges
        const { RawDataRepository } = await import(
          '@crypto/import/src/infrastructure/persistence/raw-data-repository.ts'
        );
        const { ImportSessionRepository } = await import(
          '@crypto/import/src/infrastructure/persistence/import-session-repository.ts'
        );
        const { ImporterFactory } = await import(
          '@crypto/import/src/infrastructure/shared/importers/importer-factory.ts'
        );
        const { ProcessorFactory } = await import(
          '@crypto/import/src/infrastructure/shared/processors/processor-factory.ts'
        );

        const transactionRepository = new TransactionRepository(database['db']);
        const rawDataRepository = new RawDataRepository(database['db']);
        const sessionRepository = new ImportSessionRepository(database['db']);
        const providerManager = new BlockchainProviderManager(explorerConfig);
        const importerFactory = new ImporterFactory(providerManager);
        const processorFactory = new ProcessorFactory();

        const ingestionService = new TransactionIngestionService(
          rawDataRepository,
          sessionRepository,
          transactionRepository,
          importerFactory,
          processorFactory
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

          const result = await ingestionService.processAndStore(sourceName, sourceType, filters);

          logger.info(`Processing completed: ${result.processed} processed, ${result.failed} failed`);

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
          await database.close();
        }

        // Exit successfully
        process.exit(0);
      } catch (error) {
        logger.error(`Processing failed: ${String(error)}`);
        process.exit(1);
      }
    });

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

        // Get supported blockchains from ProcessorFactory
        const { ProcessorFactory } = await import(
          '@crypto/import/src/infrastructure/shared/processors/processor-factory.ts'
        );
        const processorFactory = new ProcessorFactory();

        const supportedBlockchains = processorFactory.getSupportedSources('blockchain');

        // Also get provider information for completeness
        const { ProviderRegistry } = await import(
          '@crypto/import/src/infrastructure/blockchains/shared/registry/provider-registry.ts'
        );

        // Import all providers to ensure they're registered
        await import('@crypto/import/src/infrastructure/blockchains/registry/register-providers.ts');

        // Get all providers and group by blockchain
        const allProviders = ProviderRegistry.getAllProviders();
        const providersByBlockchain = allProviders.reduce(
          (acc, provider) => {
            if (!acc[provider.blockchain]) {
              acc[provider.blockchain] = [];
            }
            acc[provider.blockchain].push(provider.name);
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
    logger.info(`\n${result.exchange} - ${result.status.toUpperCase()}`);

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
    'exchange',
    'type',
    'timestamp',
    'datetime',
    'amount',
    'amount_currency',
    'side',
    'price',
    'price_currency',
    'fee_cost',
    'fee_currency',
    'cost',
    'status',
  ];
  const csvLines = [headers.join(',')];

  for (const tx of transactions) {
    // Use normalized database columns instead of parsing raw_data

    // Calculate cost from amount * price if available
    let cost = '';
    if (tx.amount && tx.price) {
      try {
        const amountNum = parseFloat(String(tx.amount));
        const priceNum = parseFloat(String(tx.price));
        if (!isNaN(amountNum) && !isNaN(priceNum)) {
          cost = (amountNum * priceNum).toString();
        }
      } catch (e) {
        // Ignore calculation errors
      }
    }

    // Format datetime properly
    const datetime = tx.datetime || (tx.timestamp ? new Date(tx.timestamp).toISOString() : '');

    const values = [
      tx.id || '',
      tx.source_id || '',
      tx.type || '',
      tx.timestamp || '',
      datetime,
      tx.amount || '',
      tx.amount_currency || '',
      '',
      tx.price || '',
      tx.price_currency || '',
      tx.fee_cost || '',
      tx.fee_currency || '',
      cost,
      tx.status || '',
    ];

    // Escape values that contain commas
    const escapedValues = values.map((value) => {
      const stringValue = String(value);
      return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
    });

    csvLines.push(escapedValues.join(','));
  }

  return csvLines.join('\n');
}

function convertToJSON(transactions: StoredTransaction[]): string {
  if (transactions.length === 0) return '[]';

  // Use normalized database columns and add calculated cost field
  const processedTransactions = transactions.map((tx) => {
    // Calculate cost from amount * price if available
    let cost: number | undefined;
    if (tx.amount && tx.price) {
      try {
        const amountNum = parseFloat(String(tx.amount));
        const priceNum = parseFloat(String(tx.price));
        if (!isNaN(amountNum) && !isNaN(priceNum)) {
          cost = amountNum * priceNum;
        }
      } catch (e) {
        // Ignore calculation errors
      }
    }

    return {
      amount: tx.amount,
      amount_currency: tx.amount_currency,
      cost: cost,
      created_at: tx.created_at,
      datetime: tx.datetime,
      fee_cost: tx.fee_cost,
      fee_currency: tx.fee_currency,
      hash: tx.hash,
      id: tx.id,
      price: tx.price,
      price_currency: tx.price_currency,
      side: '',
      source_id: tx.source_id,
      status: tx.status,
      symbol: tx.symbol,
      timestamp: tx.timestamp,
      type: tx.type,
      verified: tx.verified,
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
