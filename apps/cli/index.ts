#!/usr/bin/env node
import {
  BalanceVerifier,
  BlockchainBalanceService,
  ExchangeBalanceService,
  type BalanceVerificationResult,
} from "@crypto/balance";
import type { IUniversalAdapter, UniversalAdapterInfo } from "@crypto/core";
import {
  Database,
  BalanceRepository,
  BalanceService,
  type StoredTransaction,
} from "@crypto/data";
import {
  TransactionImporter,
  UniversalAdapterFactory,
  type ImportResult,
  type ImportSummary,
} from "@crypto/import";
import { getLogger } from "@crypto/shared-logger";
import { initializeDatabase, loadExplorerConfig } from "@crypto/shared-utils";
import { Command } from "commander";
import path from "path";
import "reflect-metadata";

const logger = getLogger("CLI");
const program = new Command();

async function main() {
  program
    .name("crypto-import")
    .description("Crypto transaction import and verification tool using CCXT")
    .version("1.0.0");

  // Import command
  program
    .command("import")
    .description(
      "Import transactions from configured exchanges or specific blockchain"
    )
    .option("--exchange <name>", "Import from specific exchange only")
    .option(
      "--adapter-type <type>",
      "Exchange adapter type (ccxt, csv, native)",
      "ccxt"
    )
    .option("--api-key <key>", "Exchange API key (for CCXT adapters)")
    .option("--secret <secret>", "Exchange API secret (for CCXT adapters)")
    .option(
      "--password <password>",
      "Exchange API password/passphrase (for CCXT adapters)"
    )
    .option(
      "--csv-directories <paths...>",
      "CSV directories (for CSV adapters, space-separated)"
    )
    .option("--sandbox", "Use sandbox/testnet mode")
    .option(
      "--blockchain <name>",
      "Import from specific blockchain (bitcoin, ethereum, injective)"
    )
    .option(
      "--addresses <addresses...>",
      "Wallet addresses/xpubs for blockchain import (space-separated)"
    )
    .option(
      "--since <date>",
      "Import transactions since date (YYYY-MM-DD, timestamp, or 0 for all history)"
    )
    .option("--verify", "Run balance verification after import")
    .option("--config <path>", "Path to configuration file")
    .option("--clear-db", "Clear and reinitialize database before import")
    .action(async options => {
      try {
        logger.info("Starting transaction import");

        // Load configurations using shared config utils
        const explorerConfig = loadExplorerConfig();

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        // Create importer with minimal dependencies
        const importer = new TransactionImporter(database, explorerConfig);

        let since: number | undefined;
        if (options.since) {
          // Support multiple since formats:
          // 1. Numeric timestamp: "0", "1609459200000"
          // 2. Date string: "2003-01-01", "2021-01-01"
          const sinceStr = options.since.toString();

          if (/^\d+$/.test(sinceStr)) {
            // Pure numeric value - treat as timestamp
            since = parseInt(sinceStr, 10);
            if (since === 0) {
              // Special case: 0 means get all history (don't set since parameter)
              since = undefined;
            }
          } else {
            // Date string format
            since = new Date(sinceStr).getTime();
            if (isNaN(since)) {
              logger.error(
                "Invalid date format. Use YYYY-MM-DD, timestamp, or 0 for all history"
              );
              process.exit(1);
            }
          }
        }

        // Validate blockchain + addresses combination
        if (options.blockchain && !options.addresses) {
          logger.error("--addresses is required when using --blockchain");
          process.exit(1);
        }

        if (options.blockchain && options.exchange) {
          logger.error("Cannot use both --blockchain and --exchange options");
          process.exit(1);
        }

        // Validate exchange parameters
        if (options.exchange) {
          if (
            options.adapterType === "ccxt" ||
            options.adapterType === "native"
          ) {
            if (!options.apiKey || !options.secret) {
              logger.error(
                "--api-key and --secret are required for CCXT and native adapters"
              );
              process.exit(1);
            }
            if (
              options.exchange === "coinbase" &&
              options.adapterType === "ccxt" &&
              !options.password
            ) {
              logger.error("--password is required for Coinbase CCXT adapter");
              process.exit(1);
            }
          } else if (options.adapterType === "csv") {
            if (
              !options.csvDirectories ||
              options.csvDirectories.length === 0
            ) {
              logger.error("--csv-directories is required for CSV adapters");
              process.exit(1);
            }
          }
        }

        let result: ImportSummary | ImportResult;
        if (options.blockchain) {
          result = await importer.importFromBlockchain({
            blockchain: options.blockchain,
            addresses: options.addresses,
            ...(since !== undefined && { since }),
          });
        } else if (options.exchange) {
          // Create adapter directly with provided credentials
          result = await importer.importFromExchangeWithCredentials({
            exchangeId: options.exchange,
            adapterType: options.adapterType,
            ...((options.adapterType === "ccxt" ||
              options.adapterType === "native") && {
              credentials: {
                apiKey: options.apiKey,
                secret: options.secret,
                password: options.password,
                sandbox: options.sandbox,
              },
            }),
            csvDirectories: options.csvDirectories,
            ...(since !== undefined && { since }),
          });
        } else {
          logger.error("Either --exchange or --blockchain must be specified");
          process.exit(1);
        }

        // Display results
        const totalTxns =
          "totalTransactions" in result
            ? result.totalTransactions
            : result.transactions;
        logger.info(
          `Import completed - Total: ${totalTxns}, New: ${result.newTransactions}, Duplicates: ${result.duplicatesSkipped}, Duration: ${(result.duration / 1000).toFixed(1)}s`
        );
        if (result.errors.length > 0) {
          logger.warn(
            `Errors encountered during import: ${result.errors.length} errors`
          );
          result.errors.forEach((error: string, index: number) => {
            logger.warn(`Error ${index + 1}: ${error}`);
          });
        }

        // Run verification if requested
        if (options.verify) {
          logger.info("Running balance verification");
          const balanceRepository = new BalanceRepository(database);
          const balanceService = new BalanceService(balanceRepository);
          const verifier = new BalanceVerifier(balanceService);
          let balanceServices: (
            | BlockchainBalanceService
            | ExchangeBalanceService
          )[];
          if (options.blockchain) {
            const blockchainAdapters = await importer.createBlockchainAdapters({
              blockchain: options.blockchain,
              addresses: options.addresses,
            });
            // Create blockchain balance services
            balanceServices = await Promise.all(
              blockchainAdapters.map(
                async (ba: { adapter: IUniversalAdapter }) => {
                  const service = new BlockchainBalanceService(
                    ba.adapter,
                    options.addresses
                  );
                  await service.initialize();
                  return service;
                }
              )
            );
          } else {
            // For exchange verification after import, we need to recreate the adapter
            if (!options.exchange) {
              logger.error("Exchange verification requires --exchange option");
              process.exit(1);
            }
            // Note: For verification after import, we would need credentials or config
            logger.warn(
              "Exchange balance verification after import is not yet implemented"
            );
            balanceServices = [];
          }
          const verificationResults =
            await verifier.verifyAllServices(balanceServices);

          displayVerificationResults(verificationResults);
        }

        await database.close();
      } catch (error) {
        logger.error(`Import failed: ${error}`);
        process.exit(1);
      }
    });

  // Verify command
  program
    .command("verify")
    .description("Verify balances across exchanges or specific blockchain")
    .option("--exchange <name>", "Verify specific exchange only")
    .option(
      "--adapter-type <type>",
      "Exchange adapter type (ccxt, csv, native)",
      "ccxt"
    )
    .option("--api-key <key>", "Exchange API key (for CCXT adapters)")
    .option("--secret <secret>", "Exchange API secret (for CCXT adapters)")
    .option(
      "--password <password>",
      "Exchange API password/passphrase (for CCXT adapters)"
    )
    .option(
      "--csv-directories <paths...>",
      "CSV directories (for CSV adapters, space-separated)"
    )
    .option("--sandbox", "Use sandbox/testnet mode")
    .option(
      "--blockchain <name>",
      "Verify specific blockchain (bitcoin, ethereum, injective)"
    )
    .option(
      "--addresses <addresses...>",
      "Wallet addresses/xpubs for blockchain verification (space-separated)"
    )
    .option("--report", "Generate detailed verification report")
    .option("--config <path>", "Path to configuration file")
    .option("--clear-db", "Clear and reinitialize database before verify")
    .action(async options => {
      try {
        logger.info("Starting balance verification");

        // Load configurations using shared config utils
        const explorerConfig = loadExplorerConfig();

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        const balanceRepository = new BalanceRepository(database);
        const balanceService = new BalanceService(balanceRepository);
        const verifier = new BalanceVerifier(balanceService);
        const importer = new TransactionImporter(database, explorerConfig);

        // Validate blockchain + addresses combination
        if (options.blockchain && !options.addresses) {
          logger.error("--addresses is required when using --blockchain");
          process.exit(1);
        }

        if (options.blockchain && options.exchange) {
          logger.error("Cannot use both --blockchain and --exchange options");
          process.exit(1);
        }

        // Validate exchange parameters
        if (options.exchange) {
          if (
            options.adapterType === "ccxt" ||
            options.adapterType === "native"
          ) {
            if (!options.apiKey || !options.secret) {
              logger.error(
                "--api-key and --secret are required for CCXT and native adapters"
              );
              process.exit(1);
            }
            if (
              options.exchange === "coinbase" &&
              options.adapterType === "ccxt" &&
              !options.password
            ) {
              logger.error("--password is required for Coinbase CCXT adapter");
              process.exit(1);
            }
          } else if (options.adapterType === "csv") {
            if (
              !options.csvDirectories ||
              options.csvDirectories.length === 0
            ) {
              logger.error("--csv-directories is required for CSV adapters");
              process.exit(1);
            }
          }
        }

        let balanceServices: (
          | BlockchainBalanceService
          | ExchangeBalanceService
        )[];
        if (options.blockchain) {
          const blockchainAdapters = await importer.createBlockchainAdapters({
            blockchain: options.blockchain,
            addresses: options.addresses,
          });

          if (blockchainAdapters.length === 0) {
            logger.error(
              `Blockchain '${options.blockchain}' not supported or addresses invalid`
            );
            process.exit(1);
          }

          // Create blockchain balance services
          balanceServices = await Promise.all(
            blockchainAdapters.map(
              async (ba: { adapter: IUniversalAdapter }) => {
                const service = new BlockchainBalanceService(
                  ba.adapter,
                  options.addresses
                );
                await service.initialize();
                return service;
              }
            )
          );
        } else if (options.exchange) {
          // Create exchange adapter with provided credentials using UniversalAdapterFactory
          const adapter = await UniversalAdapterFactory.create({
            type: "exchange",
            id: options.exchange,
            subType: options.adapterType as "ccxt" | "csv" | "native",
            credentials:
              options.adapterType === "ccxt" || options.adapterType === "native"
                ? {
                    apiKey: options.apiKey,
                    secret: options.secret,
                    password: options.password,
                  }
                : undefined,
            csvDirectories: options.csvDirectories,
          });

          // Create exchange balance service
          const exchangeService = new ExchangeBalanceService(adapter);
          await exchangeService.initialize();
          balanceServices = [exchangeService];
        } else {
          logger.error("Either --exchange or --blockchain must be specified");
          process.exit(1);
        }
        const results = await verifier.verifyAllServices(balanceServices);

        displayVerificationResults(results);

        if (options.report) {
          const report = await verifier.generateReport(results);
          const reportPath = path.join(
            process.cwd(),
            "data",
            "verification-report.md"
          );
          await import("fs").then(fs =>
            fs.promises.writeFile(reportPath, report)
          );
          logger.info(`Verification report generated: ${reportPath}`);
        }

        // Close all services
        for (const service of balanceServices) {
          try {
            await service.close();
          } catch (closeError) {
            logger.warn(`Failed to close service: ${closeError}`);
          }
        }

        await database.close();
      } catch (error) {
        logger.error(`Verification failed: ${error}`);
        process.exit(1);
      }
    });

  // Status command
  program
    .command("status")
    .description("Show system status and recent verification results")
    .option("--config <path>", "Path to configuration file")
    .option("--clear-db", "Clear and reinitialize database before status")
    .action(async options => {
      try {
        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          logger.info("Database cleared and reinitialized");
        }
        const stats = await database.getStats();

        logger.info("\nSystem Status");
        logger.info("================");
        logger.info(`Total transactions: ${stats.totalTransactions}`);
        logger.info(`Total exchanges: ${stats.totalExchanges}`);
        logger.info(`Total verifications: ${stats.totalVerifications}`);
        logger.info(`Total snapshots: ${stats.totalSnapshots}`);

        if (stats.transactionsByExchange.length > 0) {
          logger.info("\n📈 Transactions by Exchange:");
          for (const { exchange, count } of stats.transactionsByExchange) {
            logger.info(`  ${exchange}: ${count}`);
          }
        }

        // Show recent verification results
        const latestVerifications =
          await database.getLatestBalanceVerifications();
        if (latestVerifications.length > 0) {
          logger.info("\n🔍 Latest Balance Verifications:");
          const groupedByExchange = latestVerifications.reduce(
            (acc, v) => {
              if (!acc[v.exchange]) acc[v.exchange] = [];
              acc[v.exchange]!.push(v);
              return acc;
            },
            {} as Record<string, typeof latestVerifications>
          );

          for (const [exchange, verifications] of Object.entries(
            groupedByExchange
          )) {
            const matches = verifications.filter(
              v => v.status === "match"
            ).length;
            const total = verifications.length;
            const status = matches === total ? "✅" : "⚠️";
            logger.info(
              `  ${status} ${exchange}: ${matches}/${total} balances match`
            );
          }
        }

        await database.close();
      } catch (error) {
        logger.error(`Status check failed: ${error}`);
        process.exit(1);
      }
    });

  // Export command
  program
    .command("export")
    .description("Export transactions to CSV or JSON")
    .option("--format <type>", "Export format (csv|json)", "csv")
    .option("--exchange <name>", "Export from specific exchange only")
    .option(
      "--since <date>",
      "Export transactions since date (YYYY-MM-DD, timestamp, or 0 for all history)"
    )
    .option("--output <file>", "Output file path")
    .option("--clear-db", "Clear and reinitialize database before export")
    .action(async options => {
      try {
        logger.info("Starting export");

        const database = new Database();
        if (options.clearDb) {
          await database.clearAndReinitialize();
          logger.info("Database cleared and reinitialized");
        }

        let since: number | undefined;
        if (options.since) {
          since = new Date(options.since).getTime();
          if (isNaN(since)) {
            logger.error("Invalid date format. Use YYYY-MM-DD");
            process.exit(1);
          }
        }

        const transactions = await database.getTransactions(
          options.exchange,
          since
        );

        const outputPath =
          options.output ||
          path.join(process.cwd(), "data", `transactions.${options.format}`);

        if (options.format === "csv") {
          const csv = await convertToCSV(transactions);
          await import("fs").then(fs => fs.promises.writeFile(outputPath, csv));
        } else {
          const json = await convertToJSON(transactions);
          await import("fs").then(fs =>
            fs.promises.writeFile(outputPath, json)
          );
        }

        logger.info(
          `\n💾 Exported ${transactions.length} transactions to: ${outputPath}`
        );

        await database.close();
      } catch (error) {
        logger.error(`Export failed: ${error}`);
        process.exit(1);
      }
    });

  // Test command
  program
    .command("test")
    .description("Test exchange connections or specific blockchain")
    .option("--exchange <name>", "Test specific exchange only")
    .option(
      "--adapter-type <type>",
      "Exchange adapter type (ccxt, csv, native)",
      "ccxt"
    )
    .option("--api-key <key>", "Exchange API key (for CCXT adapters)")
    .option("--secret <secret>", "Exchange API secret (for CCXT adapters)")
    .option(
      "--password <password>",
      "Exchange API password/passphrase (for CCXT adapters)"
    )
    .option(
      "--csv-directories <paths...>",
      "CSV directories (for CSV adapters, space-separated)"
    )
    .option("--sandbox", "Use sandbox/testnet mode")
    .option(
      "--blockchain <name>",
      "Test specific blockchain (bitcoin, ethereum, injective)"
    )
    .option(
      "--addresses <addresses...>",
      "Wallet addresses/xpubs for blockchain testing (space-separated)"
    )
    .option("--config <path>", "Path to configuration file")
    .option("--clear-db", "Clear and reinitialize database before test")
    .action(async options => {
      try {
        logger.info("Testing exchange connections");

        // Load configurations using shared config utils
        const explorerConfig = loadExplorerConfig();

        // Initialize database
        const database = await initializeDatabase(options.clearDb);

        const importer = new TransactionImporter(database, explorerConfig);
        // Validate blockchain + addresses combination
        if (options.blockchain && !options.addresses) {
          logger.error("--addresses is required when using --blockchain");
          process.exit(1);
        }

        if (options.blockchain && options.exchange) {
          logger.error("Cannot use both --blockchain and --exchange options");
          process.exit(1);
        }

        // Validate exchange parameters
        if (options.exchange) {
          if (
            options.adapterType === "ccxt" ||
            options.adapterType === "native"
          ) {
            if (!options.apiKey || !options.secret) {
              logger.error(
                "--api-key and --secret are required for CCXT and native adapters"
              );
              process.exit(1);
            }
            if (
              options.exchange === "coinbase" &&
              options.adapterType === "ccxt" &&
              !options.password
            ) {
              logger.error("--password is required for Coinbase CCXT adapter");
              process.exit(1);
            }
          } else if (options.adapterType === "csv") {
            if (
              !options.csvDirectories ||
              options.csvDirectories.length === 0
            ) {
              logger.error("--csv-directories is required for CSV adapters");
              process.exit(1);
            }
          }
        }

        let adapters: { adapter: IUniversalAdapter }[];
        if (options.blockchain) {
          const blockchainAdapters = await importer.createBlockchainAdapters({
            blockchain: options.blockchain,
            addresses: options.addresses,
          });
          adapters = blockchainAdapters.map(
            (ba: { adapter: IUniversalAdapter }) => ({ adapter: ba.adapter })
          );
        } else if (options.exchange) {
          // Create exchange adapter with provided credentials using UniversalAdapterFactory
          const adapter = await UniversalAdapterFactory.create({
            type: "exchange",
            id: options.exchange,
            subType: options.adapterType as "ccxt" | "csv" | "native",
            credentials:
              options.adapterType === "ccxt" || options.adapterType === "native"
                ? {
                    apiKey: options.apiKey,
                    secret: options.secret,
                    password: options.password,
                  }
                : undefined,
            csvDirectories: options.csvDirectories,
          });
          adapters = [{ adapter }];
        } else {
          logger.error("Either --exchange or --blockchain must be specified");
          process.exit(1);
        }

        logger.info(`Testing connections for ${adapters.length} adapters`);
        logger.info("\nTesting Connections");
        logger.info("=================================");

        for (const { adapter } of adapters) {
          let connectionInfo: UniversalAdapterInfo;

          try {
            connectionInfo = await adapter.getInfo();
          } catch (error) {
            // Fallback to a basic info structure if getInfo fails
            connectionInfo = {
              id: "unknown-adapter",
              name: "Unknown Adapter",
              type: "exchange" as const,
              capabilities: {
                supportedOperations: [],
                maxBatchSize: 1,
                supportsHistoricalData: false,
                supportsPagination: false,
                requiresApiKey: false,
              },
            };
          }

          process.stdout.write(`Testing ${connectionInfo.id}... `);

          const isConnected = await adapter.testConnection();
          logger.info(
            `Connection test result for ${connectionInfo.id}: ${isConnected ? "Connected" : "Failed"}`
          );
          logger.info(isConnected ? "Connected" : "Failed");

          if (isConnected && connectionInfo.capabilities) {
            const capabilities = connectionInfo.capabilities;
            const capabilityList = Object.entries(capabilities)
              .filter(([_, v]) => v)
              .map(([k]) => k)
              .join(", ");
            if (capabilityList) {
              logger.debug(
                `Adapter capabilities for ${connectionInfo.id}: ${capabilityList}`
              );
              logger.info(`  Capabilities: ${capabilityList}`);
            }
          }
        }

        await database.close();
      } catch (error) {
        logger.error(`Connection test failed: ${error}`);
        process.exit(1);
      }
    });

  await program.parseAsync();
}

