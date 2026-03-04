/**
 * Unit tests for ImportOperation
 *
 * Tests all import paths (blockchain, exchange API, exchange CSV),
 * xpub parent/child orchestration, streaming loop, session management,
 * error handling, event emission, and abort.
 */

import type { ImportSession } from '@exitbook/core';
import { err, errAsync, ok, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportOperation } from '../import-operation.js';

import {
  createBlockchainStreamingMock,
  createDeriveAddressesMock,
  createExchangeStreamingMock,
  createMockAccount,
  createMockDataContext,
  createMockEventSink,
  createMockProviderManager,
  createMockSession,
  createTestRegistry,
} from './import-test-utils.js';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => mockLogger,
}));

describe('ImportOperation', () => {
  let ctx: ReturnType<typeof createMockDataContext>;
  let blockchainStreamingFn: ReturnType<typeof createBlockchainStreamingMock>;
  let exchangeStreamingFn: ReturnType<typeof createExchangeStreamingMock>;
  let operation: ImportOperation;
  let providerManager: ReturnType<typeof createMockProviderManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = createMockDataContext();
    blockchainStreamingFn = createBlockchainStreamingMock();
    exchangeStreamingFn = createExchangeStreamingMock();
    providerManager = createMockProviderManager();

    const registry = createTestRegistry({ blockchainStreamingFn, exchangeStreamingFn });
    operation = new ImportOperation(ctx.db, providerManager, registry);
  });

  /** Set up repos to allow a successful blockchain import to complete */
  function setupSuccessfulImport(session?: ImportSession) {
    const s = session ?? createMockSession();
    vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(createMockAccount('blockchain', 'bitcoin', 'bc1q...')));
    vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(s));
  }

  // -------------------------------------------------------------------------
  // Blockchain imports
  // -------------------------------------------------------------------------

  describe('executeBlockchain', () => {
    it('should create account and import for regular address', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1q...');
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'BC1Q...' });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toHaveLength(1);
      expect(result._unsafeUnwrap().sessions[0]!.transactionsImported).toBe(2);

      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'bc1q...', // normalized to lowercase
        })
      );
    });

    it('should warn if xpubGap provided for non-xpub address', async () => {
      setupSuccessfulImport();

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...', xpubGap: 20 });

      expect(result.isOk()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('xpub-gap'));
    });

    it('should return error for unknown blockchain', async () => {
      const result = await operation.execute({ blockchain: 'unknown-chain', address: 'addr' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Unknown blockchain');
    });

    it('should handle user creation failure', async () => {
      vi.mocked(ctx.users.findOrCreateDefault).mockResolvedValue(err(new Error('User creation failed')));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('User creation failed');
    });

    it('should handle account creation failure', async () => {
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(err(new Error('Database error')));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');
    });
  });

  // -------------------------------------------------------------------------
  // Exchange API imports
  // -------------------------------------------------------------------------

  describe('executeExchangeApi', () => {
    it('should create account and import from exchange API', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-key', {
        credentials: { apiKey: 'test-key', apiSecret: 'test-secret' },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await operation.execute({
        exchange: 'kraken',
        credentials: { apiKey: 'test-key', apiSecret: 'test-secret' },
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toHaveLength(1);
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          accountType: 'exchange-api',
          sourceName: 'kraken',
          identifier: 'test-key',
        })
      );
    });

    it('should return error if API key is missing', async () => {
      const result = await operation.execute({
        exchange: 'kraken',
        credentials: { apiKey: '', apiSecret: 'test-secret' },
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('API key is required');
    });

    it('should return error for unknown exchange', async () => {
      const account = createMockAccount('exchange-api', 'unknown-exchange', 'key');
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.importSessions.create).mockResolvedValue(ok(1));

      const result = await operation.execute({
        exchange: 'unknown-exchange',
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Unknown exchange');
    });
  });

  // -------------------------------------------------------------------------
  // Exchange CSV imports
  // -------------------------------------------------------------------------

  describe('executeExchangeCsv', () => {
    it('should create account and import from CSV directory', async () => {
      const account = createMockAccount('exchange-csv', 'kraken', '/data/kraken');
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await operation.execute({
        exchange: 'kraken',
        csvDir: '/data/kraken',
      });

      expect(result.isOk()).toBe(true);
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          accountType: 'exchange-csv',
          sourceName: 'kraken',
          identifier: '/data/kraken',
        })
      );
    });

    it('should reject mismatched CSV directory for existing account', async () => {
      const existing = createMockAccount('exchange-csv', 'kraken', '/data/kraken-old');
      vi.mocked(ctx.accounts.findAll).mockResolvedValue(ok([existing]));

      const result = await operation.execute({
        exchange: 'kraken',
        csvDir: '/data/kraken-new',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('already exists');
    });

    it('should reuse existing account with same CSV directory', async () => {
      const existing = createMockAccount('exchange-csv', 'kraken', '/data/kraken');
      vi.mocked(ctx.accounts.findAll).mockResolvedValue(ok([existing]));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await operation.execute({
        exchange: 'kraken',
        csvDir: '/data/kraken',
      });

      expect(result.isOk()).toBe(true);
      // findOrCreate should NOT be called — existing account is reused
      expect(ctx.accounts.findOrCreate).not.toHaveBeenCalled();
    });

    it('should return error if csvDir is missing', async () => {
      const result = await operation.execute({
        exchange: 'kraken',
        csvDir: '',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('CSV directory is required');
    });
  });

  // -------------------------------------------------------------------------
  // Streaming import (core loop)
  // -------------------------------------------------------------------------

  describe('streaming import loop', () => {
    it('should create import session and save batch', async () => {
      setupSuccessfulImport();

      await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(ctx.importSessions.create).toHaveBeenCalledWith(1);
      expect(ctx.rawTransactions.createBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ transactionHash: 'tx1' }),
          expect.objectContaining({ transactionHash: 'tx2' }),
        ])
      );
      expect(ctx.importSessions.finalize).toHaveBeenCalledWith(1, 'completed', expect.any(Number), 2, 0);
    });

    it('should resume from incomplete import session', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1q...', {
        lastCursor: {
          normal: {
            primary: { type: 'blockNumber', value: 50 },
            lastTransactionId: 'tx-50',
            totalFetched: 50,
          },
        },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));

      const incompleteSession = createMockSession({
        id: 42,
        status: 'started' as const,
        transactionsImported: 50,
        transactionsSkipped: 0,
      });
      vi.mocked(ctx.importSessions.findLatestIncomplete).mockResolvedValue(ok(incompleteSession));

      const completedSession = createMockSession({
        id: 42,
        status: 'completed',
        transactionsImported: 52,
      });
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(completedSession));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions[0]!.transactionsImported).toBe(52);

      // Should NOT create a new session (resuming existing one)
      expect(ctx.importSessions.create).not.toHaveBeenCalled();
      // Should update status back to 'started'
      expect(ctx.importSessions.update).toHaveBeenCalledWith(42, { status: 'started' });
      expect(ctx.importSessions.finalize).toHaveBeenCalledWith(42, 'completed', expect.any(Number), 52, 0);
    });

    it('should handle duplicate skipping on resume', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1q...', {
        lastCursor: {
          normal: { primary: { type: 'blockNumber', value: 50 }, lastTransactionId: 'tx50', totalFetched: 50 },
        },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));

      const incompleteSession = createMockSession({
        id: 42,
        status: 'started' as const,
        transactionsImported: 50,
        transactionsSkipped: 3,
      });
      vi.mocked(ctx.importSessions.findLatestIncomplete).mockResolvedValue(ok(incompleteSession));

      vi.mocked(ctx.rawTransactions.createBatch).mockResolvedValue(ok({ inserted: 0, skipped: 2 }));

      const completedSession = createMockSession({ id: 42, transactionsImported: 50, transactionsSkipped: 5 });
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(completedSession));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isOk()).toBe(true);
      expect(ctx.importSessions.finalize).toHaveBeenCalledWith(42, 'completed', expect.any(Number), 50, 5);
    });

    it('should finalize as failed if createBatch fails', async () => {
      setupSuccessfulImport();
      vi.mocked(ctx.rawTransactions.createBatch).mockResolvedValue(err(new Error('Disk full')));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Disk full');
    });

    it('should finalize as failed if importer throws', async () => {
      setupSuccessfulImport();

      // eslint-disable-next-line @typescript-eslint/require-await, require-yield -- acceptable for tests
      blockchainStreamingFn.mockImplementationOnce(async function* () {
        throw new Error('Network timeout');
      });

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Network timeout');
      expect(ctx.importSessions.finalize).toHaveBeenCalledWith(
        1,
        'failed',
        expect.any(Number),
        0,
        0,
        expect.stringContaining('Network timeout'),
        expect.objectContaining({ stack: expect.any(String) as unknown })
      );
    });

    it('should handle importer yielding err()', async () => {
      setupSuccessfulImport();

      blockchainStreamingFn.mockImplementationOnce(async function* () {
        yield errAsync(new Error('Provider unavailable'));
      });

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Provider unavailable');
      expect(ctx.rawTransactions.createBatch).not.toHaveBeenCalled();
    });

    it('should handle database errors during session creation', async () => {
      setupSuccessfulImport();
      vi.mocked(ctx.importSessions.create).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database connection failed');
    });

    it('should handle errors when checking for incomplete session', async () => {
      setupSuccessfulImport();
      vi.mocked(ctx.importSessions.findLatestIncomplete).mockResolvedValue(err(new Error('Database corruption')));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database corruption');
    });

    it('should handle streaming failure after successful batch', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'key', {
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));

      exchangeStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [{ refid: 'kraken-1', type: 'trade' }],
          streamType: 'trade',
          cursor: { primary: { type: 'timestamp', value: 2 }, totalFetched: 1 },
          isComplete: false,
        });
        yield err(new Error('Validation failed on item 3'));
      });

      const result = await operation.execute({
        exchange: 'kraken',
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Validation failed on item 3');
      // Should have saved the first batch before failing
      expect(ctx.rawTransactions.createBatch).toHaveBeenCalledOnce();
    });

    it('should fail import when warnings are emitted', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'key', {
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.rawTransactions.createBatch).mockResolvedValue(ok({ inserted: 0, skipped: 0 }));

      exchangeStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [],
          streamType: 'ledger',
          cursor: { primary: { type: 'timestamp', value: 1 }, totalFetched: 0 },
          isComplete: true,
          warnings: ['Test warning: partial data'],
        });
      });

      const result = await operation.execute({
        exchange: 'kraken',
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('warning(s)');
      expect(ctx.importSessions.finalize).toHaveBeenCalledWith(
        1,
        'failed',
        expect.any(Number),
        0,
        0,
        expect.stringContaining('warning(s)'),
        { warnings: ['Test warning: partial data'] }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  describe('event emission', () => {
    it('should emit import.batch with provider stats', async () => {
      const events = createMockEventSink();
      const registry = createTestRegistry({ blockchainStreamingFn, exchangeStreamingFn });
      const opWithEvents = new ImportOperation(ctx.db, providerManager, registry, events);

      setupSuccessfulImport();

      blockchainStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [{ transactionHash: 'tx1' }, { transactionHash: 'tx2' }],
          streamType: 'normal',
          cursor: { primary: { type: 'blockNumber', value: 2 }, totalFetched: 2 },
          isComplete: true,
          providerStats: { fetched: 5, deduplicated: 3 },
        });
      });

      const result = await opWithEvents.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isOk()).toBe(true);
      expect(events.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.batch',
          sourceName: 'bitcoin',
          accountId: 1,
          fetched: 5,
          deduplicated: 3,
          totalFetchedRun: 5,
        })
      );
    });

    it('should default deduplicated to zero when provider stats unavailable', async () => {
      const events = createMockEventSink();
      const registry = createTestRegistry({ blockchainStreamingFn, exchangeStreamingFn });
      const opWithEvents = new ImportOperation(ctx.db, providerManager, registry, events);

      const account = createMockAccount('exchange-api', 'kraken', 'key', {
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await opWithEvents.execute({
        exchange: 'kraken',
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });

      expect(result.isOk()).toBe(true);
      expect(events.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.batch',
          deduplicated: 0,
        })
      );
    });

    it('should emit warning when stream count metadata lookup fails', async () => {
      const events = createMockEventSink();
      const registry = createTestRegistry({ blockchainStreamingFn, exchangeStreamingFn });
      const opWithEvents = new ImportOperation(ctx.db, providerManager, registry, events);

      const account = createMockAccount('exchange-api', 'kraken', 'key', {
        credentials: { apiKey: 'key', apiSecret: 'secret' },
        lastCursor: {
          ledger: { primary: { type: 'timestamp', value: 1 }, lastTransactionId: 'kraken-20', totalFetched: 20 },
        },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.rawTransactions.countByStreamType).mockResolvedValue(err(new Error('metrics unavailable')));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await opWithEvents.execute({
        exchange: 'kraken',
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });

      expect(result.isOk()).toBe(true);
      expect(events.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.warning',
          warning: expect.stringContaining('Failed to fetch import stream counts') as unknown,
        })
      );
    });

    it('should emit warning when cursor persistence fails but complete import', async () => {
      const events = createMockEventSink();
      const registry = createTestRegistry({ blockchainStreamingFn, exchangeStreamingFn });
      const opWithEvents = new ImportOperation(ctx.db, providerManager, registry, events);

      const account = createMockAccount('exchange-api', 'kraken', 'key', {
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(account));
      vi.mocked(ctx.accounts.updateCursor).mockResolvedValue(err(new Error('cursor table locked')));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await opWithEvents.execute({
        exchange: 'kraken',
        credentials: { apiKey: 'key', apiSecret: 'secret' },
      });

      expect(result.isOk()).toBe(true);
      expect(events.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.warning',
          warning: expect.stringContaining('Failed to update cursor') as unknown,
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // xpub import
  // -------------------------------------------------------------------------

  describe('xpub import', () => {
    let deriveAddresses: ReturnType<typeof createDeriveAddressesMock>;

    beforeEach(() => {
      deriveAddresses = createDeriveAddressesMock();
      const registry = createTestRegistry({
        blockchainStreamingFn,
        exchangeStreamingFn,
        deriveAddressesResult: deriveAddresses.mockDeriveAddressesResult,
      });
      operation = new ImportOperation(ctx.db, providerManager, registry);
    });

    it('should create parent and child accounts for xpub', async () => {
      const parentAccount = createMockAccount('blockchain', 'bitcoin', 'xpub6c...', { id: 10 });
      const child1 = createMockAccount('blockchain', 'bitcoin', 'bc1q1...', { id: 11, parentAccountId: 10 });
      const child2 = createMockAccount('blockchain', 'bitcoin', 'bc1q2...', { id: 12, parentAccountId: 10 });

      deriveAddresses.mockDeriveAddresses.mockResolvedValue([
        { address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" },
        { address: 'bc1q2...', derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      vi.mocked(ctx.accounts.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(ok(child1))
        .mockResolvedValueOnce(ok(child2));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'xpub6C...' });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toHaveLength(2);

      // Parent account creation
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'xpub6c...', // normalized
        })
      );

      // Child account creation with parentAccountId
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentAccountId: 10,
          identifier: 'bc1q1...',
        })
      );
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentAccountId: 10,
          identifier: 'bc1q2...',
        })
      );

      expect(ctx.accounts.findOrCreate).toHaveBeenCalledTimes(3); // 1 parent + 2 children
    });

    it('should respect custom xpubGap when deriving addresses', async () => {
      const parentAccount = createMockAccount('blockchain', 'bitcoin', 'xpub6c...', { id: 10 });
      deriveAddresses.mockDeriveAddresses.mockResolvedValue([]);
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(parentAccount));

      await operation.execute({ blockchain: 'bitcoin', address: 'xpub6C...', xpubGap: 5 });

      expect(deriveAddresses.mockDeriveAddresses).toHaveBeenCalledWith('xpub6c...', providerManager, 'bitcoin', 5);
    });

    it('should handle Cardano xpub (stake) addresses', async () => {
      const parentAccount = createMockAccount('blockchain', 'cardano', 'stake1u...', { id: 20 });
      const child = createMockAccount('blockchain', 'cardano', 'addr1q...', { id: 21, parentAccountId: 20 });

      deriveAddresses.mockDeriveAddresses.mockResolvedValue([
        { address: 'addr1q...', derivationPath: "m/1852'/1815'/0'/0/0" },
      ]);

      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValueOnce(ok(parentAccount)).mockResolvedValueOnce(ok(child));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      const result = await operation.execute({ blockchain: 'cardano', address: 'stake1u...' });

      expect(result.isOk()).toBe(true);
      expect(deriveAddresses.mockDeriveAddresses).toHaveBeenCalledWith(
        'stake1u...',
        providerManager,
        'cardano',
        20 // default gap
      );
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledTimes(2);
    });

    it('should return empty sessions when no addresses derived', async () => {
      const parentAccount = createMockAccount('blockchain', 'bitcoin', 'xpub6c...', { id: 10 });
      deriveAddresses.mockDeriveAddresses.mockResolvedValue([]);
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(ok(parentAccount));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'xpub6C...' });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toHaveLength(0);
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledTimes(1); // Only parent
    });

    it('should fail fast if any child import fails', async () => {
      const parentAccount = createMockAccount('blockchain', 'bitcoin', 'xpub6c...', { id: 10 });
      const child1 = createMockAccount('blockchain', 'bitcoin', 'bc1q1...', { id: 11, parentAccountId: 10 });
      const child2 = createMockAccount('blockchain', 'bitcoin', 'bc1q2...', { id: 12, parentAccountId: 10 });

      deriveAddresses.mockDeriveAddresses.mockResolvedValue([
        { address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" },
        { address: 'bc1q2...', derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      vi.mocked(ctx.accounts.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(ok(child1))
        .mockResolvedValueOnce(ok(child2));

      // First child import fails
      vi.mocked(ctx.importSessions.create).mockResolvedValueOnce(ok(1));
      blockchainStreamingFn.mockImplementationOnce(async function* () {
        yield errAsync(new Error('Network timeout'));
      });

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'xpub6C...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Failed to import child account');
    });

    it('should handle parent account creation failure', async () => {
      deriveAddresses.mockDeriveAddresses.mockResolvedValue([
        { address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" },
      ]);
      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValue(err(new Error('Database error')));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'xpub6C...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');
    });

    it('should handle child account creation failure', async () => {
      const parentAccount = createMockAccount('blockchain', 'bitcoin', 'xpub6c...', { id: 10 });
      deriveAddresses.mockDeriveAddresses.mockResolvedValue([
        { address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" },
      ]);

      vi.mocked(ctx.accounts.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(err(new Error('Child account creation failed')));

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'xpub6C...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Child account creation failed');
    });

    it('should pass providerName to parent and child accounts', async () => {
      const parentAccount = createMockAccount('blockchain', 'bitcoin', 'xpub6c...', {
        id: 10,
        providerName: 'mempool.space',
      });
      const child = createMockAccount('blockchain', 'bitcoin', 'bc1q1...', {
        id: 11,
        parentAccountId: 10,
        providerName: 'mempool.space',
      });

      deriveAddresses.mockDeriveAddresses.mockResolvedValue([
        { address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" },
      ]);

      vi.mocked(ctx.accounts.findOrCreate).mockResolvedValueOnce(ok(parentAccount)).mockResolvedValueOnce(ok(child));
      vi.mocked(ctx.importSessions.findById).mockResolvedValue(ok(createMockSession()));

      await operation.execute({
        blockchain: 'bitcoin',
        address: 'xpub6C...',
        providerName: 'mempool.space',
      });

      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'xpub6c...',
          providerName: 'mempool.space',
        })
      );
      expect(ctx.accounts.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentAccountId: 10,
          identifier: 'bc1q1...',
          providerName: 'mempool.space',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Abort
  // -------------------------------------------------------------------------

  describe('abort', () => {
    it('should abort streaming import when signal is triggered', async () => {
      setupSuccessfulImport();

      // Streaming mock that yields batches slowly
      blockchainStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [{ transactionHash: 'tx1' }],
          streamType: 'normal',
          cursor: { primary: { type: 'blockNumber', value: 1 }, totalFetched: 1 },
          isComplete: false,
        });
        yield okAsync({
          rawTransactions: [{ transactionHash: 'tx2' }],
          streamType: 'normal',
          cursor: { primary: { type: 'blockNumber', value: 2 }, totalFetched: 2 },
          isComplete: true,
        });
      });

      // Abort after first batch is saved
      vi.mocked(ctx.rawTransactions.createBatch).mockImplementation(() => {
        operation.abort();
        return ok({ inserted: 1, skipped: 0 });
      });

      const result = await operation.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('aborted');
    });
  });
});
