import type { CryptoTransaction, EnhancedTransaction, ExchangeConfig, IBlockchainAdapter, IExchangeAdapter, ImportResult, ImportSummary, TransactionNote } from '@crypto/core';
import { TransactionNoteType } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { Database, WalletService } from '@crypto/data';
import { BlockchainAdapterFactory } from '../adapters/blockchains/index.ts';
import { ExchangeAdapterFactory } from '../adapters/exchanges/adapter-factory.ts';
import { detectScamFromSymbol } from '../utils/scam-detection.ts';
import { Deduplicator } from './index.ts';


interface ExchangeImportOptions {
  exchangeFilter?: string;
  since?: number;
  configPath?: string;
  forceAdapterType?: 'ccxt' | 'native' | 'csv';
}

interface BlockchainImportOptions {
  blockchain: string;
  addresses: string[];
  since?: number;
  network?: string;
}

export class TransactionImporter {
  private logger = getLogger('TransactionImporter');
  private database: Database;
  private deduplicator: Deduplicator;
  private adapterFactory: ExchangeAdapterFactory;
  private blockchainAdapterFactory: BlockchainAdapterFactory;
  private walletService: WalletService;

  constructor(database: Database) {
    this.database = database;
    this.deduplicator = new Deduplicator();
    this.adapterFactory = new ExchangeAdapterFactory();
    this.blockchainAdapterFactory = new BlockchainAdapterFactory();
    this.walletService = new WalletService(database);
  }

