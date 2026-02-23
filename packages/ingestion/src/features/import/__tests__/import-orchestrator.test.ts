/**
 * Tests for ImportOrchestrator
 *
 * Tests orchestration of user/account management and delegation to TransactionImportService,
 * with particular focus on xpub/HD wallet parent-child account creation
 */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, ImportSession } from '@exitbook/core';
import type { AccountQueries, ImportSessionQueries, RawDataQueries, UserQueries } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterRegistry } from '../../../shared/types/adapter-registry.js';
import { ImportOrchestrator } from '../import-orchestrator.js';

// Mock logger
vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock StreamingImportRunner (internal service)
const mockImportSession: ImportSession = {
  id: 1,
  accountId: 1,
  status: 'completed',
  startedAt: new Date(),
  completedAt: new Date(),
  transactionsImported: 10,
  transactionsSkipped: 0,
  createdAt: new Date(),
};

vi.mock('../import-service.js', () => ({
  StreamingImportRunner: vi.fn().mockImplementation(function () {
    return {
      importFromSource: vi.fn().mockResolvedValue(ok(mockImportSession)),
    };
  }),
}));

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

function createTestRegistry() {
  return new AdapterRegistry(
    [
      {
        blockchain: 'bitcoin',
        chainModel: 'utxo',
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        isExtendedPublicKey: (addr: string) => addr.startsWith('xpub') || addr.startsWith('ypub'),
        deriveAddressesFromXpub: mockDeriveAddressesResult,
        createImporter: vi.fn(),
        createProcessor: vi.fn(),
      },
      {
        blockchain: 'cardano',
        chainModel: 'utxo',
        normalizeAddress: (addr: string) => ok(addr),
        isExtendedPublicKey: (addr: string) =>
          addr.startsWith('stake') || addr.startsWith('xpub') || addr.startsWith('addr_xvk'),
        deriveAddressesFromXpub: mockDeriveAddressesResult,
        createImporter: vi.fn(),
        createProcessor: vi.fn(),
      },
      {
        blockchain: 'ethereum',
        chainModel: 'account-based',
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        createImporter: vi.fn(),
        createProcessor: vi.fn(),
      },
    ],
    []
  );
}