function displayVerificationResults(
  results: BalanceVerificationResult[]
): void {
  const logger = getLogger("CLI");
  logger.info("\nBalance Verification Results");
  logger.info("================================");

  for (const result of results) {
    logger.info(`\n${result.exchange} - ${result.status.toUpperCase()}`);

    if (result.error) {
      logger.error(`  Error: ${result.error}`);
      continue;
    }

    // Special handling for CSV adapters (indicated by note about CSV adapter)
    if (result.note && result.note.includes("CSV adapter")) {
      logger.info(
        `  Calculated Balances Summary (${result.summary.totalCurrencies} currencies)`
      );

      // Show all non-zero calculated balances for CSV adapters
      const significantBalances = result.comparisons
        .filter(c => Math.abs(c.calculatedBalance) > 0.00000001)
        .sort(
          (a, b) =>
            Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance)
        );

      if (significantBalances.length > 0) {
        logger.info("  Current balances:");
        for (const balance of significantBalances.slice(0, 25)) {
          // Show top 25
          const formattedBalance = balance.calculatedBalance
            .toFixed(8)
            .replace(/\.?0+$/, "");
          logger.info(`    ${balance.currency}: ${formattedBalance}`);
        }

        if (significantBalances.length > 25) {
          logger.info(
            `    ... and ${significantBalances.length - 25} more currencies`
          );
        }

        // Show zero balances count if any
        const zeroBalances =
          result.comparisons.length - significantBalances.length;
        if (zeroBalances > 0) {
          logger.info(`  Zero balances: ${zeroBalances} currencies`);
        }
      } else {
        logger.info("  No significant balances found");
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
        .filter(
          c =>
            Math.abs(c.calculatedBalance) > 0.00000001 ||
            Math.abs(c.liveBalance) > 0.00000001
        )
        .sort(
          (a, b) =>
            Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance)
        )
        .slice(0, 10); // Show top 10

      if (significantBalances.length > 0) {
        logger.info("  Calculated vs Live Balances:");
        for (const balance of significantBalances) {
          const calc = balance.calculatedBalance
            .toFixed(8)
            .replace(/\.?0+$/, "");
          const live = balance.liveBalance.toFixed(8).replace(/\.?0+$/, "");
          const status =
            balance.status === "match"
              ? "✓"
              : balance.status === "warning"
                ? "⚠"
                : "✗";
          logger.info(
            `    ${balance.currency}: ${calc} (calc) | ${live} (live) ${status}`
          );
        }
      }

      // Show top issues
      const issues = result.comparisons
        .filter(c => c.status !== "match")
        .slice(0, 3);
      if (issues.length > 0) {
        logger.info("  Top issues:");
        for (const issue of issues) {
          logger.info(
            `    ${issue.currency}: ${issue.difference.toFixed(8)} (${issue.percentageDiff.toFixed(2)}%)`
          );
        }
      }
    }
  }
}