  async importFromExchanges(options: ExchangeImportOptions = {}): Promise<ImportSummary> {
    const startTime = Date.now();
    this.logger.info('Starting transaction import from exchanges', options);

    try {
      const configuredExchanges = await this.getConfiguredExchanges(options);
      const sourceResults: ImportResult[] = [];
      let totalTransactions = 0;
      let totalNewTransactions = 0;
      let totalDuplicatesSkipped = 0;
      const allErrors: string[] = [];

      for (const { adapter, config } of configuredExchanges) {
        const exchangeInfo = await adapter.getExchangeInfo();

        this.logger.info(`Starting import from ${exchangeInfo.id}`);

        try {
          const result = await this.importFromExchange(adapter, config, options.since);
          sourceResults.push(result);
          totalTransactions += result.transactions;
          totalNewTransactions += result.newTransactions;
          totalDuplicatesSkipped += result.duplicatesSkipped;
          allErrors.push(...result.errors);
        } catch (error) {
          const errorMessage = `Failed to import from ${exchangeInfo.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          this.logger.error(errorMessage);
          allErrors.push(errorMessage);

          sourceResults.push({
            source: exchangeInfo.id,
            transactions: 0,
            newTransactions: 0,
            duplicatesSkipped: 0,
            errors: [errorMessage],
            duration: 0
          });
        } finally {
          // Always close the adapter
          try {
            await adapter.close();
          } catch (closeError) {
            this.logger.warn(`Failed to close adapter for ${exchangeInfo.id}`, { closeError });
          }
        }
      }

      const duration = Date.now() - startTime;

      const summary: ImportSummary = {
        totalTransactions,
        newTransactions: totalNewTransactions,
        duplicatesSkipped: totalDuplicatesSkipped,
        sourceResults,
        errors: allErrors,
        duration
      };

      this.logger.info('Import completed for all exchanges', {
        totalTransactions,
        newTransactions: totalNewTransactions,
        duration
      });

      return summary;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Import failed', { error: error instanceof Error ? error.message : 'Unknown error', duration });
      throw error;
    }
  }

  async importFromBlockchain(options: BlockchainImportOptions): Promise<ImportSummary> {
    const startTime = Date.now();
    this.logger.info('Starting transaction import from blockchain', options);

    try {
      // Create wallet records for CLI-provided addresses
      await this.ensureWalletAddresses(options.addresses, options.blockchain);

      const adapters = await this.createBlockchainAdapter(options);
      const sourceResults: ImportResult[] = [];
      let totalTransactions = 0;
      let totalNewTransactions = 0;
      let totalDuplicatesSkipped = 0;
      const allErrors: string[] = [];

      for (const { adapter } of adapters) {
        const blockchainInfo = await adapter.getBlockchainInfo();
        this.logger.info(`Starting import from ${blockchainInfo.id}`);

        try {
          const result = await this.importFromBlockchainAdapter(adapter, options.addresses, options.since);
          sourceResults.push(result);
          totalTransactions += result.transactions;
          totalNewTransactions += result.newTransactions;
          totalDuplicatesSkipped += result.duplicatesSkipped;
          allErrors.push(...result.errors);
        } catch (error) {
          const errorMessage = `Failed to import from ${blockchainInfo.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          this.logger.error(errorMessage);
          allErrors.push(errorMessage);

          sourceResults.push({
            source: blockchainInfo.id,
            transactions: 0,
            newTransactions: 0,
            duplicatesSkipped: 0,
            errors: [errorMessage],
            duration: 0
          });
        } finally {
          try {
            await adapter.close();
          } catch (closeError) {
            this.logger.warn(`Failed to close adapter for ${blockchainInfo.id}`, { closeError });
          }
        }
      }


      const duration = Date.now() - startTime;

      const summary: ImportSummary = {
        totalTransactions,
        newTransactions: totalNewTransactions,
        duplicatesSkipped: totalDuplicatesSkipped,
        sourceResults,
        errors: allErrors,
        duration
      };

      this.logger.info('Blockchain import completed', {
        blockchain: options.blockchain,
        totalTransactions,
        newTransactions: totalNewTransactions,
        duration
      });

      return summary;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Blockchain import failed', { error: error instanceof Error ? error.message : 'Unknown error', duration });
      throw error;
    }
  }

  async importFromBlockchainAdapter(adapter: IBlockchainAdapter, addresses: string[], since?: number): Promise<ImportResult> {
    const startTime = Date.now();
    const blockchainInfo = await adapter.getBlockchainInfo();
    const blockchainId = blockchainInfo.id;

    try {
      // Test connection first
      const isConnected = await adapter.testConnection();
      if (!isConnected) {
        throw new Error(`Failed to connect to ${blockchainId}`);
      }

      // Fetch transactions for each CLI-provided address
      const rawTransactions: CryptoTransaction[] = [];

      for (const address of addresses) {
        this.logger.debug(`Fetching transactions for address: ${address}`);
        const blockchainTxs = await adapter.getAddressTransactions(address, since);
        const cryptoTxs = blockchainTxs.map(tx => adapter.convertToCryptoTransaction(tx, address));
        rawTransactions.push(...cryptoTxs);
        this.logger.info(`Found ${blockchainTxs.length} transactions for address ${address}`);
      }

      this.logger.info(`Total ${rawTransactions.length} transactions fetched for all addresses`);

      // Transform to enhanced transactions
      const transactions = rawTransactions.map(tx => this.enhanceTransaction(tx, blockchainId));

      // Deduplicate transactions
      const { unique, duplicates } = await this.deduplicator.process(transactions, blockchainId);

      // Save new transactions to database
      const saved = await this.database.saveTransactions(unique);

      // Link transactions to wallet addresses after successful import
      if (saved > 0) {
        try {
          await this.linkTransactionsToWallets(unique, blockchainId);
        } catch (linkError) {
          this.logger.warn(`Failed to link transactions to wallet addresses for ${blockchainId}`, {
            error: linkError instanceof Error ? linkError.message : String(linkError)
          });
        }
      }

      const duration = Date.now() - startTime;

      const result: ImportResult = {
        source: blockchainId,
        transactions: transactions.length,
        newTransactions: saved,
        duplicatesSkipped: duplicates.length,
        errors: [],
        duration
      };

      this.logger.info(`Completed import from ${blockchainId}`, {
        transactions: transactions.length,
        newTransactions: saved,
        duplicatesSkipped: duplicates.length,
        duration
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Import failed for ${blockchainId}`, { error, duration });

      return {
        source: blockchainId,
        transactions: 0,
        newTransactions: 0,
        duplicatesSkipped: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        duration
      };
    }
  }

  async importFromExchange(adapter: IExchangeAdapter, exchangeConfig: ExchangeConfig, since?: number): Promise<ImportResult> {
    const startTime = Date.now();
    const exchangeInfo = await adapter.getExchangeInfo();
    const exchangeId = exchangeInfo.id;

    this.logger.info(`Starting import from ${exchangeId}`, { since });

    try {
      // Test connection first
      const isConnected = await adapter.testConnection();
      if (!isConnected) {
        throw new Error(`Failed to connect to ${exchangeId}`);
      }

      // Fetch all transactions using the adapter
      const rawTransactions = await adapter.fetchAllTransactions(since);

      // Transform to enhanced transactions
      const transactions = rawTransactions.map(tx => this.enhanceTransaction(tx, exchangeId));

      // Deduplicate transactions
      const { unique, duplicates } = await this.deduplicator.process(transactions, exchangeId);

      // Save new transactions to database
      const saved = await this.database.saveTransactions(unique);


      const duration = Date.now() - startTime;

      const result: ImportResult = {
        source: exchangeId,
        transactions: transactions.length,
        newTransactions: saved,
        duplicatesSkipped: duplicates.length,
        errors: [],
        duration
      };

      this.logger.info(`Completed import from ${exchangeId}`, {
        transactions: transactions.length,
        newTransactions: saved,
        duplicatesSkipped: duplicates.length,
        duration
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Import failed for ${exchangeId}`, { error, duration });

      return {
        source: exchangeId,
        transactions: 0,
        newTransactions: 0,
        duplicatesSkipped: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        duration
      };
    }
  }

  async getConfiguredExchanges(options: ExchangeImportOptions = {}): Promise<Array<{ adapter: IExchangeAdapter; config: ExchangeConfig }>> {
    const config = await this.loadConfiguration(options.configPath);
    const exchanges: Array<{ adapter: IExchangeAdapter; config: ExchangeConfig }> = [];

    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      const typedConfig = exchangeConfig as ExchangeConfig & { enabled: boolean };
      if (!typedConfig.enabled) {
        this.logger.debug(`Skipping disabled exchange: ${exchangeId}`);
        continue;
      }

      // Filter by exchange if specified
      if (options.exchangeFilter && exchangeId !== options.exchangeFilter) {
        continue;
      }

      try {
        // Determine adapter type first
        let adapterType: 'ccxt' | 'native' | 'csv' | undefined = typedConfig.adapterType as 'ccxt' | 'native' | 'csv';

        // Override with options if specified
        if (options.forceAdapterType) {
          adapterType = options.forceAdapterType;
        }

        // Resolve environment variables in credentials (skip for CSV adapters)
        const resolvedCredentials = (adapterType === 'csv')
          ? {}
          : this.resolveEnvironmentVariables(typedConfig.credentials);

        // Require adapterType in config
        if (!adapterType) {
          throw new Error(`adapterType is required in configuration for exchange: ${exchangeId}`);
        }

        const finalConfig: ExchangeConfig = {
          ...typedConfig,
          id: exchangeId,
          adapterType,
          credentials: resolvedCredentials
        };

        const adapter = await this.adapterFactory.createAdapter(finalConfig, undefined, this.database) as IExchangeAdapter;
        exchanges.push({ adapter, config: finalConfig });

        this.logger.info(`Configured exchange: ${exchangeId}`, {
          adapterType
        });
      } catch (error) {
        this.logger.error(`Failed to configure exchange ${exchangeId}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    if (exchanges.length === 0) {
      throw new Error('No exchanges configured or all exchanges failed to initialize');
    }

    return exchanges;
  }

  async createBlockchainAdapter(options: BlockchainImportOptions): Promise<Array<{ adapter: IBlockchainAdapter }>> {

    try {
      const adapter = await this.blockchainAdapterFactory.createBlockchainAdapter(options.blockchain.toLowerCase());

      this.logger.info(`Created blockchain adapter: ${options.blockchain}`, {
        adapterType: 'blockchain',
        addressCount: options.addresses.length,
        network: options.network || 'mainnet'
      });

      return [{ adapter }];
    } catch (error) {
      this.logger.error(`Failed to create blockchain adapter for ${options.blockchain}`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private enhanceTransaction(transaction: any, exchangeId: string): EnhancedTransaction {
    // Create a unique hash for deduplication
    const hash = this.createTransactionHash(transaction, exchangeId);

    // Detect scam tokens for blockchain transactions - ONLY flag obvious scam patterns
    let note: TransactionNote | undefined = undefined;
    const isBlockchainTransaction = exchangeId.includes('mainnet') || ['ethereum', 'bitcoin', 'solana'].includes(exchangeId);
    if (isBlockchainTransaction && transaction.symbol && transaction.type === 'deposit') {
      // Only check for direct scam patterns in token symbol (no airdrop detection)
      const scamCheck = detectScamFromSymbol(transaction.symbol);

      if (scamCheck.isScam) {
        note = {
          type: TransactionNoteType.SCAM_TOKEN,
          message: `🚨 Scam token detected: ${scamCheck.reason} - Do not interact`,
          severity: 'error' as const,
          metadata: {
            tokenSymbol: transaction.symbol,
            amount: transaction.amount?.amount,
            blockchain: exchangeId,
            scamReason: scamCheck.reason,
            isKnownScamPattern: true
          }
        };
      }
    }

    return {
      ...transaction,
      source: exchangeId,
      hash,
      importedAt: Date.now(),
      verified: false,
      originalData: transaction.info || transaction,
      note
    };
  }


  private createTransactionHash(transaction: any, exchangeId: string): string {
    // Create a hash from key transaction properties for deduplication
    const hashData = JSON.stringify({
      id: transaction.id,
      timestamp: transaction.timestamp,
      symbol: transaction.symbol,
      amount: transaction.amount,
      side: transaction.side,
      type: transaction.type,
      exchange: exchangeId
    });

    return crypto.createHash('sha256').update(hashData).digest('hex').slice(0, 16);
  }

  private resolveEnvironmentVariables(credentials: any): any {
    const resolved = { ...credentials };

    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'string' && value.startsWith('env:')) {
        const envVarName = value.substring(4); // Remove 'env:' prefix
        const envValue = process.env[envVarName];

        if (!envValue) {
          this.logger.warn(`Environment variable ${envVarName} not found for credential ${key}`);
          throw new Error(`Missing environment variable: ${envVarName}`);
        }

        resolved[key] = envValue;
        this.logger.debug(`Resolved ${key} from environment variable ${envVarName}`);
      }
    }

    return resolved;
  }

  private async loadConfiguration(configPath?: string): Promise<any> {
    const defaultPath = path.join(process.cwd(), 'config', 'exchanges.json');
    const finalPath = configPath || defaultPath;

    try {
      const configContent = await fs.promises.readFile(finalPath, 'utf8');
      return JSON.parse(configContent);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Create default configuration with new adapter types
        const defaultConfig = {
          exchanges: {
            kraken: {
              enabled: false,
              adapterType: 'ccxt',
              credentials: {
                apiKey: "env:KRAKEN_API_KEY",
                secret: "env:KRAKEN_SECRET"
              },
              options: {}
            },
            kucoin: {
              enabled: false,
              adapterType: 'native', // Use native adapter for KuCoin by default
              credentials: {
                apiKey: "env:KUCOIN_API_KEY",
                secret: "env:KUCOIN_SECRET",
                password: "env:KUCOIN_PASSPHRASE"
              },
              options: {}
            },
            coinbase: {
              enabled: false,
              adapterType: 'ccxt',
              credentials: {
                apiKey: "env:COINBASE_API_KEY",
                secret: "env:COINBASE_SECRET"
              },
              options: {}
            }
          }
        };

        // Ensure config directory exists
        await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });

        // Write default config
        await fs.promises.writeFile(finalPath, JSON.stringify(defaultConfig, null, 2));

        this.logger.info(`Created default configuration at ${finalPath}`);
        return defaultConfig;
      }

      throw new Error(`Failed to load configuration from ${finalPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Link transactions to wallet addresses by matching from/to addresses
   */
  private async linkTransactionsToWallets(transactions: EnhancedTransaction[], blockchain: string): Promise<void> {
    this.logger.info(`Linking ${transactions.length} transactions to wallet addresses for ${blockchain}`);

    for (const transaction of transactions) {
      try {
        // Extract from and to addresses from the transaction
        const { from: fromAddress, to: toAddress } = this.extractTransactionAddresses(transaction);

        if (!fromAddress && !toAddress) {
          continue; // Skip transactions without addresses
        }

        // Link transaction to wallet addresses (database method handles wallet lookup and internal transfer detection)
        await this.database.linkTransactionToWallets(
          transaction.id,
          fromAddress || undefined,
          toAddress || undefined
        );

      } catch (error) {
        this.logger.warn(`Failed to link transaction ${transaction.id} to wallets`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Extract transaction addresses from various data sources
   */
  private extractTransactionAddresses(transaction: EnhancedTransaction): { from: string | null; to: string | null } {
    const sources = [transaction.originalData, transaction.info];

    let from: string | null = null;
    let to: string | null = null;

    for (const source of sources) {
      if (source?.from && !from) from = source.from;
      if (source?.to && !to) to = source.to;
      if (from && to) break;
    }

    return { from, to };
  }

  /**
   * Ensure wallet addresses exist for the given blockchain
   */
  private async ensureWalletAddresses(addresses: string[], blockchain: string): Promise<void> {
    if (!addresses?.length) return;

    this.logger.info(`Creating wallet records for CLI-provided addresses`, {
      blockchain,
      addressCount: addresses.length
    });

    const createPromises = addresses.map(address =>
      this.walletService.createWalletAddressFromTransaction(address, blockchain, {
        label: `${blockchain} wallet (CLI)`,
        addressType: 'personal',
        notes: 'Added from CLI arguments'
      }).catch(error => {
        this.logger.debug(`Address ${address} may already exist`, {
          error: error instanceof Error ? error.message : String(error)
        });
      })
    );

    await Promise.allSettled(createPromises);
  }

}