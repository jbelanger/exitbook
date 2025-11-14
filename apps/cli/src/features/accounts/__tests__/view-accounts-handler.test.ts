import type { Account, DataSource } from '@exitbook/core';
import type { AccountRepository } from '@exitbook/data';
import type { DataSourceRepository } from '@exitbook/ingestion';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewAccountsHandler } from '../view-accounts-handler.js';
import type { ViewAccountsParams } from '../view-accounts-utils.js';

describe('ViewAccountsHandler', () => {
  let mockAccountRepo: AccountRepository;
  let mockDataSourceRepo: DataSourceRepository;
  let handler: ViewAccountsHandler;
  let mockFindAll: Mock;
  let mockFindById: Mock;
  let mockFindByAccount: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockFindAll = vi.fn();
    mockFindById = vi.fn();
    mockFindByAccount = vi.fn();

    mockAccountRepo = {
      findAll: mockFindAll,
      findById: mockFindById,
    } as unknown as AccountRepository;

    mockDataSourceRepo = {
      findByAccount: mockFindByAccount,
    } as unknown as DataSourceRepository;

    handler = new ViewAccountsHandler(mockAccountRepo, mockDataSourceRepo);
  });

  const createMockAccount = (overrides: Partial<Account> = {}): Account => ({
    id: 1,
    userId: undefined,
    accountType: 'blockchain',
    sourceName: 'bitcoin',
    identifier: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    providerName: 'blockstream',
    credentials: undefined,
    derivedAddresses: undefined,
    lastBalanceCheckAt: new Date('2024-01-01T00:00:00Z'),
    verificationMetadata: {
      current_balance: {},
      last_verification: {
        calculated_balance: {},
        status: 'match',
        verified_at: '2024-01-01T00:00:00Z',
      },
      source_params: {
        blockchain: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      },
    },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  });

  const createMockDataSource = (overrides: Partial<DataSource> = {}): DataSource => ({
    id: 1,
    accountId: 1,
    status: 'completed',
    startedAt: new Date('2024-01-01T00:00:00Z'),
    completedAt: new Date('2024-01-01T00:01:00Z'),
    durationMs: 60000,
    transactionsImported: 0,
    transactionsFailed: 0,
    importResultMetadata: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  });

  describe('execute', () => {
    it('should return all accounts when no filters provided', async () => {
      const mockAccounts: Account[] = [
        createMockAccount(),
        createMockAccount({
          id: 2,
          accountType: 'exchange-api',
          sourceName: 'kraken',
          identifier: 'apiKey123',
          providerName: undefined,
          verificationMetadata: {
            current_balance: {},
            last_verification: {
              calculated_balance: {},
              status: 'match',
              verified_at: '2024-01-01T00:00:00Z',
            },
            source_params: {
              exchange: 'kraken',
            },
          },
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockAccounts));
      mockFindByAccount.mockResolvedValue(ok([createMockDataSource()]));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.accounts).toHaveLength(2);
      expect(value.accounts[0]).toMatchObject({
        id: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        verificationStatus: 'match',
      });
    });

    it('should filter accounts by source name', async () => {
      const mockAccounts: Account[] = [createMockAccount({ sourceName: 'kraken' })];

      mockFindAll.mockResolvedValue(ok(mockAccounts));
      mockFindByAccount.mockResolvedValue(ok([]));

      const params: ViewAccountsParams = { source: 'kraken' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith({
        accountType: undefined,
        sourceName: 'kraken',
        userId: undefined,
      });
    });

    it('should filter accounts by account type', async () => {
      const mockAccounts: Account[] = [createMockAccount({ accountType: 'blockchain' })];

      mockFindAll.mockResolvedValue(ok(mockAccounts));
      mockFindByAccount.mockResolvedValue(ok([]));

      const params: ViewAccountsParams = { accountType: 'blockchain' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith({
        accountType: 'blockchain',
        sourceName: undefined,
        userId: undefined,
      });
    });

    it('should fetch specific account by ID', async () => {
      const mockAccount = createMockAccount({ id: 5 });

      mockFindById.mockResolvedValue(ok(mockAccount));
      mockFindByAccount.mockResolvedValue(ok([]));

      const params: ViewAccountsParams = { accountId: 5 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindById).toHaveBeenCalledWith(5);

      const value = result._unsafeUnwrap();
      expect(value.accounts).toHaveLength(1);
      expect(value.accounts[0]?.id).toBe(5);
    });

    it('should include session counts when not showing sessions', async () => {
      const mockAccount = createMockAccount();
      const mockSessions = [createMockDataSource({ id: 1 }), createMockDataSource({ id: 2 })];

      mockFindAll.mockResolvedValue(ok([mockAccount]));
      mockFindByAccount.mockResolvedValue(ok(mockSessions));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.accounts[0]?.sessionCount).toBe(2);
      expect(value.sessions).toBeUndefined();
    });

    it('should include session details when showSessions is true', async () => {
      const mockAccount = createMockAccount();
      const mockSessions = [
        createMockDataSource({ id: 1, status: 'completed' }),
        createMockDataSource({ id: 2, status: 'failed' }),
      ];

      mockFindAll.mockResolvedValue(ok([mockAccount]));
      mockFindByAccount.mockResolvedValue(ok(mockSessions));

      const params: ViewAccountsParams = { showSessions: true };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.sessions).toBeDefined();
      expect(value.sessions?.get(1)).toHaveLength(2);
      expect(value.sessions?.get(1)?.[0]).toMatchObject({
        id: 1,
        status: 'completed',
      });
    });

    it('should return empty array when no accounts found', async () => {
      mockFindAll.mockResolvedValue(ok([]));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(0);
      expect(value.accounts).toEqual([]);
    });

    it('should return error when repository fails', async () => {
      const error = new Error('Database connection failed');
      mockFindAll.mockResolvedValue(err(error));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database connection failed');
      }
    });

    it('should handle mismatch verification status', async () => {
      const mockAccount = createMockAccount({
        verificationMetadata: {
          current_balance: {},
          last_verification: {
            calculated_balance: {},
            status: 'mismatch',
            verified_at: '2024-01-01T00:00:00Z',
            discrepancies: [{ asset: 'BTC', calculated: '1.0', live: '0.5', difference: '-0.5' }],
          },
          source_params: {
            blockchain: 'bitcoin',
            address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          },
        },
      });

      mockFindAll.mockResolvedValue(ok([mockAccount]));
      mockFindByAccount.mockResolvedValue(ok([]));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.accounts[0]?.verificationStatus).toBe('mismatch');
    });
  });

  describe('destroy', () => {
    it('should not throw error when called', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
