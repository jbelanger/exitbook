#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import path from 'path';
import 'reflect-metadata';
import { fileURLToPath } from 'url';
import { getLogger } from '@crypto/shared-logger';
import { Database } from '@crypto/data';
import { BalanceVerifier } from '@crypto/shared-utils';
import { TransactionImporter } from '@crypto/import';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);

const logger = getLogger('CLI');
const program = new Command();

async function main() {
  program
    .name('crypto-import')
    .description('Crypto transaction import and verification tool using CCXT')
    .version('1.0.0');

  // Import command
  program
    .command('import')
    .description('Import transactions from configured exchanges or specific blockchain')
    .option('--exchange <name>', 'Import from specific exchange only')
    .option('--blockchain <name>', 'Import from specific blockchain (bitcoin, ethereum, injective)')
    .option('--addresses <addresses...>', 'Wallet addresses/xpubs for blockchain import (space-separated)')
    .option('--since <date>', 'Import transactions since date (YYYY-MM-DD)')
    .option('--verify', 'Run balance verification after import')
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before import')
    .action(async (options) => {
      try {
        logger.info('Starting transaction import', options);

        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          console.log('🗑️  Database cleared and reinitialized');
        }
        const importer = new TransactionImporter(database);

        let since: number | undefined;
        if (options.since) {
          since = new Date(options.since).getTime();
          if (isNaN(since)) {
            logger.error('Invalid date format. Use YYYY-MM-DD');
            process.exit(1);
          }
        }

        // Validate blockchain + addresses combination
        if (options.blockchain && !options.addresses) {
          logger.error('--addresses is required when using --blockchain');
          process.exit(1);
        }

        if (options.blockchain && options.exchange) {
          logger.error('Cannot use both --blockchain and --exchange options');
          process.exit(1);
        }

        let result;
        if (options.blockchain) {
          result = await importer.importFromBlockchain({
            blockchain: options.blockchain,
            addresses: options.addresses,
            since
          });
        } else {
          result = await importer.importFromExchanges({
            exchangeFilter: options.exchange,
            since,
            configPath: options.config
          });
        }

        // Display results
        console.log('\n🎉 Import completed!');
        console.log(`Total transactions: ${result.totalTransactions}`);
        console.log(`New transactions: ${result.newTransactions}`);
        console.log(`Duplicates skipped: ${result.duplicatesSkipped}`);
        console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

        if (result.errors.length > 0) {
          console.log('\n⚠️  Errors encountered:');
          result.errors.forEach((error: string) => console.log(`  - ${error}`));
        }

        // Run verification if requested
        if (options.verify) {
          console.log('\n🔍 Running balance verification...');
          const verifier = new BalanceVerifier(database);
          let adapters;
          if (options.blockchain) {
            const blockchainAdapters = await importer.createBlockchainAdapter({
              blockchain: options.blockchain,
              addresses: options.addresses
            });
            // Convert blockchain adapters to exchange adapters for verification
            adapters = blockchainAdapters.map((ba: any) => ba.adapter as any);
          } else {
            const configuredExchanges = await importer.getConfiguredExchanges({
              exchangeFilter: options.exchange
            });
            adapters = configuredExchanges.map((ex: any) => ex.adapter);
          }
          const verificationResults = await verifier.verifyAllExchanges(adapters);

          displayVerificationResults(verificationResults);
        }

        await database.close();
      } catch (error) {
        logger.error('Import failed', { error: error instanceof Error ? error.message : 'Unknown error' });
        process.exit(1);
      }
    });

  // Verify command
  program
    .command('verify')
    .description('Verify balances across exchanges or specific blockchain')
    .option('--exchange <name>', 'Verify specific exchange only')
    .option('--blockchain <name>', 'Verify specific blockchain (bitcoin, ethereum, injective)')
    .option('--addresses <addresses...>', 'Wallet addresses/xpubs for blockchain verification (space-separated)')
    .option('--report', 'Generate detailed verification report')
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before verify')
    .action(async (options) => {
      try {
        logger.info('Starting balance verification', options);

        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          console.log('🗑️  Database cleared and reinitialized');
        }
        const verifier = new BalanceVerifier(database);
        const importer = new TransactionImporter(database);

        // Validate blockchain + addresses combination
        if (options.blockchain && !options.addresses) {
          logger.error('--addresses is required when using --blockchain');
          process.exit(1);
        }

        if (options.blockchain && options.exchange) {
          logger.error('Cannot use both --blockchain and --exchange options');
          process.exit(1);
        }

        let adapters;
        if (options.blockchain) {
          const blockchainAdapters = await importer.createBlockchainAdapter({
            blockchain: options.blockchain,
            addresses: options.addresses
          });

          if (blockchainAdapters.length === 0) {
            logger.error(`Blockchain '${options.blockchain}' not supported or addresses invalid`);
            process.exit(1);
          }

          // Convert blockchain adapters to exchange adapters for verification
          adapters = blockchainAdapters.map((ba: any) => ba.adapter as any);
        } else {
          const configuredExchanges = await importer.getConfiguredExchanges({
            configPath: options.config,
            exchangeFilter: options.exchange
          });

          if (configuredExchanges.length === 0) {
            if (options.exchange) {
              logger.error(`Exchange '${options.exchange}' not found or not configured`);
            } else {
              logger.error('No exchanges configured');
            }
            process.exit(1);
          }

          adapters = configuredExchanges.map((ex: any) => ex.adapter);
        }
        const results = await verifier.verifyAllExchanges(adapters);

        displayVerificationResults(results);

        if (options.report) {
          const report = await verifier.generateReport(results);
          const reportPath = path.join(process.cwd(), 'data', 'verification-report.md');
          await import('fs').then(fs => fs.promises.writeFile(reportPath, report));
          console.log(`\n📊 Detailed report saved to: ${reportPath}`);
        }

        // Close all adapters
        for (const { adapter } of adapters) {
          try {
            await adapter.close();
          } catch (closeError) {
            logger.warn(`Failed to close adapter`, { closeError });
          }
        }

        await database.close();
      } catch (error) {
        logger.error('Verification failed', { error: error instanceof Error ? error.message : 'Unknown error' });
        process.exit(1);
      }
    });

  // Status command
  program
    .command('status')
    .description('Show system status and recent verification results')
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before status')
    .action(async (options) => {
      try {
        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          console.log('🗑️  Database cleared and reinitialized');
        }
        const stats = await database.getStats();

        console.log('\n📊 System Status');
        console.log('================');
        console.log(`Total transactions: ${stats.totalTransactions}`);
        console.log(`Total exchanges: ${stats.totalExchanges}`);
        console.log(`Total verifications: ${stats.totalVerifications}`);
        console.log(`Total snapshots: ${stats.totalSnapshots}`);

        if (stats.transactionsByExchange.length > 0) {
          console.log('\n📈 Transactions by Exchange:');
          for (const { exchange, count } of stats.transactionsByExchange) {
            console.log(`  ${exchange}: ${count}`);
          }
        }

        // Show recent verification results
        const latestVerifications = await database.getLatestBalanceVerifications();
        if (latestVerifications.length > 0) {
          console.log('\n🔍 Latest Balance Verifications:');
          const groupedByExchange = latestVerifications.reduce((acc, v) => {
            if (!acc[v.exchange]) acc[v.exchange] = [];
            acc[v.exchange]!.push(v);
            return acc;
          }, {} as Record<string, typeof latestVerifications>);

          for (const [exchange, verifications] of Object.entries(groupedByExchange)) {
            const matches = verifications.filter(v => v.status === 'match').length;
            const total = verifications.length;
            const status = matches === total ? '✅' : '⚠️';
            console.log(`  ${status} ${exchange}: ${matches}/${total} balances match`);
          }
        }

        await database.close();
      } catch (error) {
        logger.error('Status check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
        process.exit(1);
      }
    });

  // Export command
  program
    .command('export')
    .description('Export transactions to CSV or JSON')
    .option('--format <type>', 'Export format (csv|json)', 'csv')
    .option('--exchange <name>', 'Export from specific exchange only')
    .option('--since <date>', 'Export transactions since date (YYYY-MM-DD)')
    .option('--output <file>', 'Output file path')
    .option('--clear-db', 'Clear and reinitialize database before export')
    .action(async (options) => {
      try {
        logger.info('Starting export', options);

        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          console.log('🗑️  Database cleared and reinitialized');
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

        console.log(`\n💾 Exported ${transactions.length} transactions to: ${outputPath}`);

        await database.close();
      } catch (error) {
        logger.error('Export failed', { error: error instanceof Error ? error.message : 'Unknown error' });
        process.exit(1);
      }
    });

  // Test command
  program
    .command('test')
    .description('Test exchange connections or specific blockchain')
    .option('--exchange <name>', 'Test specific exchange only')
    .option('--blockchain <name>', 'Test specific blockchain (bitcoin, ethereum, injective)')
    .option('--addresses <addresses...>', 'Wallet addresses/xpubs for blockchain testing (space-separated)')
    .option('--config <path>', 'Path to configuration file')
    .option('--clear-db', 'Clear and reinitialize database before test')
    .action(async (options) => {
      try {
        logger.info('Testing exchange connections');

        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          console.log('🗑️  Database cleared and reinitialized');
        }
        const importer = new TransactionImporter(database);
        // Validate blockchain + addresses combination
        if (options.blockchain && !options.addresses) {
          logger.error('--addresses is required when using --blockchain');
          process.exit(1);
        }

        if (options.blockchain && options.exchange) {
          logger.error('Cannot use both --blockchain and --exchange options');
          process.exit(1);
        }

        let adapters;
        if (options.blockchain) {
          const blockchainAdapters = await importer.createBlockchainAdapter({
            blockchain: options.blockchain,
            addresses: options.addresses
          });
          adapters = blockchainAdapters.map((ba: any) => ({ adapter: ba.adapter as any }));
        } else {
          const configuredExchanges = await importer.getConfiguredExchanges({
            configPath: options.config,
            exchangeFilter: options.exchange
          });
          adapters = configuredExchanges;
        }

        console.log('\n🔗 Testing Connections');
        console.log('=================================');

        for (const { adapter } of adapters) {
          let connectionInfo;
          let isBlockchain = false;

          try {
            connectionInfo = await adapter.getExchangeInfo();
          } catch {
            // Try blockchain info if exchange info fails
            connectionInfo = await (adapter as any).getBlockchainInfo();
            isBlockchain = true;
          }

          process.stdout.write(`Testing ${connectionInfo.id}... `);

          const isConnected = await adapter.testConnection();
          console.log(isConnected ? '✅ Connected' : '❌ Failed');

          if (isConnected && connectionInfo.capabilities) {
            const capabilities = connectionInfo.capabilities;
            const capabilityList = Object.entries(capabilities).filter(([_, v]) => v).map(([k]) => k).join(', ');
            if (capabilityList) {
              console.log(`  Capabilities: ${capabilityList}`);
            }
          }
        }

        await database.close();
      } catch (error) {
        logger.error('Connection test failed', { error: error instanceof Error ? error.message : 'Unknown error' });
        process.exit(1);
      }
    });

  await program.parseAsync();
}

