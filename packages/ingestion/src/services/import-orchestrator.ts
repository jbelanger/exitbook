import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ExchangeCredentials } from '@exitbook/core';
import type { AccountRepository, UserRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { getBlockchainAdapter } from '../infrastructure/blockchains/index.js';
import type { ImportResult } from '../types/importers.js';
import type { IImportSessionRepository, IRawDataRepository } from '../types/repositories.js';

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
  private providerManager: BlockchainProviderManager;

  constructor(
    private userRepository: UserRepository,
    private accountRepository: AccountRepository,
    rawDataRepository: IRawDataRepository,
    importSessionRepository: IImportSessionRepository,
    providerManager: BlockchainProviderManager
  ) {
    this.logger = getLogger('ImportOrchestrator');
    this.providerManager = providerManager;
    this.importService = new TransactionImportService(
      rawDataRepository,
      importSessionRepository,
      accountRepository,
      providerManager
    );
  }

  /**
   * Import transactions from a blockchain
   */
  async importBlockchain(
    blockchain: string,
    addressOrXpub: string,
    providerName?: string,
    xpubGap?: number
  ): Promise<Result<ImportResult, Error>> {
    this.logger.info(`Starting blockchain import for ${blockchain} (${addressOrXpub.substring(0, 20)}...)`);

    // 1. Ensure default CLI user exists (id=1)
    const userResult = await this.userRepository.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Normalize address using blockchain-specific logic
    const normalizedBlockchain = blockchain.toLowerCase();
    const blockchainAdapter = getBlockchainAdapter(normalizedBlockchain);
    if (!blockchainAdapter) {
      return err(new Error(`Unknown blockchain: ${blockchain}`));
    }

    const normalizedAddressResult = blockchainAdapter.normalizeAddress(addressOrXpub);
    if (normalizedAddressResult.isErr()) {
      return err(normalizedAddressResult.error);
    }
    const normalizedAddress = normalizedAddressResult.value;

    // 3. Check if address is an extended public key (xpub)
    const isXpub = blockchainAdapter.isExtendedPublicKey?.(normalizedAddress) ?? false;

    if (isXpub && blockchainAdapter.deriveAddressesFromXpub) {
      // Handle xpub: create parent account + child accounts for derived addresses
      return this.importFromXpub(user.id, blockchain, normalizedAddress, blockchainAdapter, providerName, xpubGap);
    }

    // Warn if xpubGap was provided but address is not an xpub
    if (xpubGap !== undefined && !isXpub) {
      this.logger.warn(
        `--xpub-gap was provided but address is not an extended public key (xpub). The flag will be ignored.`
      );
    }

    // 4. Regular address: find or create account
    const accountResult = await this.accountRepository.findOrCreate({
      userId: user.id,
      accountType: 'blockchain',
      sourceName: blockchain,
      identifier: normalizedAddress,
      providerName,
      credentials: undefined,
    });

    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    const account = accountResult.value;

    this.logger.info(`Using account #${account.id} (blockchain) for import`);

    // 5. Delegate to import service with account
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

  /**
   * Import from xpub by creating parent + child accounts
   */
  private async importFromXpub(
    userId: number,
    blockchain: string,
    xpub: string,
    blockchainAdapter: ReturnType<typeof getBlockchainAdapter>,
    providerName?: string,
    xpubGap?: number
  ): Promise<Result<ImportResult, Error>> {
    try {
      if (!blockchainAdapter?.deriveAddressesFromXpub) {
        return err(new Error(`Blockchain ${blockchain} does not support xpub derivation`));
      }

      this.logger.info(`Processing xpub import for ${blockchain}`);

      // 1. Create parent account for xpub
      const parentAccountResult = await this.accountRepository.findOrCreate({
        userId,
        accountType: 'blockchain',
        sourceName: blockchain,
        identifier: xpub,
        providerName,
        credentials: undefined,
      });

      if (parentAccountResult.isErr()) {
        return err(parentAccountResult.error);
      }
      const parentAccount = parentAccountResult.value;

      this.logger.info(`Created parent account #${parentAccount.id} for xpub`);

      // 2. Derive child addresses using provider manager for smart detection and gap scanning
      const derivedAddresses = await blockchainAdapter.deriveAddressesFromXpub(
        xpub,
        this.providerManager,
        blockchain,
        xpubGap
      );
      this.logger.info(
        `Derived ${derivedAddresses.length} addresses from xpub${xpubGap !== undefined ? ` (gap: ${xpubGap})` : ''}`
      );

      // Handle case where no active addresses were found
      if (derivedAddresses.length === 0) {
        this.logger.info('No active addresses found for xpub - no transactions to import');
        return ok({
          transactionsImported: 0,
          importSessionId: parentAccount.id,
        });
      }

      // 3. Create child account for each derived address
      const childAccounts = [];
      for (const derived of derivedAddresses) {
        const childAccountResult = await this.accountRepository.findOrCreate({
          userId,
          parentAccountId: parentAccount.id,
          accountType: 'blockchain',
          sourceName: blockchain,
          identifier: derived.address,
          providerName,
          credentials: undefined,
        });

        if (childAccountResult.isErr()) {
          return err(childAccountResult.error);
        }

        childAccounts.push(childAccountResult.value);
      }

      this.logger.info(`Created ${childAccounts.length} child accounts`);

      // 4. Import each child account and aggregate results
      let totalNewTransactions = 0;
      let lastDataSourceId = 0;
      let successfulImports = 0;
      const errors: string[] = [];

      for (const childAccount of childAccounts) {
        this.logger.info(
          `Importing child account #${childAccount.id} (${childAccount.identifier.substring(0, 20)}...)`
        );

        const importResult = await this.importService.importFromSource(childAccount);

        if (importResult.isErr()) {
          const errorMsg = `Account #${childAccount.id}: ${importResult.error.message}`;
          this.logger.warn(`Failed to import child account - ${errorMsg}`);
          errors.push(errorMsg);
          // Continue with other addresses even if one fails
          continue;
        }

        totalNewTransactions += importResult.value.transactionsImported;
        lastDataSourceId = importResult.value.importSessionId;
        successfulImports++;
      }

      // If no child imports succeeded, return an error
      if (successfulImports === 0) {
        const errorSummary = errors.length > 0 ? errors.join('; ') : 'All child account imports failed';
        return err(new Error(`Xpub import failed: ${errorSummary}`));
      }

      this.logger.info(
        `Completed xpub import: ${totalNewTransactions} transactions from ${successfulImports}/${childAccounts.length} addresses`
      );

      return ok({
        transactionsImported: totalNewTransactions,
        importSessionId: lastDataSourceId,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
