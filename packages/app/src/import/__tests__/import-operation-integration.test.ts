/**
 * Integration tests for ImportOperation with real DataContext (in-memory SQLite)
 *
 * Tests the full import flow including:
 * - Parent account creation for xpub
 * - Child account creation for derived addresses
 * - Cursor handling per child account
 * - Resume functionality (second import fetches 0 new)
 * - Shared transaction storage across derived addresses
 */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { ok } from '@exitbook/core';
import { DataContext } from '@exitbook/data';
import { createTestDataContext } from '@exitbook/data/test-utils';
import { AdapterRegistry } from '@exitbook/ingestion';
import type { BlockchainAdapter } from '@exitbook/ingestion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportOperation } from '../import-operation.js';

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const mockProviderManager = {} as BlockchainProviderManager;

// Mock derive addresses
interface DerivedAddressMock {
  address: string;
  derivationPath: string;
}

const mockDeriveAddresses =
  vi.fn<
    (xpub: string, pm: BlockchainProviderManager, blockchain: string, gap?: number) => Promise<DerivedAddressMock[]>
  >();
const mockDeriveAddressesResult = vi.fn(
  async (xpub: string, pm: BlockchainProviderManager, blockchain: string, gap?: number) => {
    const result = await mockDeriveAddresses(xpub, pm, blockchain, gap);
    return ok(result);
  }
);

const mockImportStreamingFn = vi.fn();

function createIntegrationRegistry() {
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

  return new AdapterRegistry([bitcoinAdapter, cardanoAdapter], []);
}

/** Create a standard batch of raw transactions for testing */
function createTxBatch(txIds: string[], streamType = 'normal', cursorValue?: number) {
  const txs = txIds.map((id) => ({
    providerName: 'test-provider',
    timestamp: Date.now(),
    eventId: id,
    blockchainTransactionHash: id,
    providerData: { txid: id, blockHeight: 100 },
    normalizedData: { id, blockHeight: 100 },
  }));

  return {
    rawTransactions: txs,
    streamType,
    cursor: {
      primary: { type: 'blockNumber', value: cursorValue ?? txIds.length },
      lastTransactionId: txIds[txIds.length - 1],
      totalFetched: txIds.length,
    } as CursorState,
    isComplete: true,
  };
}

