import path from 'node:path';

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, ExchangeCredentials, ImportSession } from '@exitbook/core';
import type { AccountRepository, IImportSessionRepository, IRawDataRepository, UserRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { BlockchainAdapter } from '../../shared/types/blockchain-adapter.js';
import { getBlockchainAdapter } from '../../shared/types/blockchain-adapter.js';

import { ImportExecutor } from './import-service.js';

/**
 * Public API for importing transactions from blockchains and exchanges.
 * Orchestrates the import process by coordinating user/account management
 * and delegating to ImportExecutor for the actual import work.
 *
 * Responsibilities:
 * - Ensure default CLI user exists (id=1)
 * - Find or create account for the import
 * - Delegate to ImportExecutor for streaming import execution
 */
export class ImportOrchestrator {
  private logger: Logger;
  private importExecutor: ImportExecutor;
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
    this.importExecutor = new ImportExecutor(
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
    this.logger.debug(`Starting blockchain import for ${blockchain} (${addressOrXpub.substring(0, 20)}...)`);

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

    // 5. Delegate to import executor with account
    return this.importExecutor.importFromSource(account);
  }

  /**
   * Import transactions from an exchange using API credentials
   */
  async importExchangeApi(exchange: string, credentials: ExchangeCredentials): Promise<Result<ImportSession, Error>> {
    this.logger.debug(`Starting exchange API import for ${exchange}`);

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

    // 3. Delegate to import executor with account
    return this.importExecutor.importFromSource(account);
  }

  /**
   * Import transactions from an exchange using CSV files
   * The CSV directory can contain subdirectories - all CSV files are recursively scanned
   */
  async importExchangeCsv(exchange: string, csvDirectory: string): Promise<Result<ImportSession, Error>> {
    this.logger.debug(`Starting exchange CSV import for ${exchange} from ${csvDirectory}`);

    if (!csvDirectory) {
      return err(new Error('CSV directory is required for CSV imports'));
    }

    // Normalize path for consistent comparison and storage (remove trailing slashes, normalize separators)
    const normalizedPath = path.normalize(csvDirectory).replace(/[/\\]+$/, '');

    // 1. Ensure default CLI user exists (id=1)
    const userResult = await this.userRepository.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Check if an account already exists for this exchange (regardless of directory)
    const existingAccountsResult = await this.accountRepository.findAll({
      accountType: 'exchange-csv',
      sourceName: exchange,
      userId: user.id,
    });

    if (existingAccountsResult.isErr()) {
      return err(existingAccountsResult.error);
    }

    const existingAccounts = existingAccountsResult.value;

    // If an account exists with a different directory, reject
    if (existingAccounts.length > 0) {
      const existingAccount = existingAccounts[0]!;
      const normalizedExistingPath = path.normalize(existingAccount.identifier).replace(/[/\\]+$/, '');

      if (normalizedExistingPath !== normalizedPath) {
        return err(
          new Error(
            `An account already exists for ${exchange} using directory '${existingAccount.identifier}'. ` +
              `Please use the same directory (which can contain subdirectories) or delete the existing account first.`
          )
        );
      }
      // Same directory - use existing account
      this.logger.info(`Found existing account #${existingAccount.id}`);
      return this.importExecutor.importFromSource(existingAccount);
    }

    // 3. Create new account (use normalized path for consistency)
    const accountResult = await this.accountRepository.findOrCreate({
      userId: user.id,
      accountType: 'exchange-csv',
      sourceName: exchange,
      identifier: normalizedPath,
      providerName: undefined,
      credentials: undefined,
    });

    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    const account = accountResult.value;

    this.logger.info(`Created new account #${account.id} for import`);

    // 4. Delegate to import executor with account
    return this.importExecutor.importFromSource(account);
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

      this.logger.debug(`Processing xpub import for ${blockchain}`);

      // Detect whether the parent account already exists so we can log accurately
      const existingParentResult = await this.accountRepository.findByUniqueConstraint(
        'blockchain',
        blockchain,
        xpub,
        userId
      );
      if (existingParentResult.isErr()) {
        return err(existingParentResult.error);
      }
      const parentAlreadyExists = Boolean(existingParentResult.value);

      // Reuse existing derived child accounts when present to avoid redundant gap scans
      let existingChildAccounts: Account[] = [];
      if (parentAlreadyExists) {
        const childrenResult = await this.accountRepository.findByParent(existingParentResult.value!.id);
        if (childrenResult.isErr()) {
          return err(childrenResult.error);
        }
        existingChildAccounts = childrenResult.value;
      }

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

      this.logger.info(
        `${parentAlreadyExists ? 'Using existing' : 'Created new'} parent account #${parentAccount.id} for xpub`
      );

      // 2. Derive child addresses using provider manager for smart detection and gap scanning
      const derivedAddresses =
        existingChildAccounts.length > 0
          ? existingChildAccounts.map((account) => ({
              address: account.identifier,
              derivationPath: 'existing',
            }))
          : (() => {
              // Only derive when we have no cached children
              return blockchainAdapter.deriveAddressesFromXpub(xpub, this.providerManager, blockchain, xpubGap);
            })();

      // If we used existing children, derivedAddresses is already a resolved array
      const resolvedDerivedAddresses = await Promise.resolve(derivedAddresses);

      this.logger.info(
        existingChildAccounts.length > 0
          ? `Reusing ${existingChildAccounts.length} existing child accounts for xpub`
          : `Derived ${resolvedDerivedAddresses.length} addresses from xpub${xpubGap !== undefined ? ` (gap: ${xpubGap})` : ''}`
      );

      // Handle case where no active addresses were found
      if (resolvedDerivedAddresses.length === 0) {
        this.logger.info('No active addresses found for xpub - no transactions to import');
        return ok([]);
      }

      // 3. Create child account for each derived address
      const childAccounts = [];
      let newlyCreatedCount = 0;
      for (const derived of resolvedDerivedAddresses) {
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

        // Track whether this was newly created
        if (childAccountResult.value.createdAt === childAccountResult.value.updatedAt) {
          newlyCreatedCount += 1;
        }
      }

      if (newlyCreatedCount > 0) {
        this.logger.info(
          `Created ${newlyCreatedCount} child accounts${existingChildAccounts.length > 0 ? ` (reused ${existingChildAccounts.length})` : ''}`
        );
      } else {
        this.logger.info(`Reused ${existingChildAccounts.length} existing child accounts for xpub`);
      }

      // 4. Import each child account and collect ImportSessions
      const importSessions: ImportSession[] = [];
      const errors: string[] = [];

      for (const childAccount of childAccounts) {
        this.logger.info(
          `Importing child account #${childAccount.id} (${childAccount.identifier.substring(0, 20)}...)`
        );

        const importResult = await this.importExecutor.importFromSource(childAccount);

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

      // If any child import failed, do not allow partial processing
      if (errors.length > 0) {
        const errorSummary = errors.length === 1 ? errors[0] : `${errors[0]} (+${errors.length - 1} more)`;
        return err(
          new Error(
            `Xpub import incomplete: ${errors.length} child account(s) failed. ` + `First failure: ${errorSummary}`
          )
        );
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
