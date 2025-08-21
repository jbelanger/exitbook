import type { CryptoTransaction, EnhancedTransaction, IBlockchainAdapter, IExchangeAdapter, TransactionNote } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import crypto from 'crypto';
import type { ExchangeConfig, ExchangeCredentials } from '../exchanges/types.ts';
import type { ImportResult, ImportSummary } from '../types.ts';
import { TransactionNoteType } from '../types.ts';
import { resolveEnvironmentVariables, type ExchangeConfiguration, type BlockchainExplorersConfig } from '@crypto/shared-utils';

import { Database, TransactionRepository, TransactionService, WalletRepository, WalletService } from '@crypto/data';

import { BlockchainAdapterFactory } from '../blockchains/shared/index.ts';
import { ExchangeAdapterFactory } from '../exchanges/adapter-factory.ts';
import { detectScamFromSymbol } from '../utils/scam-detection.ts';
import { Deduplicator } from './deduplicator.ts';

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
  private transactionService: TransactionService;
  private deduplicator: Deduplicator;
  private adapterFactory: ExchangeAdapterFactory;
  private blockchainAdapterFactory: BlockchainAdapterFactory;
  private walletService: WalletService;

  constructor(
    database: Database,
    private readonly exchangeConfig: ExchangeConfiguration,
    private readonly explorerConfig: BlockchainExplorersConfig
  ) {
    this.database = database;
    const transactionRepository = new TransactionRepository(database);
    const walletRepository = new WalletRepository(database);
    this.transactionService = new TransactionService(transactionRepository, walletRepository);
    this.deduplicator = new Deduplicator();
    this.adapterFactory = new ExchangeAdapterFactory();
    this.blockchainAdapterFactory = new BlockchainAdapterFactory();
    this.walletService = new WalletService(walletRepository);
  }

  async importFromExchanges(options: ExchangeImportOptions = {}): Promise<ImportSummary> {
    const startTime = Date.now();
    this.logger.info('Starting transaction import from exchanges');

    try {
      const configuredExchanges = await this.getConfiguredExchanges(options);
      const summary = await this.processExchangeImports(configuredExchanges, options.since, startTime);
      
      this.logger.info(`Import completed for all exchanges - Total: ${summary.totalTransactions}, New: ${summary.newTransactions}, Duration: ${summary.duration}ms`);
      return summary;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'} (duration: ${duration}ms)`);
      throw error;
    }
  }

  async importFromBlockchain(options: BlockchainImportOptions): Promise<ImportSummary> {
    const startTime = Date.now();
    this.logger.info('Starting transaction import from blockchain');

    try {
      await this.ensureWalletAddresses(options.addresses, options.blockchain);
      const adapters = await this.createBlockchainAdapters(options);
      const summary = await this.processBlockchainImports(adapters, options, startTime);
      
      this.logger.info(`Blockchain import completed for ${options.blockchain} - Total: ${summary.totalTransactions}, New: ${summary.newTransactions}, Duration: ${summary.duration}ms`);
      return summary;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Blockchain import failed: ${error instanceof Error ? error.message : 'Unknown error'} (duration: ${duration}ms)`);
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

      const rawTransactions = await this.fetchTransactionsForAddresses(adapter, addresses, since);

      const { transactions, saved, duplicates } = await this.processAndSaveTransactions(rawTransactions, blockchainId);

      const duration = Date.now() - startTime;

      const result: ImportResult = {
        source: blockchainId,
        transactions: transactions.length,
        newTransactions: saved,
        duplicatesSkipped: duplicates.length,
        errors: [],
        duration
      };

      this.logger.info(`Completed import from ${blockchainId} - Transactions: ${transactions.length}, New: ${saved}, Duplicates: ${duplicates.length}, Duration: ${duration}ms`);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Import failed for ${blockchainId}: ${error} (duration: ${duration}ms)`);

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

  async importFromExchange(adapter: IExchangeAdapter, since?: number): Promise<ImportResult> {
    const startTime = Date.now();
    const exchangeInfo = await adapter.getExchangeInfo();
    const exchangeId = exchangeInfo.id;

    this.logger.info(`Starting import from ${exchangeId} (since: ${since})`);

    try {
      // Test connection first
      const isConnected = await adapter.testConnection();
      if (!isConnected) {
        throw new Error(`Failed to connect to ${exchangeId}`);
      }

      // Fetch all transactions using the adapter
      const rawTransactions = await adapter.fetchAllTransactions(since);

      const { transactions, saved, duplicates } = await this.processAndSaveTransactions(rawTransactions, exchangeId);


      const duration = Date.now() - startTime;

      const result: ImportResult = {
        source: exchangeId,
        transactions: transactions.length,
        newTransactions: saved,
        duplicatesSkipped: duplicates.length,
        errors: [],
        duration
      };

      this.logger.info(`Completed import from ${exchangeId} - Transactions: ${transactions.length}, New: ${saved}, Duplicates: ${duplicates.length}, Duration: ${duration}ms`);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Import failed for ${exchangeId}: ${error} (duration: ${duration}ms)`);

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
    const config = this.exchangeConfig;
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
          ? typedConfig.credentials
          : resolveEnvironmentVariables(typedConfig.credentials);

        // Require adapterType in config
        if (!adapterType) {
          throw new Error(`adapterType is required in configuration for exchange: ${exchangeId}`);
        }

        const finalConfig: ExchangeConfig = {
          ...typedConfig,
          id: exchangeId,
          adapterType,
          credentials: resolvedCredentials as ExchangeCredentials
        };

        const adapter = await this.adapterFactory.createAdapter(finalConfig, undefined, this.database) as IExchangeAdapter;
        exchanges.push({ adapter, config: finalConfig });

        this.logger.info(`Configured exchange: ${exchangeId} (type: ${adapterType})`);
      } catch (error) {
        this.logger.error(`Failed to configure exchange ${exchangeId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (exchanges.length === 0) {
      throw new Error('No exchanges configured or all exchanges failed to initialize');
    }

    return exchanges;
  }

  async createBlockchainAdapters(options: BlockchainImportOptions): Promise<Array<{ adapter: IBlockchainAdapter }>> {
    try {
      const adapter = await this.blockchainAdapterFactory.createBlockchainAdapter(
        options.blockchain.toLowerCase(),
        this.explorerConfig
      );

      this.logger.info(`Created blockchain adapter: ${options.blockchain} (addresses: ${options.addresses.length}, network: ${options.network || 'mainnet'})`);

      return [{ adapter }];
    } catch (error) {
      this.logger.error(`Failed to create blockchain adapter for ${options.blockchain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async processExchangeImports(configuredExchanges: Array<{ adapter: IExchangeAdapter; config: ExchangeConfig }>, since: number | undefined, startTime: number): Promise<ImportSummary> {
    const sourceResults: ImportResult[] = [];
    let totalTransactions = 0;
    let totalNewTransactions = 0;
    let totalDuplicatesSkipped = 0;
    const allErrors: string[] = [];

    for (const { adapter } of configuredExchanges) {
      const exchangeInfo = await adapter.getExchangeInfo();
      this.logger.info(`Starting import from ${exchangeInfo.id}`);

      try {
        const result = await this.importFromExchange(adapter, since);
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
        try {
          await adapter.close();
        } catch (closeError) {
          this.logger.warn(`Failed to close adapter for ${exchangeInfo.id}: ${closeError}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      totalTransactions,
      newTransactions: totalNewTransactions,
      duplicatesSkipped: totalDuplicatesSkipped,
      sourceResults,
      errors: allErrors,
      duration
    };
  }

  private async processBlockchainImports(adapters: Array<{ adapter: IBlockchainAdapter }>, options: BlockchainImportOptions, startTime: number): Promise<ImportSummary> {
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
          this.logger.warn(`Failed to close adapter for ${blockchainInfo.id}: ${closeError}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      totalTransactions,
      newTransactions: totalNewTransactions,
      duplicatesSkipped: totalDuplicatesSkipped,
      sourceResults,
      errors: allErrors,
      duration
    };
  }

  private async fetchTransactionsForAddresses(adapter: IBlockchainAdapter, addresses: string[], since?: number): Promise<CryptoTransaction[]> {
    const rawTransactions: CryptoTransaction[] = [];

    for (const address of addresses) {
      this.logger.debug(`Fetching transactions for address: ${address}`);
      const blockchainTxs = await adapter.getAddressTransactions(address, since);
      const cryptoTxs = blockchainTxs.map(tx => adapter.convertToCryptoTransaction(tx, address));
      rawTransactions.push(...cryptoTxs);
      this.logger.debug(`Found ${blockchainTxs.length} transactions for ${address}`);
    }

    this.logger.debug(`Total ${rawTransactions.length} transactions fetched`);
    return rawTransactions;
  }

  private async processAndSaveTransactions(rawTransactions: CryptoTransaction[], sourceId: string): Promise<{ transactions: EnhancedTransaction[]; saved: number; duplicates: EnhancedTransaction[] }> {
    const transactions = rawTransactions.map(tx => this.enhanceTransaction(tx, sourceId));
    const { unique, duplicates } = await this.deduplicator.process(transactions, sourceId);
    const saved = await this.transactionService.saveMany(unique);

    if (saved > 0 && sourceId !== 'exchange') {
      try {
        await this.linkTransactionsToWallets(unique, sourceId);
      } catch (linkError) {
        this.logger.warn(`Failed to link transactions to wallet addresses for ${sourceId}: ${linkError instanceof Error ? linkError.message : String(linkError)}`);
      }
    }

    return { transactions, saved, duplicates };
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

        // Link transaction to wallet addresses
        await this.transactionService.linkTransactionToWallets(
          transaction.id,
          fromAddress || undefined,
          toAddress || undefined
        );

      } catch (error) {
        this.logger.warn(`Failed to link transaction ${transaction.id} to wallets: ${error instanceof Error ? error.message : String(error)}`);
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

    this.logger.debug(`Creating wallet records for ${addresses.length} ${blockchain} addresses`);

    const createPromises = addresses.map(address =>
      this.walletService.createWalletAddressFromTransaction(address, blockchain, {
        label: `${blockchain} wallet (CLI)`,
        addressType: 'personal',
        notes: 'Added from CLI arguments'
      }).catch(error => {
        this.logger.debug(`Address ${address} may already exist: ${error instanceof Error ? error.message : String(error)}`);
      })
    );

    await Promise.allSettled(createPromises);
  }

}