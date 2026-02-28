import path from 'node:path';

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { type Account, type ExchangeCredentials, type ImportSession, wrapError } from '@exitbook/core';
import { type DataContext } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { ImportEvent } from '../../events.js';
import { AdapterRegistry } from '../../shared/types/adapter-registry.js';
import { isUtxoAdapter, type UtxoBlockchainAdapter } from '../../shared/types/blockchain-adapter.js';

import { StreamingImportRunner } from './streaming-import-runner.js';

/**
 * Public API for importing transactions from blockchains and exchanges.
 * Orchestrates the import process by coordinating user/account management
 * and delegating to StreamingImportRunner for the actual import work.
 *
 * Responsibilities:
 * - Ensure default CLI user exists (id=1)
 * - Find or create account for the import
 * - Delegate to StreamingImportRunner for streaming import execution
 */
export class ImportCoordinator {
  private readonly logger: Logger;
  private readonly streamingRunner: StreamingImportRunner;
  private readonly providerManager: BlockchainProviderManager;
  private readonly registry: AdapterRegistry;
  private readonly eventBus?: EventBus<ImportEvent> | undefined;

  constructor(
    private readonly db: DataContext,
    providerManager: BlockchainProviderManager,
    registry: AdapterRegistry,
    eventBus?: EventBus<ImportEvent>
  ) {
    this.logger = getLogger('ImportCoordinator');
    this.providerManager = providerManager;
    this.registry = registry;
    this.eventBus = eventBus;
    this.streamingRunner = new StreamingImportRunner(db, providerManager, registry, eventBus);
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
    const userResult = await this.db.users.getOrCreateDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Normalize address using blockchain-specific logic
    const normalizedBlockchain = blockchain.toLowerCase();
    const adapterResult = this.registry.getBlockchain(normalizedBlockchain);
    if (adapterResult.isErr()) {
      return err(adapterResult.error);
    }
    const blockchainAdapter = adapterResult.value;

    const normalizedAddressResult = blockchainAdapter.normalizeAddress(addressOrXpub);
    if (normalizedAddressResult.isErr()) {
      return err(normalizedAddressResult.error);
    }
    const normalizedAddress = normalizedAddressResult.value;

    // 3. Check if address is an extended public key (xpub)
    if (isUtxoAdapter(blockchainAdapter) && blockchainAdapter.isExtendedPublicKey(normalizedAddress)) {
      return this.importFromXpub(user.id, blockchain, normalizedAddress, blockchainAdapter, providerName, xpubGap);
    }

    // Warn if xpubGap was provided but address is not an xpub
    if (xpubGap !== undefined) {
      this.logger.warn(
        `--xpub-gap was provided but address is not an extended public key (xpub). The flag will be ignored.`
      );
    }

    // 4. Regular address: find or create account
    const accountResult = await this.db.accounts.findOrCreate({
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
    return this.streamingRunner.importFromSource(account);
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
    const userResult = await this.db.users.getOrCreateDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Find or create account (using apiKey as identifier)
    const accountResult = await this.db.accounts.findOrCreate({
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
    return this.streamingRunner.importFromSource(account);
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
    const normalizedPath = path.normalize(csvDirectory).replace(/[/\\]$/, '');

    // 1. Ensure default CLI user exists (id=1)
    const userResult = await this.db.users.getOrCreateDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Check if an account already exists for this exchange (regardless of directory)
    const existingAccountsResult = await this.db.accounts.findAll({
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
      return this.streamingRunner.importFromSource(existingAccount);
    }

    // 3. Create new account (use normalized path for consistency)
    const accountResult = await this.db.accounts.findOrCreate({
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
    return this.streamingRunner.importFromSource(account);
  }

  /**
   * Import from xpub by creating parent + child accounts
   * Returns array of ImportSessions (one per derived address)
   */
  private async importFromXpub(
    userId: number,
    blockchain: string,
    xpub: string,
    blockchainAdapter: UtxoBlockchainAdapter,
    providerName?: string,
    xpubGap?: number
  ): Promise<Result<ImportSession[], Error>> {
    const startTime = Date.now();
    const requestedGap = xpubGap ?? 20; // Default gap limit

    this.logger.debug(`Processing xpub import for ${blockchain}`);

    // 1. Create parent account
    const parentAccountResult = await this.db.accounts.findOrCreate({
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

    // Check if parent account already exists by looking for existing children or metadata
    // This is more robust than checking metadata alone (handles legacy accounts or interrupted imports)
    const existingChildrenResult = await this.db.accounts.findAll({ parentAccountId: parentAccount.id });
    const hasExistingChildren = existingChildrenResult.isOk() && existingChildrenResult.value.length > 0;
    const hasExistingMetadata = parentAccount.metadata?.xpub !== undefined;
    const parentAlreadyExists = hasExistingChildren || hasExistingMetadata;

    // 2. Check if we need to re-derive
    // Only re-derive if:
    // - No existing children (first import)
    // - Have metadata AND gap increased (explicit re-derivation request)
    const existingMetadata = parentAccount.metadata?.xpub;
    const shouldRederive = !hasExistingChildren || (existingMetadata && requestedGap > existingMetadata.gapLimit);

    let childAccounts: Account[];
    let newlyDerivedCount = 0;

    if (shouldRederive) {
      // 2a. Emit derivation started
      this.eventBus?.emit({
        type: 'xpub.derivation.started',
        parentAccountId: parentAccount.id,
        blockchain,
        gapLimit: requestedGap,
        isRederivation: Boolean(existingMetadata),
        parentIsNew: !parentAlreadyExists,
        previousGap: existingMetadata?.gapLimit,
      });

      // 2b. Derive addresses (opaque operation - may emit provider events)
      const derivedAddressesResult = await blockchainAdapter.deriveAddressesFromXpub(
        xpub,
        this.providerManager,
        blockchain,
        requestedGap
      );
      if (derivedAddressesResult.isErr()) {
        const durationMs = Date.now() - startTime;
        this.eventBus?.emit({
          type: 'xpub.derivation.failed',
          parentAccountId: parentAccount.id,
          error: derivedAddressesResult.error.message,
          durationMs,
        });
        return wrapError(derivedAddressesResult.error, 'Failed to derive addresses from xpub');
      }
      const derivedAddresses = derivedAddressesResult.value;

      const derivedCount = derivedAddresses.length;
      const derivationDuration = Date.now() - startTime;

      // 2c. Handle empty xpub
      if (derivedCount === 0) {
        this.eventBus?.emit({
          type: 'xpub.derivation.completed',
          parentAccountId: parentAccount.id,
          derivedCount: 0,
          durationMs: derivationDuration,
        });

        this.eventBus?.emit({
          type: 'xpub.empty',
          parentAccountId: parentAccount.id,
          blockchain,
        });

        return ok([]);
      }

      // 2d. Create child accounts for each derived address
      childAccounts = [];
      for (const derived of derivedAddresses) {
        const normalizedResult = blockchainAdapter.normalizeAddress(derived.address);
        if (normalizedResult.isErr()) {
          this.logger.warn(`Skipping invalid derived address: ${derived.address}`);
          continue;
        }

        const childResult = await this.db.accounts.findOrCreate({
          userId,
          parentAccountId: parentAccount.id,
          accountType: 'blockchain',
          sourceName: blockchain,
          identifier: normalizedResult.value,
          providerName,
          credentials: undefined,
        });

        if (childResult.isErr()) return err(childResult.error);
        childAccounts.push(childResult.value);
      }

      // Calculate newly derived count if re-derivation
      if (existingMetadata) {
        newlyDerivedCount = childAccounts.length - (existingMetadata.derivedCount ?? 0);
      }

      // 2e. Emit derivation completed
      this.eventBus?.emit({
        type: 'xpub.derivation.completed',
        parentAccountId: parentAccount.id,
        derivedCount: childAccounts.length,
        newCount: existingMetadata ? newlyDerivedCount : undefined,
        durationMs: derivationDuration,
      });

      // 2f. Update parent metadata
      await this.db.accounts.update(parentAccount.id, {
        metadata: {
          xpub: {
            gapLimit: requestedGap,
            lastDerivedAt: Date.now(),
            derivedCount: childAccounts.length,
          },
        },
      });

      this.logger.info(
        `Derived ${childAccounts.length} addresses` + (newlyDerivedCount > 0 ? ` (${newlyDerivedCount} new)` : '')
      );
    } else {
      // 2g. Reuse existing children
      const childrenResult = await this.db.accounts.findAll({ parentAccountId: parentAccount.id });
      if (childrenResult.isErr()) return err(childrenResult.error);

      childAccounts = childrenResult.value;
      this.logger.info(`Reusing ${childAccounts.length} existing child accounts`);
    }

    // 3. Emit xpub import started (must be before any child import.started)
    this.eventBus?.emit({
      type: 'xpub.import.started',
      parentAccountId: parentAccount.id,
      childAccountCount: childAccounts.length,
      blockchain,
      parentIsNew: !parentAlreadyExists,
    });

    // 4. Import each child account
    const importSessions: ImportSession[] = [];

    for (const childAccount of childAccounts) {
      this.logger.info(`Importing child account #${childAccount.id}`);

      const importResult = await this.streamingRunner.importFromSource(childAccount);

      if (importResult.isErr()) {
        // Any child failure = entire xpub import fails
        this.eventBus?.emit({
          type: 'xpub.import.failed',
          parentAccountId: parentAccount.id,
          failedChildAccountId: childAccount.id,
          error: importResult.error.message,
        });

        return err(new Error(`Failed to import child account #${childAccount.id}: ${importResult.error.message}`));
      }

      importSessions.push(importResult.value);
    }

    // 5. Calculate totals
    const totalImported = importSessions.reduce((sum, s) => sum + s.transactionsImported, 0);
    const totalSkipped = importSessions.reduce((sum, s) => sum + s.transactionsSkipped, 0);

    // 6. Emit xpub import completed
    this.eventBus?.emit({
      type: 'xpub.import.completed',
      parentAccountId: parentAccount.id,
      sessions: importSessions,
      totalImported,
      totalSkipped,
    });

    this.logger.info(`Completed xpub import: ${totalImported} transactions from ${importSessions.length} addresses`);

    return ok(importSessions);
  }
}