function displayVerificationResults(results: any[]): void {
  console.log('\n🔍 Balance Verification Results');
  console.log('================================');

  for (const result of results) {
    const statusIcon = result.status === 'success' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    console.log(`\n${statusIcon} ${result.exchange} - ${result.status.toUpperCase()}`);

    if (result.error) {
      console.log(`  Error: ${result.error}`);
      continue;
    }

    // Special handling for CSV adapters (indicated by note about CSV adapter)
    if (result.note && result.note.includes('CSV adapter')) {
      console.log(`  📊 Calculated Balances Summary (${result.summary.totalCurrencies} currencies)`);

      // Show all non-zero calculated balances for CSV adapters
      const significantBalances = result.comparisons
        .filter((c: any) => Math.abs(c.calculatedBalance) > 0.00000001)
        .sort((a: any, b: any) => Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance));

      if (significantBalances.length > 0) {
        console.log('  Current balances:');
        for (const balance of significantBalances.slice(0, 25)) { // Show top 25
          const formattedBalance = balance.calculatedBalance.toFixed(8).replace(/\.?0+$/, '');
          console.log(`    ${balance.currency}: ${formattedBalance}`);
        }

        if (significantBalances.length > 25) {
          console.log(`    ... and ${significantBalances.length - 25} more currencies`);
        }

        // Show zero balances count if any
        const zeroBalances = result.comparisons.length - significantBalances.length;
        if (zeroBalances > 0) {
          console.log(`  Zero balances: ${zeroBalances} currencies`);
        }
      } else {
        console.log('  No significant balances found');
      }

      console.log(`  Note: ${result.note}`);
    } else {
      // Standard live balance verification display
      console.log(`  Currencies: ${result.summary.totalCurrencies}`);
      console.log(`  Matches: ${result.summary.matches}`);
      console.log(`  Warnings: ${result.summary.warnings}`);
      console.log(`  Mismatches: ${result.summary.mismatches}`);

      // Show top issues
      const issues = result.comparisons.filter((c: any) => c.status !== 'match').slice(0, 3);
      if (issues.length > 0) {
        console.log('  Top issues:');
        for (const issue of issues) {
          console.log(`    ${issue.currency}: ${issue.difference.toFixed(8)} (${issue.percentageDiff.toFixed(2)}%)`);
        }
      }
    }
  }
}

