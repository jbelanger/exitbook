#!/usr/bin/env node
import { type BalanceVerificationResult, BalanceVerifier } from '@crypto/balance';
import { BalanceRepository, BalanceService, Database, type StoredTransaction } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import { initializeDatabase, loadExplorerConfig } from '@crypto/shared-utils';
import { Command } from 'commander';
import path from 'path';
import 'reflect-metadata';

// TODO: This source type determination needs improvement in the future.
// Consider implementing a proper source registry system that both blockchain
// and exchange adapters can register with, eliminating the need for try-catch logic.
async function determineSourceType(sourceName: string): Promise<'blockchain' | 'exchange' | null> {
  const { UniversalAdapterFactory } = await import('@crypto/import');
  const { loadExplorerConfig } = await import('@crypto/shared-utils');

  // Try blockchain first - attempt to create a real adapter
  try {
    const config = UniversalAdapterFactory.createBlockchainConfig(sourceName);
    const explorerConfig = loadExplorerConfig();
    // This will throw if the blockchain is not supported
    await UniversalAdapterFactory.create(config, explorerConfig);
    return 'blockchain';
  } catch {
    // Try exchange - attempt to create a real adapter
    try {
      const config = UniversalAdapterFactory.createExchangeConfig(sourceName, 'csv', {
        csvDirectories: ['/tmp'], // dummy directory for validation
      });
      // This will throw if the exchange is not supported
      await UniversalAdapterFactory.create(config);
      return 'exchange';
    } catch {
      return null; // Unknown source
    }
  }
}

const logger = getLogger('CLI');
const program = new Command();

