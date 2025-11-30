/**
 * Integration tests for xpub/HD wallet import with parent-child account relationships
 *
 * Tests the full import flow from orchestrator through import service to verify:
 * - Parent account creation for xpub
 * - Child account creation for derived addresses
 * - Cursor handling per child account
 * - Resume functionality (second import fetches 0 new transactions)
 */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { AccountRepository, UserRepository } from '@exitbook/data';
import { ok, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataSourceRepository } from '../../../persistence/data-source-repository.js';
import { RawDataRepository } from '../../../persistence/raw-data-repository.js';
import { ImportOrchestrator } from '../../../services/import-orchestrator.js';

// Mock logger
vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock blockchain provider manager (not used in these tests)
const mockProviderManager = {} as BlockchainProviderManager;

// Mock derive addresses function
const mockDeriveAddresses = vi.fn();

// Mock import streaming function
const mockImportStreamingFn = vi.fn();

// Mock blockchain configs
vi.mock('../index.js', () => ({
  getBlockchainAdapter: (id: string) => {
    if (id === 'bitcoin') {
      return {
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        isExtendedPublicKey: (addr: string) => addr.startsWith('xpub') || addr.startsWith('ypub'),
        deriveAddressesFromXpub: mockDeriveAddresses,
        createImporter: () => ({
          importStreaming: mockImportStreamingFn,
        }),
      };
    }
    if (id === 'cardano') {
      return {
        normalizeAddress: (addr: string) => ok(addr),
        isExtendedPublicKey: (addr: string) => addr.startsWith('stake') || addr.startsWith('addr_xvk'),
        deriveAddressesFromXpub: mockDeriveAddresses,
        createImporter: () => ({
          importStreaming: mockImportStreamingFn,
        }),
      };
    }
    return;
  },
}));