async function convertToCSV(transactions: any[]): Promise<string> {
  if (transactions.length === 0) return '';

  const headers = [
    'id', 'exchange', 'type', 'timestamp', 'datetime', 'amount', 'amount_currency',
    'side', 'price', 'price_currency', 'fee_cost', 'fee_currency', 'cost', 'status'
  ];
  const csvLines = [headers.join(',')];

  for (const tx of transactions) {
    // Use normalized database columns instead of parsing raw_data

    // Calculate cost from amount * price if available
    let cost = '';
    if (tx.amount && tx.price) {
      try {
        const amountNum = parseFloat(tx.amount);
        const priceNum = parseFloat(tx.price);
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
      tx.status || ''
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

async function convertToJSON(transactions: any[]): Promise<string> {
  if (transactions.length === 0) return '[]';

  // Use normalized database columns and add calculated cost field
  const processedTransactions = transactions.map(tx => {
    // Calculate cost from amount * price if available
    let cost: number | null = null;
    if (tx.amount && tx.price) {
      try {
        const amountNum = parseFloat(tx.amount);
        const priceNum = parseFloat(tx.price);
        if (!isNaN(amountNum) && !isNaN(priceNum)) {
          cost = amountNum * priceNum;
        }
      } catch (e) {
        // Ignore calculation errors
      }
    }

    return {
      id: tx.id,
      exchange: tx.exchange,
      type: tx.type,
      timestamp: tx.timestamp,
      datetime: tx.datetime,
      symbol: tx.symbol,
      amount: tx.amount,
      amount_currency: tx.amount_currency,
      side: tx.side,
      price: tx.price,
      price_currency: tx.price_currency,
      fee_cost: tx.fee_cost,
      fee_currency: tx.fee_currency,
      cost: cost,
      status: tx.status,
      created_at: tx.created_at,
      hash: tx.hash,
      verified: tx.verified
    };
  });

  return JSON.stringify(processedTransactions, null, 2);
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

main().catch((error) => {
  logger.error('CLI failed', { error: error.message });
  process.exit(1);
}); 