describe('ImportOrchestrator', () => {
  let orchestrator: ImportOrchestrator;
  let mockUserQueries: UserQueries;
  let mockAccountQueries: AccountQueries;
  let mockRawDataQueries: RawDataQueries;
  let mockImportSessionQueries: ImportSessionQueries;
  let mockProviderManager: BlockchainProviderManager;

  const mockUser = { id: 1, createdAt: new Date() };

  beforeEach(() => {
    mockUserQueries = {
      ensureDefaultUser: vi.fn().mockResolvedValue(ok(mockUser)),
    } as unknown as UserQueries;

    mockAccountQueries = {
      findOrCreate: vi.fn(),
      findByUniqueConstraint: vi.fn().mockResolvedValue(ok(undefined)),
      findAll: vi.fn().mockResolvedValue(ok([])),
      update: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as AccountQueries;

    mockRawDataQueries = {} as RawDataQueries;
    mockImportSessionQueries = {} as ImportSessionQueries;
    mockProviderManager = {} as BlockchainProviderManager;

    const registry = createTestRegistry();
    orchestrator = new ImportOrchestrator(
      mockUserQueries,
      mockAccountQueries,
      mockRawDataQueries,
      mockImportSessionQueries,
      mockProviderManager,
      registry
    );

    // Reset derive addresses mock
    mockDeriveAddresses.mockReset();
    mockDeriveAddressesResult.mockClear();
  });

  describe('importBlockchain - regular address', () => {
    it('should create account for regular address and import', async () => {
      const mockAccount: Account = {
        id: 1,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
        createdAt: new Date(),
      };

      vi.mocked(mockAccountQueries.findOrCreate).mockResolvedValue(ok(mockAccount));

      const result = await orchestrator.importBlockchain('bitcoin', 'bc1q...');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Regular address returns single ImportSession
        expect(Array.isArray(result.value)).toBe(false);
        const session = result.value as ImportSession;
        expect(session.transactionsImported).toBe(10);
        expect(session.id).toBe(1);
      }

      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledWith({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
        providerName: undefined,
        credentials: undefined,
      });
    });

    it('should warn if xpubGap provided for non-xpub address', async () => {
      const mockAccount: Account = {
        id: 1,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
        createdAt: new Date(),
      };

      vi.mocked(mockAccountQueries.findOrCreate).mockResolvedValue(ok(mockAccount));

      // Logger is mocked, so we can't verify the warning directly,
      // but we can verify the import still succeeds
      const result = await orchestrator.importBlockchain('bitcoin', 'bc1q...', undefined, 20);

      expect(result.isOk()).toBe(true);
    });
  });

  describe('importBlockchain - xpub parent/child creation', () => {
    it('should create parent account and child accounts for xpub', async () => {
      const parentAccount: Account = {
        id: 10,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6C...',
        createdAt: new Date(),
      };

      const childAccount1: Account = {
        id: 11,
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q1...',
        createdAt: new Date(),
      };

      const childAccount2: Account = {
        id: 12,
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q2...',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([
        { address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" },
        { address: 'bc1q2...', derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      vi.mocked(mockAccountQueries.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(ok(childAccount1))
        .mockResolvedValueOnce(ok(childAccount2));

      const result = await orchestrator.importBlockchain('bitcoin', 'xpub6C...');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Xpub returns array of ImportSessions
        expect(Array.isArray(result.value)).toBe(true);
        const sessions = result.value as ImportSession[];
        expect(sessions).toHaveLength(2); // 2 child accounts
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        expect(totalImported).toBe(20); // 2 child accounts * 10 txs each
      }

      // Verify parent account creation
      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledWith({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6c...',
        providerName: undefined,
        credentials: undefined,
      });

      // Verify child account creation with parentAccountId
      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledWith({
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q1...',
        providerName: undefined,
        credentials: undefined,
      });

      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledWith({
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q2...',
        providerName: undefined,
        credentials: undefined,
      });

      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledTimes(3); // 1 parent + 2 children
    });

    it('should respect custom xpubGap when deriving addresses', async () => {
      const parentAccount: Account = {
        id: 10,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6C...',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([{ address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" }]);

      vi.mocked(mockAccountQueries.findOrCreate).mockResolvedValue(ok(parentAccount));

      await orchestrator.importBlockchain('bitcoin', 'xpub6C...', undefined, 5);

      // Verify xpubGap was passed to deriveAddressesFromXpub
      expect(mockDeriveAddresses).toHaveBeenCalledWith('xpub6c...', mockProviderManager, 'bitcoin', 5);
    });

    it('should handle Cardano xpub addresses', async () => {
      const parentAccount: Account = {
        id: 20,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'cardano',
        identifier: 'stake1u...',
        createdAt: new Date(),
      };

      const childAccount: Account = {
        id: 21,
        userId: 1,
        parentAccountId: 20,
        accountType: 'blockchain',
        sourceName: 'cardano',
        identifier: 'addr1q...',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([{ address: 'addr1q...', derivationPath: "m/1852'/1815'/0'/0/0" }]);

      vi.mocked(mockAccountQueries.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(ok(childAccount));

      const result = await orchestrator.importBlockchain('cardano', 'stake1u...');

      expect(result.isOk()).toBe(true);
      expect(mockDeriveAddresses).toHaveBeenCalledWith('stake1u...', mockProviderManager, 'cardano', 20);
      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledTimes(2); // 1 parent + 1 child
    });

    it('should return success with 0 transactions if xpub derivation produces zero addresses', async () => {
      const parentAccount: Account = {
        id: 10,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6C...',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([]); // No addresses derived (no activity found)

      vi.mocked(mockAccountQueries.findOrCreate).mockResolvedValue(ok(parentAccount));

      const result = await orchestrator.importBlockchain('bitcoin', 'xpub6C...');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // No addresses derived means empty array
        expect(Array.isArray(result.value)).toBe(true);
        const sessions = result.value as ImportSession[];
        expect(sessions).toHaveLength(0);
      }

      // Should have created parent but not child accounts or called import
      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledTimes(1);
    });

    it('should fail fast if any child import fails', async () => {
      const parentAccount: Account = {
        id: 10,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6C...',
        createdAt: new Date(),
      };

      const childAccount1: Account = {
        id: 11,
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q1...',
        createdAt: new Date(),
      };

      const childAccount2: Account = {
        id: 12,
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q2...',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([
        { address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" },
        { address: 'bc1q2...', derivationPath: "m/84'/0'/0'/0/1" },
      ]);

      vi.mocked(mockAccountQueries.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(ok(childAccount1))
        .mockResolvedValueOnce(ok(childAccount2));

      // Mock import service to fail on first child, succeed on second
      const mockImportExecutor = (
        orchestrator as unknown as { importExecutor: { importFromSource: ReturnType<typeof vi.fn> } }
      ).importExecutor;

      const successSession: ImportSession = {
        id: 2,
        accountId: 12,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        transactionsImported: 10,
        transactionsSkipped: 0,
        createdAt: new Date(),
      };

      vi.mocked(mockImportExecutor.importFromSource)
        .mockResolvedValueOnce(err(new Error('Network timeout')))
        .mockResolvedValueOnce(ok(successSession));

      const result = await orchestrator.importBlockchain('bitcoin', 'xpub6C...');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network timeout');
      }
    });

    it('should return error if all child imports fail', async () => {
      const parentAccount: Account = {
        id: 10,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6C...',
        createdAt: new Date(),
      };

      const childAccount: Account = {
        id: 11,
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q1...',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([{ address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" }]);

      vi.mocked(mockAccountQueries.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(ok(childAccount));

      // Mock import service to fail
      const mockImportExecutor = (
        orchestrator as unknown as { importExecutor: { importFromSource: ReturnType<typeof vi.fn> } }
      ).importExecutor;
      vi.mocked(mockImportExecutor.importFromSource).mockResolvedValue(err(new Error('Provider unavailable')));

      const result = await orchestrator.importBlockchain('bitcoin', 'xpub6C...');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to import child account');
      }
    });

    it('should pass providerName to parent and child accounts', async () => {
      const parentAccount: Account = {
        id: 10,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6C...',
        providerName: 'mempool.space',
        createdAt: new Date(),
      };

      const childAccount: Account = {
        id: 11,
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q1...',
        providerName: 'mempool.space',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([{ address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" }]);

      vi.mocked(mockAccountQueries.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(ok(childAccount));

      await orchestrator.importBlockchain('bitcoin', 'xpub6C...', 'mempool.space');

      // Verify providerName passed to parent
      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledWith({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6c...',
        providerName: 'mempool.space',
        credentials: undefined,
      });

      // Verify providerName passed to child
      expect(mockAccountQueries.findOrCreate).toHaveBeenCalledWith({
        userId: 1,
        parentAccountId: 10,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q1...',
        providerName: 'mempool.space',
        credentials: undefined,
      });
    });
  });

  describe('importBlockchain - error cases', () => {
    it('should return error for unknown blockchain', async () => {
      const result = await orchestrator.importBlockchain('unknown-chain', 'some-address');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unknown blockchain: unknown-chain');
      }
    });

    it('should handle user creation failure', async () => {
      vi.mocked(mockUserQueries.ensureDefaultUser).mockResolvedValue(err(new Error('User creation failed')));

      const result = await orchestrator.importBlockchain('bitcoin', 'bc1q...');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('User creation failed');
      }
    });

    it('should handle parent account creation failure for xpub', async () => {
      mockDeriveAddresses.mockResolvedValue([{ address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" }]);

      vi.mocked(mockAccountQueries.findOrCreate).mockResolvedValue(err(new Error('Database error')));

      const result = await orchestrator.importBlockchain('bitcoin', 'xpub6C...');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database error');
      }
    });

    it('should handle child account creation failure for xpub', async () => {
      const parentAccount: Account = {
        id: 10,
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'xpub6C...',
        createdAt: new Date(),
      };

      mockDeriveAddresses.mockResolvedValue([{ address: 'bc1q1...', derivationPath: "m/84'/0'/0'/0/0" }]);

      vi.mocked(mockAccountQueries.findOrCreate)
        .mockResolvedValueOnce(ok(parentAccount))
        .mockResolvedValueOnce(err(new Error('Child account creation failed')));

      const result = await orchestrator.importBlockchain('bitcoin', 'xpub6C...');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Child account creation failed');
      }
    });
  });
});