async function main() {
  program
    .name('crypto-import')
    .description('Crypto transaction import and verification tool using CCXT')
    .version('1.0.0');

  // Verify command
  program
    .command('verify')
    .description('Verify calculated balances from imported transaction data')
    .option('--source <name>', 'Source to verify (exchange or blockchain name)')
    .option('--report', 'Generate detailed verification report')
    .action(async options => {
      try {
        logger.info('Starting balance verification');

        // Initialize database
        const database = await initializeDatabase();

        const balanceRepository = new BalanceRepository(database);
        const balanceService = new BalanceService(balanceRepository);
        const verifier = new BalanceVerifier(balanceService);

        if (!options.source) {
          logger.error('--source is required. Examples: kraken, bitcoin, ethereum');
          process.exit(1);
        }

        const results = await verifier.verifyExchangeById(options.source);

        displayVerificationResults(results);

        if (options.report) {
          const report = await verifier.generateReport(results);
          const reportPath = path.join(process.cwd(), 'data', 'verification-report.md');
          await import('fs').then(fs => fs.promises.writeFile(reportPath, report));
          logger.info(`Verification report generated: ${reportPath}`);
        }

        await database.close();
        process.exit(0);
      } catch (error) {
        logger.error(`Verification failed: ${error}`);
        process.exit(1);
      }
    });

  // Status command
  program
    .command('status')
    .description('Show system status and recent verification results')
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before status')
    .action(async options => {
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
        logger.info(`Total verifications: ${stats.totalVerifications}`);
        logger.info(`Total snapshots: ${stats.totalSnapshots}`);

        if (stats.transactionsByExchange.length > 0) {
          logger.info('\n📈 Transactions by Exchange:');
          for (const { count, exchange } of stats.transactionsByExchange) {
            logger.info(`  ${exchange}: ${count}`);
          }
        }

        // Show recent verification results
        const latestVerifications = await database.getLatestBalanceVerifications();
        if (latestVerifications.length > 0) {
          logger.info('\n🔍 Latest Balance Verifications:');
          const groupedByExchange = latestVerifications.reduce(
            (acc, v) => {
              if (!acc[v.exchange]) acc[v.exchange] = [];
              acc[v.exchange]!.push(v);
              return acc;
            },
            {} as Record<string, typeof latestVerifications>
          );

          for (const [exchange, verifications] of Object.entries(groupedByExchange)) {
            const matches = verifications.filter(v => v.status === 'match').length;
            const total = verifications.length;
            const status = matches === total ? '✅' : '⚠️';
            logger.info(`  ${status} ${exchange}: ${matches}/${total} balances match`);
          }
        }

        await database.close();
        process.exit(0);
      } catch (error) {
        logger.error(`Status check failed: ${error}`);
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
    .action(async options => {
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

        const transactions = await database.getTransactions(options.exchange, since);

        const outputPath = options.output || path.join(process.cwd(), 'data', `transactions.${options.format}`);

        if (options.format === 'csv') {
          const csv = await convertToCSV(transactions);
          await import('fs').then(fs => fs.promises.writeFile(outputPath, csv));
        } else {
          const json = await convertToJSON(transactions);
          await import('fs').then(fs => fs.promises.writeFile(outputPath, json));
        }

        logger.info(`\n💾 Exported ${transactions.length} transactions to: ${outputPath}`);

        await database.close();
        process.exit(0);
      } catch (error) {
        logger.error(`Export failed: ${error}`);
        process.exit(1);
      }
    });

  // Import command - new ETL workflow
  program
    .command('import')
    .description('Import raw data from external sources (blockchain or exchange)')
    .option('--source <name>', 'Source name (e.g., kraken, bitcoin, polkadot, bittensor)')
    .option('--csv-dir <path>', 'CSV directory for exchange sources')
    .option('--addresses <addresses...>', 'Wallet addresses for blockchain sources (space-separated)')
    .option('--provider <name>', 'Blockchain provider for blockchain sources')
    .option('--since <date>', 'Import data since date (YYYY-MM-DD, timestamp, or 0 for all history)')
    .option('--until <date>', 'Import data until date (YYYY-MM-DD or timestamp)')
    .option('--process', 'Process data after import (combined import+process pipeline)')
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before import')
    .action(async options => {
      try {
        // Validate required source parameter
        if (!options.source) {
          logger.error('--source is required. Examples: bitcoin, ethereum, polkadot, bittensor, kraken');
          process.exit(1);
        }

        logger.info(`Starting data import from ${options.source}`);

        // Determine adapter type based on source name
        const adapterType = await determineSourceType(options.source);
        if (!adapterType) {
          logger.error(`Unknown source: ${options.source}. Source must be a valid blockchain or exchange adapter.`);
          process.exit(1);
        }

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        // Load explorer config for blockchain adapters
        const explorerConfig = loadExplorerConfig();

        // Create ingestion service with dependencies
        const { TransactionIngestionService } = await import(
          '@crypto/import/src/shared/ingestion/ingestion-service.ts'
        );
        const { ExternalDataStore } = await import('@crypto/import/src/shared/storage/external-data-store.ts');

        // Import blockchain dependencies conditionally
        let providerManager:
          | import('@crypto/import/src/blockchains/shared/blockchain-provider-manager.ts').BlockchainProviderManager
          | null = null;
        if (adapterType === 'blockchain') {
          const { BlockchainProviderManager } = await import(
            '@crypto/import/src/blockchains/shared/blockchain-provider-manager.ts'
          );
          providerManager = new BlockchainProviderManager(explorerConfig);
        }

        const dependencies = {
          database,
          explorerConfig,
          externalDataStore: new ExternalDataStore(database),
          logger,
          ...(providerManager ? { providerManager } : {}),
        };

        const ingestionService = new TransactionIngestionService(dependencies);

        try {
          // Parse options
          const since = options.since
            ? isNaN(options.since)
              ? new Date(options.since).getTime()
              : parseInt(options.since)
            : undefined;
          const until = options.until
            ? isNaN(options.until)
              ? new Date(options.until).getTime()
              : parseInt(options.until)
            : undefined;

          const importParams: {
            addresses?: string[] | undefined;
            csvDirectories?: string[] | undefined;
            providerId?: string | undefined;
            since?: number | undefined;
            until?: number | undefined;
          } = { since, until };

          // Validate parameters based on adapter type
          if (adapterType === 'exchange') {
            if (!options.csvDir) {
              logger.error('--csv-dir is required for exchange sources');
              process.exit(1);
            }
            importParams.csvDirectories = [options.csvDir];
          } else if (adapterType === 'blockchain') {
            if (!options.addresses) {
              logger.error('--addresses is required for blockchain sources');
              process.exit(1);
            }
            importParams.addresses = options.addresses;
            importParams.providerId = options.provider;
          }

          // Import raw data
          const importResult = await ingestionService.importFromSource(options.source, adapterType, importParams);

          logger.info(`Import completed: ${importResult.imported} items imported`);
          logger.info(`Session ID: ${importResult.importSessionId}`);

          // Process data if --process flag is provided
          if (options.process) {
            logger.info('Processing imported data to universal format');

            const processResult = await ingestionService.processAndStore(options.source, adapterType, {
              importSessionId: importResult.importSessionId,
            });

            logger.info(`Processing completed: ${processResult.processed} processed, ${processResult.failed} failed`);

            if (processResult.errors.length > 0) {
              logger.error('Processing errors:');
              processResult.errors.slice(0, 5).forEach(error => logger.error(`  ${error}`));
              if (processResult.errors.length > 5) {
                logger.error(`  ... and ${processResult.errors.length - 5} more errors`);
              }
            }
          }
        } finally {
          // Cleanup blockchain provider manager to stop background health checks
          if (providerManager) {
            providerManager.destroy();
          }
          await database.close();
        }

        // Exit successfully
        process.exit(0);
      } catch (error) {
        logger.error(`Import failed: ${error}`);
        process.exit(1);
      }
    });

  // Process command - new ETL workflow
  program
    .command('process')
    .description('Transform raw imported data to universal transaction format')
    .option('--source <name>', 'Source name (e.g., kraken, bitcoin, polkadot, bittensor)')
    .option('--session <id>', 'Import session ID to process')
    .option('--since <date>', 'Process data since date (YYYY-MM-DD or timestamp)')
    .option('--all', 'Process all pending raw data for this source')
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before processing')
    .action(async options => {
      try {
        // Validate required source parameter
        if (!options.source) {
          logger.error('--source is required. Examples: bitcoin, ethereum, polkadot, bittensor, kraken');
          process.exit(1);
        }

        logger.info(`Starting data processing from ${options.source} to universal format`);

        // Determine adapter type based on source name
        const adapterType = await determineSourceType(options.source);
        if (!adapterType) {
          logger.error(`Unknown source: ${options.source}. Source must be a valid blockchain or exchange adapter.`);
          process.exit(1);
        }

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        // Load explorer config for blockchain adapters
        const explorerConfig = loadExplorerConfig();

        // Create ingestion service with dependencies
        const { TransactionIngestionService } = await import(
          '@crypto/import/src/shared/ingestion/ingestion-service.ts'
        );
        const { ExternalDataStore } = await import('@crypto/import/src/shared/storage/external-data-store.ts');

        // Import blockchain dependencies conditionally
        let providerManager:
          | import('@crypto/import/src/blockchains/shared/blockchain-provider-manager.ts').BlockchainProviderManager
          | null = null;
        if (adapterType === 'blockchain') {
          const { BlockchainProviderManager } = await import(
            '@crypto/import/src/blockchains/shared/blockchain-provider-manager.ts'
          );
          providerManager = new BlockchainProviderManager(explorerConfig);
        }

        const dependencies = {
          database,
          explorerConfig,
          externalDataStore: new ExternalDataStore(database),
          logger,
          ...(providerManager ? { providerManager } : {}),
        };

        const ingestionService = new TransactionIngestionService(dependencies);

        try {
          // Parse filters
          const filters: { createdAfter?: number; importSessionId?: string } = {};

          if (options.session) {
            filters.importSessionId = options.session;
          }

          if (options.since) {
            const sinceTimestamp = isNaN(options.since) ? new Date(options.since).getTime() : parseInt(options.since);
            filters.createdAfter = Math.floor(sinceTimestamp / 1000); // Convert to seconds for database
          }

          const result = await ingestionService.processAndStore(options.source, adapterType, filters);

          logger.info(`Processing completed: ${result.processed} processed, ${result.failed} failed`);

          if (result.errors.length > 0) {
            logger.error('Processing errors:');
            result.errors.slice(0, 5).forEach(error => logger.error(`  ${error}`));
            if (result.errors.length > 5) {
              logger.error(`  ... and ${result.errors.length - 5} more errors`);
            }
          }
        } finally {
          // Cleanup blockchain provider manager to stop background health checks
          if (providerManager) {
            providerManager.destroy();
          }
          await database.close();
        }

        // Exit successfully
        process.exit(0);
      } catch (error) {
        logger.error(`Processing failed: ${error}`);
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
        .filter(c => Math.abs(c.calculatedBalance) > 0.00000001)
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
      const significantBalances = result.comparisons
        .filter(c => Math.abs(c.calculatedBalance) > 0.00000001 || Math.abs(c.liveBalance) > 0.00000001)
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
      const issues = result.comparisons.filter(c => c.status !== 'match').slice(0, 3);
      if (issues.length > 0) {
        logger.info('  Top issues:');
        for (const issue of issues) {
          logger.info(`    ${issue.currency}: ${issue.difference.toFixed(8)} (${issue.percentageDiff.toFixed(2)}%)`);
        }
      }
    }
  }
}

async function convertToCSV(transactions: StoredTransaction[]): Promise<string> {
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
      tx.exchange || '',
      tx.type || '',
      tx.timestamp || '',
      datetime,
      tx.amount || '',
      tx.amount_currency || '',
      tx.side || '',
      tx.price || '',
      tx.price_currency || '',
      tx.fee_cost || '',
      tx.fee_currency || '',
      cost,
      tx.status || '',
    ];

    // Escape values that contain commas
    const escapedValues = values.map(value => {
      const stringValue = String(value);
      return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
    });

    csvLines.push(escapedValues.join(','));
  }

  return csvLines.join('\n');
}

async function convertToJSON(transactions: StoredTransaction[]): Promise<string> {
  if (transactions.length === 0) return '[]';

  // Use normalized database columns and add calculated cost field
  const processedTransactions = transactions.map(tx => {
    // Calculate cost from amount * price if available
    let cost: number | null = null;
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
      exchange: tx.exchange,
      fee_cost: tx.fee_cost,
      fee_currency: tx.fee_currency,
      hash: tx.hash,
      id: tx.id,
      price: tx.price,
      price_currency: tx.price_currency,
      side: tx.side,
      status: tx.status,
      symbol: tx.symbol,
      timestamp: tx.timestamp,
      type: tx.type,
      verified: tx.verified,
    };
  });

  return JSON.stringify(processedTransactions, null, 2);
}

// Handle unhandled rejections
process.on('unhandledRejection', reason => {
  logger.error(`Unhandled Rejection: ${reason}`);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(`Stack: ${error.stack}`);
  process.exit(1);
});

main().catch(error => {
  logger.error(`CLI failed: ${error}`);
  process.exit(1);
});
