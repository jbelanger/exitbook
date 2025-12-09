import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ExchangeCredentials, ImportSession } from '@exitbook/core';
import type { AccountRepository, IImportSessionRepository, IRawDataRepository, UserRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { BlockchainAdapter } from '../infrastructure/blockchains/index.js';
import { getBlockchainAdapter } from '../infrastructure/blockchains/index.js';

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
   * Returns single ImportSession for regular addresses, array for xpub imports
   */
  async importBlockchain(
    blockchain: string,
    addressOrXpub: string,
    providerName?: string,
    xpubGap?: number
  ): Promise<Result<ImportSession | ImportSession[], Error>> {
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
  async importExchangeApi(exchange: string, credentials: ExchangeCredentials): Promise<Result<ImportSession, Error>> {
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
  async importExchangeCsv(exchange: string, csvDirectories: string[]): Promise<Result<ImportSession, Error>> {
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

    // 2. Find existing exchange-csv account for this exchange
    const existingAccountsResult = await this.accountRepository.findAll({
      accountType: 'exchange-csv',
      sourceName: exchange,
      userId: user.id,
    });

    if (existingAccountsResult.isErr()) {
      return err(existingAccountsResult.error);
    }

    const existingAccounts = existingAccountsResult.value;
    const existingAccount = existingAccounts.length > 0 ? existingAccounts[0] : undefined;

    let account;

    if (existingAccount) {
      // 3. Merge new directories with existing ones
      const existingDirs = existingAccount.identifier.split(',').filter((d) => d.length > 0);
      const dirSet = new Set([...existingDirs, ...csvDirectories]);
      const allDirectories = [...dirSet].sort();
      const mergedIdentifier = allDirectories.join(',');

      // Check if identifier needs updating (new directories were added)
      if (mergedIdentifier !== existingAccount.identifier) {
        this.logger.info(
          `Found existing account #${existingAccount.id}, adding ${csvDirectories.length} new directory(ies) to ${existingDirs.length} existing`
        );

        // Update the existing account's identifier directly
        // We can't use findOrCreate because the unique constraint on identifier would create a new account
        const updateResult = await this.accountRepository.updateIdentifier(existingAccount.id, mergedIdentifier);
        if (updateResult.isErr()) {
          return err(updateResult.error);
        }

        // Fetch the updated account
        const refreshedAccountResult = await this.accountRepository.findById(existingAccount.id);
        if (refreshedAccountResult.isErr()) {
          return err(refreshedAccountResult.error);
        }
        account = refreshedAccountResult.value;

        this.logger.info(
          `Updated account #${account.id} identifier with ${allDirectories.length} total directory(ies)`
        );
      } else {
        this.logger.info(
          `Found existing account #${existingAccount.id}, no new directories to add (already has ${existingDirs.length})`
        );
        account = existingAccount;
      }
    } else {
      // 4. Create new account
      const identifier = [...csvDirectories].sort().join(',');
      this.logger.info(`Creating new account for ${csvDirectories.length} CSV directory(ies)`);

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
      account = accountResult.value;
    }

    this.logger.info(`Using account #${account.id} (exchange-csv)`);

    // 5. Delegate to import service with account
    return this.importService.importFromSource(account);
  }

  /**
   * Import from xpub by creating parent + child accounts
   * Returns array of ImportSessions (one per derived address)
   */
  private async importFromXpub(
    userId: number,
    blockchain: string,
    xpub: string,
    blockchainAdapter: BlockchainAdapter | undefined,
    providerName?: string,
    xpubGap?: number
  ): Promise<Result<ImportSession[], Error>> {
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
        return ok([]);
      }

      // 3. Create child account for each derived address
      const childAccounts = [];
      for (const derived of derivedAddresses) {
        // Normalize derived address for consistent storage and comparison
        const normalizedDerivedResult = blockchainAdapter.normalizeAddress(derived.address);
        if (normalizedDerivedResult.isErr()) {
          this.logger.warn(
            `Skipping invalid derived address: ${derived.address} - ${normalizedDerivedResult.error.message}`
          );
          continue;
        }

        const childAccountResult = await this.accountRepository.findOrCreate({
          userId,
          parentAccountId: parentAccount.id,
          accountType: 'blockchain',
          sourceName: blockchain,
          identifier: normalizedDerivedResult.value,
          providerName,
          credentials: undefined,
        });

        if (childAccountResult.isErr()) {
          return err(childAccountResult.error);
        }

        childAccounts.push(childAccountResult.value);
      }

      this.logger.info(`Created ${childAccounts.length} child accounts`);

      // 4. Import each child account and collect ImportSessions
      const importSessions: ImportSession[] = [];
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

        importSessions.push(importResult.value);
      }

      // If no child imports succeeded, return an error
      if (importSessions.length === 0) {
        const errorSummary = errors.length > 0 ? errors.join('; ') : 'All child account imports failed';
        return err(new Error(`Xpub import failed: ${errorSummary}`));
      }

      // Calculate totals for logging
      const totalImported = importSessions.reduce((sum, s) => sum + s.transactionsImported, 0);
      const totalSkipped = importSessions.reduce((sum, s) => sum + s.transactionsSkipped, 0);

      this.logger.info(
        `Completed xpub import: ${totalImported} transactions from ${importSessions.length}/${childAccounts.length} addresses (${totalSkipped} duplicates skipped)`
      );

      return ok(importSessions);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