async function convertToCSV(
  transactions: StoredTransaction[]
): Promise<string> {
  if (transactions.length === 0) return "";

  const headers = [
    "id",
    "exchange",
    "type",
    "timestamp",
    "datetime",
    "amount",
    "amount_currency",
    "side",
    "price",
    "price_currency",
    "fee_cost",
    "fee_currency",
    "cost",
    "status",
  ];
  const csvLines = [headers.join(",")];

  for (const tx of transactions) {
    // Use normalized database columns instead of parsing raw_data

    // Calculate cost from amount * price if available
    let cost = "";
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
    const datetime =
      tx.datetime || (tx.timestamp ? new Date(tx.timestamp).toISOString() : "");

    const values = [
      tx.id || "",
      tx.exchange || "",
      tx.type || "",
      tx.timestamp || "",
      datetime,
      tx.amount || "",
      tx.amount_currency || "",
      tx.side || "",
      tx.price || "",
      tx.price_currency || "",
      tx.fee_cost || "",
      tx.fee_currency || "",
      cost,
      tx.status || "",
    ];

    // Escape values that contain commas
    const escapedValues = values.map(value => {
      const stringValue = String(value);
      return stringValue.includes(",") ? `"${stringValue}"` : stringValue;
    });

    csvLines.push(escapedValues.join(","));
  }

  return csvLines.join("\n");
}

async function convertToJSON(
  transactions: StoredTransaction[]
): Promise<string> {
  if (transactions.length === 0) return "[]";

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
      verified: tx.verified,
    };
  });

  return JSON.stringify(processedTransactions, null, 2);
}

// Handle unhandled rejections
process.on("unhandledRejection", reason => {
  logger.error(`Unhandled Rejection: ${reason}`);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", error => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(`Stack: ${error.stack}`);
  process.exit(1);
});

main().catch(error => {
  logger.error(`CLI failed: ${error}`);
  process.exit(1);
});
