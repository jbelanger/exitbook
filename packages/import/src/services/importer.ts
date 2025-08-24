import type {
  IUniversalAdapter,
  TransactionNote,
  UniversalAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from '@crypto/core';
import { Database, TransactionRepository, TransactionService, WalletRepository, WalletService } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import { type BlockchainExplorersConfig } from '@crypto/shared-utils';

import { UniversalAdapterFactory } from '../shared/adapters/adapter-factory.ts';
import type { BlockchainAdapterConfig } from '../shared/types/config.ts';
import type { ImportResult, ImportSummary } from '../shared/types/types.ts';
import { detectScamFromSymbol } from '../shared/utils/scam-detection.ts';
import { Deduplicator } from './deduplicator.ts';

interface BlockchainImportOptions {
  addresses: string[];
  blockchain: string;
  network?: string;
  since?: number;
}

export class TransactionImporter {
  private deduplicator: Deduplicator;

  private logger = getLogger('TransactionImporter');
  private transactionService: TransactionService;
  private walletService: WalletService;

  constructor(
    private readonly database: Database,
    private readonly explorerConfig: BlockchainExplorersConfig
  ) {
    this.database = database;
    const transactionRepository = new TransactionRepository(database);
    const walletRepository = new WalletRepository(database);
    this.transactionService = new TransactionService(transactionRepository, walletRepository);
    this.deduplicator = new Deduplicator();
    this.walletService = new WalletService(walletRepository);
  }

  /**
   * Enhance universal transaction with additional metadata
   */
  private enhanceUniversalTransaction(transaction: UniversalTransaction, sourceId: string): UniversalTransaction {
    // Detect scam tokens for blockchain transactions
    let scamNote: TransactionNote | undefined = undefined;
    const isBlockchainTransaction =
      sourceId.includes('mainnet') || ['ethereum', 'bitcoin', 'solana'].includes(sourceId);
    if (isBlockchainTransaction && transaction.symbol && transaction.type === 'deposit') {
      const scamCheck = detectScamFromSymbol(transaction.symbol);
      if (scamCheck.isScam) {
        scamNote = {
          message: `🚨 Scam token detected: ${scamCheck.reason} - Do not interact`,
          metadata: {
            amount: transaction.amount?.amount,
            blockchain: sourceId,
            isKnownScamPattern: true,
            scamReason: scamCheck.reason,
            tokenSymbol: transaction.symbol,
          },
          severity: 'error',
          type: 'SCAM_TOKEN',
        };
      }
    }

    return {
      ...transaction,
      metadata: {
        ...transaction.metadata,
        importedAt: Date.now(),
        note: scamNote,
        verified: false,
      },
      source: sourceId,
    };
  }

  /**
   * Ensure wallet address exists (helper method)
   */
  private async ensureWalletAddress(address: string, blockchain: string): Promise<void> {
    try {
      // Use the wallet service to create wallet address
      await this.walletService.createWalletAddressFromTransaction(address, blockchain, {
        addressType: 'personal',
        label: `${blockchain} wallet (auto-created)`,
        notes: `Auto-created during transaction import for ${blockchain}`,
      });
    } catch (error) {
      // Ignore errors if wallet already exists
      this.logger.debug(`Wallet for address ${address} may already exist: ${error}`);
    }
  }

  /**
   * Ensure wallet addresses exist for the given blockchain
   */
  private async ensureWalletAddresses(addresses: string[], blockchain: string): Promise<void> {
    if (!addresses?.length) return;

    this.logger.debug(`Creating wallet records for ${addresses.length} ${blockchain} addresses`);

    const createPromises = addresses.map(address =>
      this.walletService
        .createWalletAddressFromTransaction(address, blockchain, {
          addressType: 'personal',
          label: `${blockchain} wallet (CLI)`,
          notes: 'Added from CLI arguments',
        })
        .catch(error => {
          this.logger.debug(
            `Address ${address} may already exist: ${error instanceof Error ? error.message : String(error)}`
          );
        })
    );

    await Promise.allSettled(createPromises);
  }

  /**
   * Extract addresses from universal transaction
   */
  private extractUniversalTransactionAddresses(transaction: UniversalTransaction): {
    from: string | null;
    to: string | null;
  } {
    return {
      from: transaction.from || null,
      to: transaction.to || null,
    };
  }

  /**
   * Link universal transactions to wallet addresses
   */
  private async linkUniversalTransactionsToWallets(
    transactions: UniversalTransaction[],
    blockchain: string
  ): Promise<void> {
    this.logger.info(`Linking ${transactions.length} universal transactions to wallet addresses for ${blockchain}`);

    for (const transaction of transactions) {
      try {
        const { from: fromAddress, to: toAddress } = this.extractUniversalTransactionAddresses(transaction);

        if (!fromAddress && !toAddress) {
          continue;
        }

        // Find or create wallet for the addresses
        if (fromAddress) {
          await this.ensureWalletAddress(fromAddress, blockchain);
        }
        if (toAddress) {
          await this.ensureWalletAddress(toAddress, blockchain);
        }

        // Link transaction to wallets is handled in TransactionService.saveManyUniversal
      } catch (error) {
        this.logger.warn(
          `Failed to link transaction ${transaction.id} to wallets: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Process and save universal transactions directly without conversion
   */
  private async processAndSaveUniversalTransactions(
    transactions: UniversalTransaction[],
    sourceId: string
  ): Promise<{ duplicates: UniversalTransaction[]; saved: number }> {
    const enhancedTransactions = transactions.map(tx => this.enhanceUniversalTransaction(tx, sourceId));
    const { duplicates, unique } = await this.deduplicator.process(enhancedTransactions, sourceId);
    const saved = await this.transactionService.saveManyUniversal(unique);

    if (saved > 0 && sourceId !== 'exchange') {
      try {
        await this.linkUniversalTransactionsToWallets(unique, sourceId);
      } catch (linkError) {
        this.logger.warn(
          `Failed to link transactions to wallet addresses for ${sourceId}: ${linkError instanceof Error ? linkError.message : String(linkError)}`
        );
      }
    }

    return { duplicates, saved };
  }

  private async processBlockchainImports(
    adapters: Array<{ adapter: IUniversalAdapter }>,
    options: BlockchainImportOptions,
    startTime: number
  ): Promise<ImportSummary> {
    const sourceResults: ImportResult[] = [];
    let totalTransactions = 0;
    let totalNewTransactions = 0;
    let totalDuplicatesSkipped = 0;
    const allErrors: string[] = [];

    for (const { adapter } of adapters) {
      const adapterInfo = await adapter.getInfo();
      this.logger.info(`Starting import from ${adapterInfo.id}`);

      try {
        const result = await this.importFromAdapter(adapter, {
          addresses: options.addresses,
          since: options.since,
        });
        sourceResults.push(result);
        totalTransactions += result.transactions;
        totalNewTransactions += result.newTransactions;
        totalDuplicatesSkipped += result.duplicatesSkipped;
        allErrors.push(...result.errors);
      } catch (error) {
        const errorMessage = `Failed to import from ${adapterInfo.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        this.logger.error(errorMessage);
        allErrors.push(errorMessage);

        sourceResults.push({
          duplicatesSkipped: 0,
          duration: 0,
          errors: [errorMessage],
          newTransactions: 0,
          source: adapterInfo.id,
          transactions: 0,
        });
      } finally {
        try {
          await adapter.close();
        } catch (closeError) {
          this.logger.warn(`Failed to close adapter for ${adapterInfo.id}: ${closeError}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      duplicatesSkipped: totalDuplicatesSkipped,
      duration,
      errors: allErrors,
      newTransactions: totalNewTransactions,
      sourceResults,
      totalTransactions,
    };
  }

  async createBlockchainAdapters(options: BlockchainImportOptions): Promise<Array<{ adapter: IUniversalAdapter }>> {
    try {
      // Use the new universal approach
      const config: BlockchainAdapterConfig = {
        id: options.blockchain.toLowerCase(),
        network: options.network || 'mainnet',
        subType: 'rest',
        type: 'blockchain',
      };

      const adapter = await UniversalAdapterFactory.create(config, this.explorerConfig);

      this.logger.info(
        `Created universal blockchain adapter: ${options.blockchain} (addresses: ${options.addresses.length}, network: ${options.network || 'mainnet'})`
      );

      return [{ adapter }];
    } catch (error) {
      this.logger.error(
        `Failed to create blockchain adapter for ${options.blockchain}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  }

  /**
   * Universal adapter import method - unified interface for all adapter types
   */
  async importFromAdapter(adapter: IUniversalAdapter, params: UniversalFetchParams): Promise<ImportResult> {
    const startTime = Date.now();
    const info = await adapter.getInfo();
    this.logger.info(`Starting import from ${info.name} (${info.type})`);

    try {
      // Test connection first
      const isConnected = await adapter.testConnection();
      if (!isConnected) {
        throw new Error(`Failed to connect to ${info.name}`);
      }

      // Fetch transactions using unified interface
      const transactions = await adapter.fetchTransactions(params);

      // Save transactions using universal pipeline
      const { duplicates, saved } = await this.processAndSaveUniversalTransactions(transactions, info.id);

      const duration = Date.now() - startTime;

      const result: ImportResult = {
        duplicatesSkipped: duplicates.length,
        duration,
        errors: [],
        newTransactions: saved,
        source: info.id,
        transactions: transactions.length,
      };

      this.logger.info(
        `Completed import from ${info.name} - Transactions: ${transactions.length}, New: ${saved}, Duplicates: ${duplicates.length}, Duration: ${duration}ms`
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Import failed for ${info.name}: ${error} (duration: ${duration}ms)`);

      return {
        duplicatesSkipped: 0,
        duration,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        newTransactions: 0,
        source: info.id,
        transactions: 0,
      };
    } finally {
      await adapter.close();
    }
  }

  async importFromBlockchain(options: BlockchainImportOptions): Promise<ImportSummary> {
    const startTime = Date.now();
    this.logger.info('Starting transaction import from blockchain');

    try {
      await this.ensureWalletAddresses(options.addresses, options.blockchain);
      const adapters = await this.createBlockchainAdapters(options);
      const summary = await this.processBlockchainImports(adapters, options, startTime);

      this.logger.info(
        `Blockchain import completed for ${options.blockchain} - Total: ${summary.totalTransactions}, New: ${summary.newTransactions}, Duration: ${summary.duration}ms`
      );
      return summary;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Blockchain import failed: ${error instanceof Error ? error.message : 'Unknown error'} (duration: ${duration}ms)`
      );
      throw error;
    }
  }

  /**
   * Import from blockchain using universal interface
   */
  async importFromBlockchainUniversal(
    blockchain: string,
    addresses: string[],
    options: {
      includeTokens?: boolean;
      network?: string;
      since?: number;
      symbols?: string[];
    } = {}
  ): Promise<ImportResult> {
    const config: BlockchainAdapterConfig = {
      id: blockchain,
      network: options.network || 'mainnet',
      subType: 'rest',
      type: 'blockchain',
    };

    const adapter = await UniversalAdapterFactory.create(config, this.explorerConfig);
    return this.importFromAdapter(adapter, {
      addresses,
      includeTokens: options.includeTokens,
      since: options.since || Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days default
      symbols: options.symbols,
    });
  }

  /**
   * Import from exchange using universal interface
   */
  async importFromExchangeUniversal(
    exchangeId: string,
    adapterType: 'ccxt' | 'csv' | 'native',
    options: {
      credentials?:
        | {
            apiKey: string;
            password?: string | undefined;
            secret: string;
          }
        | undefined;
      csvDirectories?: string[] | undefined;
      since?: number | undefined;
      symbols?: string[] | undefined;
    }
  ): Promise<ImportResult> {
    const config: UniversalAdapterConfig = {
      credentials: options.credentials,
      csvDirectories: options.csvDirectories,
      id: exchangeId,
      subType: adapterType,
      type: 'exchange',
    };

    const adapter = await UniversalAdapterFactory.create(config);
    return this.importFromAdapter(adapter, {
      since: options.since, // No default - let adapter decide
      symbols: options.symbols,
    });
  }

  async importFromExchangeWithCredentials(options: {
    adapterType: 'ccxt' | 'csv' | 'native';
    credentials?: {
      apiKey: string;
      password?: string;
      sandbox?: boolean;
      secret: string;
    };
    csvDirectories?: string[];
    exchangeId: string;
    since?: number;
  }): Promise<ImportResult> {
    // Use the new universal approach
    return this.importFromExchangeUniversal(options.exchangeId, options.adapterType, {
      credentials: options.credentials,
      csvDirectories: options.csvDirectories,
      since: options.since,
    });
  }
}
