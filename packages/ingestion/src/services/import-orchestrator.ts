import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ExchangeCredentials } from '@exitbook/core';
import type { AccountRepository, UserRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

import type { ImportResult } from '../types/importers.js';
import type { IDataSourceRepository, IRawDataRepository } from '../types/repositories.js';

import { TransactionImportService } from './import-service.js';

/**
 * Orchestrates the import process by coordinating user/account management
 * and delegating to TransactionImportService for the actual import work.
 *
 * Responsibilities:
 * - Ensure default CLI user exists (id=1)
 * - Find or create account for the import
 * - Delegate to TransactionImportService
 */
export class ImportOrchestrator {
  private logger: Logger;
  private importService: TransactionImportService;

  constructor(
    private userRepository: UserRepository,
    private accountRepository: AccountRepository,
    rawDataRepository: IRawDataRepository,
    dataSourceRepository: IDataSourceRepository,
    providerManager: BlockchainProviderManager
  ) {
    this.logger = getLogger('ImportOrchestrator');
    this.importService = new TransactionImportService(
      rawDataRepository,
      dataSourceRepository,
      accountRepository,
      providerManager
    );
  }

  /**
   * Import transactions from a blockchain
   */
  async importBlockchain(
    blockchain: string,
    address: string,
    providerName?: string
  ): Promise<Result<ImportResult, Error>> {
    this.logger.info(`Starting blockchain import for ${blockchain} (${address})`);

    // 1. Ensure default CLI user exists (id=1)
    const userResult = await this.userRepository.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Find or create account
    const accountResult = await this.accountRepository.findOrCreate({
      userId: user.id,
      accountType: 'blockchain',
      sourceName: blockchain,
      identifier: address,
      providerName,
      credentials: undefined,
    });

    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    const account = accountResult.value;

    this.logger.info(`Using account #${account.id} (blockchain) for import`);

    // 3. Delegate to import service with account
    return this.importService.importFromSource(account);
  }

  /**
   * Import transactions from an exchange using API credentials
   */
  async importExchangeApi(exchange: string, credentials: ExchangeCredentials): Promise<Result<ImportResult, Error>> {
    this.logger.info(`Starting exchange API import for ${exchange}`);

    if (!credentials.apiKey) {
      return err(new Error('API key is required for exchange API imports'));
    }

    // 1. Ensure default CLI user exists (id=1)
    const userResult = await this.userRepository.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Find or create account (using apiKey as identifier)
    const accountResult = await this.accountRepository.findOrCreate({
      userId: user.id,
      accountType: 'exchange-api',
      sourceName: exchange,
      identifier: credentials.apiKey,
      providerName: undefined,
      credentials,
    });

    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    const account = accountResult.value;

    this.logger.info(`Using account #${account.id} (exchange-api) for import`);

    // 3. Delegate to import service with account
    return this.importService.importFromSource(account);
  }

  /**
   * Import transactions from an exchange using CSV files
   */
  async importExchangeCsv(exchange: string, csvDirectories: string[]): Promise<Result<ImportResult, Error>> {
    this.logger.info(`Starting exchange CSV import for ${exchange}`);

    if (!csvDirectories || csvDirectories.length === 0) {
      return err(new Error('At least one CSV directory is required for CSV imports'));
    }

    // 1. Ensure default CLI user exists (id=1)
    const userResult = await this.userRepository.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Create stable identifier from sorted directories
    const identifier = [...csvDirectories].sort().join(',');

    // 3. Find or create account
    const accountResult = await this.accountRepository.findOrCreate({
      userId: user.id,
      accountType: 'exchange-csv',
      sourceName: exchange,
      identifier,
      providerName: undefined,
      credentials: undefined,
    });

    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    const account = accountResult.value;

    this.logger.info(`Using account #${account.id} (exchange-csv) for import`);

    // 4. Delegate to import service with account
    return this.importService.importFromSource(account);
  }
}