describe('ImportOperation integration tests', () => {
  let dataContext: DataContext;
  let operation: ImportOperation;

  beforeEach(async () => {
    mockDeriveAddresses.mockReset();
    mockDeriveAddressesResult.mockClear();
    mockImportStreamingFn.mockReset();

    dataContext = await createTestDataContext();
    const registry = createIntegrationRegistry();
    operation = new ImportOperation(dataContext, mockProviderManager, registry);

    // Reset mocks after operation setup
    mockDeriveAddresses.mockReset();
    mockDeriveAddressesResult.mockClear();
    mockImportStreamingFn.mockReset();
  });

  afterEach(async () => {
    await dataContext.close();
  });

  // -------------------------------------------------------------------------
  // Bitcoin xpub
  // -------------------------------------------------------------------------

  describe('Bitcoin xpub import', () => {
    const xpub =
      'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';
    const addr1 = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const addr2 = 'bc1q9ejr4fhqzfxjm4q8h95jqxqxqxqxqxqxqxqxqx';

    it('should create parent and child accounts for Bitcoin xpub', async () => {
      mockDeriveAddresses.mockResolvedValue([
        { address: addr1, derivationPath: "m/84'/0'/0'/0/0" },
        { address: addr2, derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      mockImportStreamingFn.mockImplementation(async function* () {
        yield ok(createTxBatch(['tx1', 'tx2']));
      });

      const result = await operation.execute({ blockchain: 'bitcoin', address: xpub });

      expect(result.isOk()).toBe(true);
      const { sessions } = result._unsafeUnwrap();
      const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
      expect(totalImported).toBe(4); // 2 addresses * 2 txs

      // Verify parent account
      const allAccounts = (await dataContext.accounts.findAll())._unsafeUnwrap();
      const parent = allAccounts.find((a) => a.identifier === xpub.toLowerCase());
      expect(parent).toBeDefined();
      expect(parent?.parentAccountId).toBeUndefined();

      // Verify child accounts
      const children = allAccounts.filter((a) => a.parentAccountId === parent?.id);
      expect(children).toHaveLength(2);
      expect(children.find((a) => a.identifier === addr1)).toBeDefined();
      expect(children.find((a) => a.identifier === addr2)).toBeDefined();
    });

    it('should maintain separate cursors for each child account', async () => {
      mockDeriveAddresses.mockResolvedValue([
        { address: addr1, derivationPath: "m/84'/0'/0'/0/0" },
        { address: addr2, derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      let callCount = 0;
      mockImportStreamingFn.mockImplementation(async function* () {
        callCount++;
        const txCount = callCount === 1 ? 5 : 3;
        const txIds = Array.from({ length: txCount }, (_, i) => `tx-child${callCount}-${i}`);
        yield ok(createTxBatch(txIds, 'normal', 100 + txCount - 1));
      });

      await operation.execute({ blockchain: 'bitcoin', address: xpub });

      const allAccounts = (await dataContext.accounts.findAll())._unsafeUnwrap();
      const child1 = allAccounts.find((a) => a.identifier === addr1);
      const child2 = allAccounts.find((a) => a.identifier === addr2);

      expect(child1?.lastCursor?.['normal']?.totalFetched).toBe(5);
      expect(child2?.lastCursor?.['normal']?.totalFetched).toBe(3);
    });

    it('should resume from cursor on second import', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: addr1, derivationPath: "m/84'/0'/0'/0/0" }]);

      // First import — 3 transactions
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield ok(createTxBatch(['tx1', 'tx2', 'tx3'], 'normal', 102));
      });

      const firstResult = await operation.execute({ blockchain: 'bitcoin', address: xpub });
      expect(firstResult.isOk()).toBe(true);
      expect(firstResult._unsafeUnwrap().sessions.reduce((s, sess) => s + sess.transactionsImported, 0)).toBe(3);

      // Verify cursor stored
      const child = (await dataContext.accounts.findAll())._unsafeUnwrap().find((a) => a.identifier === addr1)!;
      expect(child.lastCursor?.['normal']?.totalFetched).toBe(3);

      // Second import — 0 new transactions
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield ok({
          rawTransactions: [],
          streamType: 'normal',
          cursor: { primary: { type: 'blockNumber', value: 102 }, totalFetched: 3 } as CursorState,
          isComplete: true,
        });
      });

      const secondResult = await operation.execute({ blockchain: 'bitcoin', address: xpub });
      expect(secondResult.isOk()).toBe(true);
      expect(secondResult._unsafeUnwrap().sessions.reduce((s, sess) => s + sess.transactionsImported, 0)).toBe(0);

      // Verify actual tx count in DB
      const txCount = (await dataContext.rawTransactions.count({ accountIds: [child.id] }))._unsafeUnwrap();
      expect(txCount).toBe(3);
    });

    it('should handle custom xpubGap parameter', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: addr1, derivationPath: "m/84'/0'/0'/0/0" }]);
      mockImportStreamingFn.mockImplementation(async function* () {
        yield ok(createTxBatch([], 'normal', 0));
      });

      await operation.execute({ blockchain: 'bitcoin', address: xpub, xpubGap: 10 });

      expect(mockDeriveAddresses).toHaveBeenCalledWith(xpub.toLowerCase(), mockProviderManager, 'bitcoin', 10);
    });

    it('should create only parent when no addresses derived', async () => {
      mockDeriveAddresses.mockResolvedValue([]);

      const result = await operation.execute({ blockchain: 'bitcoin', address: xpub });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toHaveLength(0);

      const allAccounts = (await dataContext.accounts.findAll())._unsafeUnwrap();
      expect(allAccounts).toHaveLength(1); // Only parent

      const importSessions = (await dataContext.importSessions.findAll())._unsafeUnwrap();
      expect(importSessions).toHaveLength(0);
      expect(mockImportStreamingFn).not.toHaveBeenCalled();
    });

    it('should store same transaction separately for each derived address', async () => {
      mockDeriveAddresses.mockResolvedValue([
        { address: addr1, derivationPath: "m/84'/0'/0'/0/0" },
        { address: addr2, derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      const sharedTxHash = 'abc123def456shared';
      mockImportStreamingFn.mockImplementation(async function* () {
        yield ok({
          rawTransactions: [
            {
              providerName: 'test-provider',
              eventId: sharedTxHash,
              blockchainTransactionHash: sharedTxHash,
              providerData: { txid: sharedTxHash },
              normalizedData: { id: sharedTxHash },
              timestamp: Date.now(),
            },
          ],
          streamType: 'normal',
          cursor: { primary: { type: 'blockNumber', value: 100 }, totalFetched: 1 } as CursorState,
          isComplete: true,
        });
      });

      const result = await operation.execute({ blockchain: 'bitcoin', address: xpub });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions.reduce((s, sess) => s + sess.transactionsImported, 0)).toBe(2);

      // 2 rows — one per child account
      const allTxs = (await dataContext.rawTransactions.findAll())._unsafeUnwrap();
      expect(allTxs).toHaveLength(2);
      expect(allTxs[0]?.blockchainTransactionHash).toBe(sharedTxHash);
      expect(allTxs[1]?.blockchainTransactionHash).toBe(sharedTxHash);
      expect(allTxs[0]?.accountId).not.toBe(allTxs[1]?.accountId);

      // Both pending
      const pendingTxs = (await dataContext.rawTransactions.findAll({ processingStatus: 'pending' }))._unsafeUnwrap();
      expect(pendingTxs).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Cardano xpub
  // -------------------------------------------------------------------------

  describe('Cardano xpub import', () => {
    const stakeAddress = 'stake1u8pcjgmx7962w6hey5hhsd502araxp26kdtgagakhaqtq8squng76';
    const derivedAddr = 'addr1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

    it('should create parent and child accounts for Cardano stake address', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddr, derivationPath: "m/1852'/1815'/0'/0/0" }]);

      mockImportStreamingFn.mockImplementation(async function* () {
        yield ok(createTxBatch(['cardano-tx1', 'cardano-tx2']));
      });

      const result = await operation.execute({ blockchain: 'cardano', address: stakeAddress });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions.reduce((s, sess) => s + sess.transactionsImported, 0)).toBe(2);

      const allAccounts = (await dataContext.accounts.findAll())._unsafeUnwrap();
      const parent = allAccounts.find((a) => a.identifier === stakeAddress);
      expect(parent).toBeDefined();
      expect(parent?.parentAccountId).toBeUndefined();

      const child = allAccounts.find((a) => a.identifier === derivedAddr);
      expect(child).toBeDefined();
      expect(child?.parentAccountId).toBe(parent?.id);
    });

    it('should resume from cursor on second import for Cardano', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: derivedAddr, derivationPath: "m/1852'/1815'/0'/0/0" }]);

      // First import
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield ok(createTxBatch(['cardano-tx1'], 'normal', 5_000_000));
      });

      const firstResult = await operation.execute({ blockchain: 'cardano', address: stakeAddress });
      expect(firstResult.isOk()).toBe(true);

      // Second import — no new txs
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield ok({
          rawTransactions: [],
          streamType: 'normal',
          cursor: { primary: { type: 'blockNumber', value: 5_000_000 }, totalFetched: 1 } as CursorState,
          isComplete: true,
        });
      });

      const secondResult = await operation.execute({ blockchain: 'cardano', address: stakeAddress });
      expect(secondResult.isOk()).toBe(true);
      expect(secondResult._unsafeUnwrap().sessions.reduce((s, sess) => s + sess.transactionsImported, 0)).toBe(0);

      const child = (await dataContext.accounts.findAll())._unsafeUnwrap().find((a) => a.identifier === derivedAddr)!;
      expect(child.lastCursor?.['normal']?.totalFetched).toBe(1);

      const txCount = (await dataContext.rawTransactions.count({ accountIds: [child.id] }))._unsafeUnwrap();
      expect(txCount).toBe(1);
    });
  });
});
