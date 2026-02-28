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
import { createTestDatabase, DataContext, type KyselyDB } from '@exitbook/data';
import { ok, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterRegistry } from '../../../shared/types/adapter-registry.js';
import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';
import { ImportCoordinator } from '../import-coordinator.js';

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
interface DerivedAddressMock {
  address: string;
  derivationPath: string;
}
type DeriveAddressesFn = (
  xpub: string,
  providerManager: BlockchainProviderManager,
  blockchain: string,
  gap?: number
) => Promise<DerivedAddressMock[]>;

const mockDeriveAddresses = vi.fn<DeriveAddressesFn>();
const mockDeriveAddressesResult = vi.fn(async (...args: Parameters<DeriveAddressesFn>) => {
  const derivedAddresses = await mockDeriveAddresses(...args);
  return ok(derivedAddresses);
});

// Mock import streaming function
const mockImportStreamingFn = vi.fn();

describe('xpub import integration tests', () => {
  let db: KyselyDB;
  let dataContext: DataContext;
  let orchestrator: ImportCoordinator;

  beforeEach(async () => {
    // Reset mocks
    mockDeriveAddresses.mockReset();
    mockDeriveAddressesResult.mockClear();
    mockImportStreamingFn.mockReset();

    // Create in-memory database
    db = await createTestDatabase();
    dataContext = new DataContext(db);

    // Create adapter registry with bitcoin and cardano UTXO adapters
    const bitcoinAdapter: BlockchainAdapter = {
      blockchain: 'bitcoin',
      chainModel: 'utxo',
      normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
      isExtendedPublicKey: (addr: string) => addr.startsWith('xpub') || addr.startsWith('ypub'),
      deriveAddressesFromXpub: mockDeriveAddressesResult,
      createImporter: () => ({ importStreaming: mockImportStreamingFn }),
      createProcessor: vi.fn(),
    };

    const cardanoAdapter: BlockchainAdapter = {
      blockchain: 'cardano',
      chainModel: 'utxo',
      normalizeAddress: (addr: string) => ok(addr),
      isExtendedPublicKey: (addr: string) => addr.startsWith('stake') || addr.startsWith('addr_xvk'),
      deriveAddressesFromXpub: mockDeriveAddressesResult,
      createImporter: () => ({ importStreaming: mockImportStreamingFn }),
      createProcessor: vi.fn(),
    };

    const registry = new AdapterRegistry([bitcoinAdapter, cardanoAdapter], []);

    // Create orchestrator
    orchestrator = new ImportCoordinator(dataContext, mockProviderManager, registry);

    // Reset mocks after orchestrator setup
    mockDeriveAddresses.mockReset();
    mockDeriveAddressesResult.mockClear();
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
              timestamp: Date.now(),
              eventId: 'tx1',
              blockchainTransactionHash: 'tx1',
              providerData: { txid: 'tx1', blockHeight: 100 },
              normalizedData: { id: 'tx1', blockHeight: 100 },
            },
            {
              providerName: 'test-provider',
              timestamp: Date.now(),
              eventId: 'tx2',
              blockchainTransactionHash: 'tx2',
              providerData: { txid: 'tx2', blockHeight: 101 },
              normalizedData: { id: 'tx2', blockHeight: 101 },
            },
          ],
          streamType: 'normal',
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
        // Xpub returns array of ImportSessions
        expect(Array.isArray(result.value)).toBe(true);
        const sessions = result.value as { transactionsImported: number }[];
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(4); // 2 addresses * 2 txs each
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
            eventId: `tx-child${callCount}-${i}`,
            timestamp: Date.now() + i,
            blockchainTransactionHash: `tx-child${callCount}-${i}`,
            providerData: { txid: `tx-child${callCount}-${i}`, blockHeight: 100 + i },
            normalizedData: { id: `tx-child${callCount}-${i}`, blockHeight: 100 + i },
          })),
          streamType: 'normal',
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

      expect(child1Cursor['normal']?.totalFetched).toBe(5);
      expect(child2Cursor['normal']?.totalFetched).toBe(3);
      expect(child1Cursor['normal']?.lastTransactionId).toBe('tx-child1-4');
      expect(child2Cursor['normal']?.lastTransactionId).toBe('tx-child2-2');
    });

    it('should resume from cursor on second import and fetch 0 new transactions', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddress1, derivationPath: "m/84'/0'/0'/0/0" }]);

      // First import - return 3 transactions
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [
            {
              providerName: 'test-provider',
              timestamp: Date.now(),
              eventId: 'tx1',
              blockchainTransactionHash: 'tx1',
              providerData: { txid: 'tx1', blockHeight: 100 },
              normalizedData: { id: 'tx1', blockHeight: 100 },
            },
            {
              providerName: 'test-provider',
              timestamp: Date.now(),
              eventId: 'tx2',
              blockchainTransactionHash: 'tx2',
              providerData: { txid: 'tx2', blockHeight: 101 },
              normalizedData: { id: 'tx2', blockHeight: 101 },
            },
            {
              providerName: 'test-provider',
              timestamp: Date.now(),
              eventId: 'tx3',
              blockchainTransactionHash: 'tx3',
              providerData: { txid: 'tx3', blockHeight: 102 },
              normalizedData: { id: 'tx3', blockHeight: 102 },
            },
          ],
          streamType: 'normal',
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
        expect(Array.isArray(firstResult.value)).toBe(true);
        const sessions = firstResult.value as { transactionsImported: number }[];
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(3);
      }

      // Verify cursor was stored
      const childAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('identifier', '=', derivedAddress1)
        .executeTakeFirstOrThrow();
      expect(childAccount.last_cursor).toBeDefined();
      const cursor = JSON.parse(childAccount.last_cursor as string) as Record<string, CursorState>;
      expect(cursor['normal']?.totalFetched).toBe(3);

      // Second import - return 0 new transactions (resume from cursor)
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [],
          streamType: 'normal',
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
        expect(Array.isArray(secondResult.value)).toBe(true);
        const sessions = secondResult.value as { transactionsImported: number }[];
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(0); // 0 new transactions on resume
      }

      // Verify cursor totalFetched matches actual transactions
      const updatedChildAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('identifier', '=', derivedAddress1)
        .executeTakeFirstOrThrow();
      const updatedCursor = JSON.parse(updatedChildAccount.last_cursor as string) as Record<string, CursorState>;
      expect(updatedCursor['normal']?.totalFetched).toBe(3);

      // Verify transaction count in database matches cursor (via account)
      const txCount = await db
        .selectFrom('raw_transactions')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('account_id', '=', childAccount.id)
        .executeTakeFirstOrThrow();
      expect(Number(txCount.count)).toBe(3);
    });

    it('should handle custom xpubGap parameter', async () => {
      const customGap = 10;

      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddress1, derivationPath: "m/84'/0'/0'/0/0" }]);

      mockImportStreamingFn.mockImplementation(async function* () {
        yield okAsync({
          rawTransactions: [],
          streamType: 'normal',
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
      expect(mockDeriveAddresses).toHaveBeenCalledWith(xpub.toLowerCase(), mockProviderManager, 'bitcoin', customGap);
    });

    it('should create only parent account when no active addresses found (0 derived addresses)', async () => {
      // Mock derive addresses to return empty array (no activity found during gap scan)
      mockDeriveAddresses.mockResolvedValue([]);

      const result = await orchestrator.importBlockchain('bitcoin', xpub);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // No addresses derived means empty array
        expect(Array.isArray(result.value)).toBe(true);
        const sessions = result.value as { transactionsImported: number }[];
        expect(sessions).toHaveLength(0);
      }

      // Verify only parent account was created, no child accounts
      const allAccounts = await db.selectFrom('accounts').selectAll().execute();
      expect(allAccounts).toHaveLength(1); // Only parent account

      const parentAccount = allAccounts.find((a) => a.identifier === xpub.toLowerCase());
      expect(parentAccount).toBeDefined();
      expect(parentAccount?.parent_account_id).toBeNull();

      // Verify no import sessions were created (no child imports)
      const importSessions = await db.selectFrom('import_sessions').selectAll().execute();
      expect(importSessions).toHaveLength(0);

      // importStreaming should never be called
      expect(mockImportStreamingFn).not.toHaveBeenCalled();
    });

    it('should store same blockchain transaction separately for each derived address', async () => {
      // When the same on-chain transaction touches multiple derived addresses,
      // it should be stored separately for each account to preserve UTXO change detection.
      // Each account's perspective of the transaction is needed for proper fund-flow analysis.
      mockDeriveAddresses.mockResolvedValue([
        { address: derivedAddress1, derivationPath: "m/84'/0'/0'/0/0" },
        { address: derivedAddress2, derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      // Shared transaction hash - same transaction touches both addresses
      const sharedTxHash = 'abc123def456shared';

      mockImportStreamingFn.mockImplementation(async function* () {
        // Both derived addresses return the SAME transaction
        // This simulates a real scenario where one on-chain tx has:
        //   inputs: [derivedAddress1]
        //   outputs: [derivedAddress2, external_address]
        yield okAsync({
          rawTransactions: [
            {
              providerName: 'test-provider',
              eventId: sharedTxHash,
              blockchainTransactionHash: sharedTxHash, // Same hash for both!
              providerData: { txid: sharedTxHash, inputs: [derivedAddress1], outputs: [derivedAddress2] },
              normalizedData: { id: sharedTxHash, blockHeight: 100 },
              timestamp: Date.now(),
            },
          ],
          streamType: 'normal',
          cursor: {
            primary: { type: 'blockNumber', value: 100 },
            lastTransactionId: sharedTxHash,
            totalFetched: 1,
          } as CursorState,
          isComplete: true,
        });
      });

      const result = await orchestrator.importBlockchain('bitcoin', xpub);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Both child accounts will import the transaction (different account_ids)
        // Each account's perspective is preserved for UTXO change detection
        expect(Array.isArray(result.value)).toBe(true);
        const sessions = result.value as { transactionsImported: number }[];
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(2);
      }

      // Verify 2 rows exist in raw_transactions (one per child account)
      const allTransactions = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(allTransactions).toHaveLength(2);

      // Both should have the same blockchain hash
      expect(allTransactions[0]?.blockchain_transaction_hash).toBe(sharedTxHash);
      expect(allTransactions[1]?.blockchain_transaction_hash).toBe(sharedTxHash);

      // But different account IDs
      expect(allTransactions[0]?.account_id).not.toBe(allTransactions[1]?.account_id);

      // Verify both are linked to child accounts
      const allAccounts = await db.selectFrom('accounts').selectAll().execute();
      const childAccounts = allAccounts.filter((a) => a.parent_account_id !== null);
      expect(childAccounts).toHaveLength(2);

      // Both transactions should be linked to child accounts
      const accountIds = allTransactions.map((tx) => tx.account_id);
      expect(childAccounts.some((a) => a.id === accountIds[0])).toBe(true);
      expect(childAccounts.some((a) => a.id === accountIds[1])).toBe(true);

      // Verify both transactions remain pending (no cross-account deduplication)
      const pendingTxs = await db
        .selectFrom('raw_transactions')
        .selectAll()
        .where('processing_status', '=', 'pending')
        .execute();
      expect(pendingTxs).toHaveLength(2);
      expect(pendingTxs[0]?.blockchain_transaction_hash).toBe(sharedTxHash);
      expect(pendingTxs[1]?.blockchain_transaction_hash).toBe(sharedTxHash);
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
              eventId: 'cardano-tx1',
              blockchainTransactionHash: 'cardano-tx1',
              providerData: { txHash: 'cardano-tx1' },
              normalizedData: { id: 'cardano-tx1' },
              timestamp: Date.now(),
            },
            {
              providerName: 'test-provider',
              eventId: 'cardano-tx2',
              blockchainTransactionHash: 'cardano-tx2',
              providerData: { txHash: 'cardano-tx2' },
              normalizedData: { id: 'cardano-tx2' },
              timestamp: Date.now() + 1,
            },
          ],
          streamType: 'normal',
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
        expect(Array.isArray(result.value)).toBe(true);
        const sessions = result.value as { transactionsImported: number }[];
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(2);
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
              eventId: 'cardano-tx1',
              blockchainTransactionHash: 'cardano-tx1',
              providerData: { txHash: 'cardano-tx1' },
              normalizedData: { id: 'cardano-tx1' },
              timestamp: Date.now(),
            },
          ],
          streamType: 'normal',
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
        expect(Array.isArray(firstResult.value)).toBe(true);
        const sessions = firstResult.value as { transactionsImported: number }[];
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(1);
      }

      // Second import - no new transactions
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [],
          streamType: 'normal',
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
        expect(Array.isArray(secondResult.value)).toBe(true);
        const sessions = secondResult.value as { transactionsImported: number }[];
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(0); // 0 new transactions on resume
      }

      // Verify cursor matches transaction count
      const childAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('identifier', '=', derivedAddress1)
        .executeTakeFirstOrThrow();

      const cursor = JSON.parse(childAccount.last_cursor as string) as Record<string, CursorState>;
      expect(cursor['normal']?.totalFetched).toBe(1);

      // Verify transaction count via account
      const txCount = await db
        .selectFrom('raw_transactions')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('account_id', '=', childAccount.id)
        .executeTakeFirstOrThrow();
      expect(Number(txCount.count)).toBe(1);
    });
  });
});