describe('xpub import integration tests', () => {
  let db: KyselyDB;
  let orchestrator: ImportOrchestrator;
  let userRepo: UserRepository;
  let accountRepo: AccountRepository;
  let rawDataRepo: RawDataRepository;
  let dataSourceRepo: DataSourceRepository;

  beforeEach(async () => {
    // Create in-memory database
    db = createDatabase(':memory:');
    await runMigrations(db);

    // Create repositories
    userRepo = new UserRepository(db);
    accountRepo = new AccountRepository(db);
    rawDataRepo = new RawDataRepository(db);
    dataSourceRepo = new DataSourceRepository(db);

    // Create orchestrator
    orchestrator = new ImportOrchestrator(userRepo, accountRepo, rawDataRepo, dataSourceRepo, mockProviderManager);

    // Reset mocks
    mockDeriveAddresses.mockReset();
    mockImportStreamingFn.mockReset();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('Bitcoin xpub import with resume', () => {
    const xpub =
      'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';
    const derivedAddress1 = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const derivedAddress2 = 'bc1q9ejr4fhqzfxjm4q8h95jqxqxqxqxqxqxqxqxqx';

    it('should create parent account and child accounts for Bitcoin xpub', async () => {
      // Mock derive addresses
      mockDeriveAddresses.mockResolvedValue([
        { address: derivedAddress1, derivationPath: "m/84'/0'/0'/0/0" },
        { address: derivedAddress2, derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      // Mock import streaming to return transactions
      mockImportStreamingFn.mockImplementation(async function* () {
        yield okAsync({
          rawTransactions: [
            {
              providerName: 'test-provider',
              externalId: 'tx1',
              rawData: { txid: 'tx1', blockHeight: 100 },
              normalizedData: { id: 'tx1', blockHeight: 100 },
            },
            {
              providerName: 'test-provider',
              externalId: 'tx2',
              rawData: { txid: 'tx2', blockHeight: 101 },
              normalizedData: { id: 'tx2', blockHeight: 101 },
            },
          ],
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 101 },
            lastTransactionId: 'tx2',
            totalFetched: 2,
          } as CursorState,
          isComplete: true,
        });
      });

      // First import
      const result = await orchestrator.importBlockchain('bitcoin', xpub);

      if (result.isErr()) {
        console.error('Import failed:', result.error.message);
      }

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(4); // 2 addresses * 2 txs each
      }

      // Verify parent account was created
      const allAccounts = await db.selectFrom('accounts').selectAll().execute();
      const parentAccount = allAccounts.find((a) => a.identifier === xpub.toLowerCase());
      expect(parentAccount).toBeDefined();
      expect(parentAccount?.parent_account_id).toBeNull();

      // Verify child accounts were created with parent reference
      const childAccounts = allAccounts.filter((a) => a.parent_account_id === parentAccount?.id);
      expect(childAccounts).toHaveLength(2);

      const child1 = childAccounts.find((a) => a.identifier === derivedAddress1);
      const child2 = childAccounts.find((a) => a.identifier === derivedAddress2);

      expect(child1).toBeDefined();
      expect(child1?.parent_account_id).toBe(parentAccount?.id);
      expect(child2).toBeDefined();
      expect(child2?.parent_account_id).toBe(parentAccount?.id);
    });

    it('should maintain separate cursors for each child account', async () => {
      mockDeriveAddresses.mockResolvedValue([
        { address: derivedAddress1, derivationPath: "m/84'/0'/0'/0/0" },
        { address: derivedAddress2, derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      let callCount = 0;
      mockImportStreamingFn.mockImplementation(async function* () {
        callCount++;
        const txCount = callCount === 1 ? 5 : 3; // First child: 5 txs, second child: 3 txs

        yield okAsync({
          rawTransactions: Array.from({ length: txCount }, (_, i) => ({
            providerName: 'test-provider',
            externalId: `tx-child${callCount}-${i}`,
            rawData: { txid: `tx-child${callCount}-${i}`, blockHeight: 100 + i },
            normalizedData: { id: `tx-child${callCount}-${i}`, blockHeight: 100 + i },
          })),
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 100 + txCount - 1 },
            lastTransactionId: `tx-child${callCount}-${txCount - 1}`,
            totalFetched: txCount,
          } as CursorState,
          isComplete: true,
        });
      });

      await orchestrator.importBlockchain('bitcoin', xpub);

      // Verify each child account has its own cursor
      const allAccounts = await db.selectFrom('accounts').selectAll().execute();
      const child1 = allAccounts.find((a) => a.identifier === derivedAddress1);
      const child2 = allAccounts.find((a) => a.identifier === derivedAddress2);

      expect(child1?.last_cursor).toBeDefined();
      expect(child2?.last_cursor).toBeDefined();

      // Parse and verify cursors
      const child1Cursor = JSON.parse(child1!.last_cursor as string) as Record<string, CursorState>;
      const child2Cursor = JSON.parse(child2!.last_cursor as string) as Record<string, CursorState>;

      expect(child1Cursor.normal?.totalFetched).toBe(5);
      expect(child2Cursor.normal?.totalFetched).toBe(3);
      expect(child1Cursor.normal?.lastTransactionId).toBe('tx-child1-4');
      expect(child2Cursor.normal?.lastTransactionId).toBe('tx-child2-2');
    });

    it('should resume from cursor on second import and fetch 0 new transactions', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddress1, derivationPath: "m/84'/0'/0'/0/0" }]);

      // First import - return 3 transactions
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [
            {
              providerName: 'test-provider',
              externalId: 'tx1',
              rawData: { txid: 'tx1', blockHeight: 100 },
              normalizedData: { id: 'tx1', blockHeight: 100 },
            },
            {
              providerName: 'test-provider',
              externalId: 'tx2',
              rawData: { txid: 'tx2', blockHeight: 101 },
              normalizedData: { id: 'tx2', blockHeight: 101 },
            },
            {
              providerName: 'test-provider',
              externalId: 'tx3',
              rawData: { txid: 'tx3', blockHeight: 102 },
              normalizedData: { id: 'tx3', blockHeight: 102 },
            },
          ],
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 102 },
            lastTransactionId: 'tx3',
            totalFetched: 3,
          } as CursorState,
          isComplete: true,
        });
      });

      const firstResult = await orchestrator.importBlockchain('bitcoin', xpub);

      expect(firstResult.isOk()).toBe(true);
      if (firstResult.isOk()) {
        expect(firstResult.value.transactionsImported).toBe(3);
      }

      // Verify cursor was stored
      const childAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('identifier', '=', derivedAddress1)
        .executeTakeFirstOrThrow();
      expect(childAccount.last_cursor).toBeDefined();
      const cursor = JSON.parse(childAccount.last_cursor as string) as Record<string, CursorState>;
      expect(cursor.normal?.totalFetched).toBe(3);

      // Second import - return 0 new transactions (resume from cursor)
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [],
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 102 },
            lastTransactionId: 'tx3',
            totalFetched: 3, // No new transactions
          } as CursorState,
          isComplete: true,
        });
      });

      const secondResult = await orchestrator.importBlockchain('bitcoin', xpub);

      expect(secondResult.isOk()).toBe(true);
      if (secondResult.isOk()) {
        expect(secondResult.value.transactionsImported).toBe(0); // 0 new transactions on resume
      }

      // Verify cursor totalFetched matches actual transactions
      const updatedChildAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('identifier', '=', derivedAddress1)
        .executeTakeFirstOrThrow();
      const updatedCursor = JSON.parse(updatedChildAccount.last_cursor as string) as Record<string, CursorState>;
      expect(updatedCursor.normal?.totalFetched).toBe(3);

      // Verify transaction count in database matches cursor (via data_source)
      const dataSources = await db
        .selectFrom('import_sessions')
        .select('id')
        .where('account_id', '=', childAccount.id)
        .execute();
      const dataSourceIds = dataSources.map((ds) => ds.id);

      const txCount = await db
        .selectFrom('external_transaction_data')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('data_source_id', 'in', dataSourceIds)
        .executeTakeFirstOrThrow();
      expect(Number(txCount.count)).toBe(3);
    });

    it('should handle custom xpubGap parameter', async () => {
      const customGap = 10;

      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddress1, derivationPath: "m/84'/0'/0'/0/0" }]);

      mockImportStreamingFn.mockImplementation(async function* () {
        yield okAsync({
          rawTransactions: [],
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
          } as CursorState,
          isComplete: true,
        });
      });

      await orchestrator.importBlockchain('bitcoin', xpub, undefined, customGap);

      // Verify custom gap was passed to derive function
      expect(mockDeriveAddresses).toHaveBeenCalledWith(xpub.toLowerCase(), customGap);
    });
  });

  describe('Cardano xpub import with resume', () => {
    const stakeAddress = 'stake1u8pcjgmx7962w6hey5hhsd502araxp26kdtgagakhaqtq8squng76';
    const derivedAddress1 = 'addr1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

    it('should create parent account and child accounts for Cardano stake address', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddress1, derivationPath: "m/1852'/1815'/0'/0/0" }]);

      mockImportStreamingFn.mockImplementation(async function* () {
        yield okAsync({
          rawTransactions: [
            {
              providerName: 'test-provider',
              externalId: 'cardano-tx1',
              rawData: { txHash: 'cardano-tx1' },
              normalizedData: { id: 'cardano-tx1' },
            },
            {
              providerName: 'test-provider',
              externalId: 'cardano-tx2',
              rawData: { txHash: 'cardano-tx2' },
              normalizedData: { id: 'cardano-tx2' },
            },
          ],
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 5000000 },
            lastTransactionId: 'cardano-tx2',
            totalFetched: 2,
          } as CursorState,
          isComplete: true,
        });
      });

      const result = await orchestrator.importBlockchain('cardano', stakeAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(2);
      }

      // Verify parent account was created
      const allAccounts = await db.selectFrom('accounts').selectAll().execute();
      const parentAccount = allAccounts.find((a) => a.identifier === stakeAddress);
      expect(parentAccount).toBeDefined();
      expect(parentAccount?.parent_account_id).toBeNull();

      // Verify child account was created
      const childAccount = allAccounts.find((a) => a.identifier === derivedAddress1);
      expect(childAccount).toBeDefined();
      expect(childAccount?.parent_account_id).toBe(parentAccount?.id);
    });

    it('should resume from cursor on second import for Cardano', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddress1, derivationPath: "m/1852'/1815'/0'/0/0" }]);

      // First import
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [
            {
              providerName: 'test-provider',
              externalId: 'cardano-tx1',
              rawData: { txHash: 'cardano-tx1' },
              normalizedData: { id: 'cardano-tx1' },
            },
          ],
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 5000000 },
            lastTransactionId: 'cardano-tx1',
            totalFetched: 1,
          } as CursorState,
          isComplete: true,
        });
      });

      const firstResult = await orchestrator.importBlockchain('cardano', stakeAddress);

      expect(firstResult.isOk()).toBe(true);
      if (firstResult.isOk()) {
        expect(firstResult.value.transactionsImported).toBe(1);
      }

      // Second import - no new transactions
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [],
          operationType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 5000000 },
            lastTransactionId: 'cardano-tx1',
            totalFetched: 1,
          } as CursorState,
          isComplete: true,
        });
      });

      const secondResult = await orchestrator.importBlockchain('cardano', stakeAddress);

      expect(secondResult.isOk()).toBe(true);
      if (secondResult.isOk()) {
        expect(secondResult.value.transactionsImported).toBe(0); // 0 new transactions on resume
      }

      // Verify cursor matches transaction count
      const childAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('identifier', '=', derivedAddress1)
        .executeTakeFirstOrThrow();

      const cursor = JSON.parse(childAccount.last_cursor as string) as Record<string, CursorState>;
      expect(cursor.normal?.totalFetched).toBe(1);

      // Verify transaction count via data_source
      const dataSources = await db
        .selectFrom('import_sessions')
        .select('id')
        .where('account_id', '=', childAccount.id)
        .execute();
      const dataSourceIds = dataSources.map((ds) => ds.id);

      const txCount = await db
        .selectFrom('external_transaction_data')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('data_source_id', 'in', dataSourceIds)
        .executeTakeFirstOrThrow();
      expect(Number(txCount.count)).toBe(1);
    });
  });
});
