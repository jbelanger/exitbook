import type { IUniversalAdapter } from '@crypto/core';
import { Database, TransactionRepository, TransactionService, WalletRepository, WalletService } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import { type BlockchainExplorersConfig } from '@crypto/shared-utils';

import { UniversalAdapterFactory } from '../shared/adapters/adapter-factory.ts';
import type { BlockchainAdapterConfig } from '../shared/types/config.ts';
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
}
