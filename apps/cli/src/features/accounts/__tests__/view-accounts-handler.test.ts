import type { AccountService } from '@exitbook/ingestion';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewAccountsHandler } from '../view-accounts-handler.js';
import type { AccountInfo, ViewAccountsParams } from '../view-accounts-utils.js';

describe('ViewAccountsHandler', () => {
  let mockAccountService: AccountService;
  let handler: ViewAccountsHandler;
  let mockViewAccounts: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockViewAccounts = vi.fn();

    mockAccountService = {
      viewAccounts: mockViewAccounts,
    } as unknown as AccountService;

    handler = new ViewAccountsHandler(mockAccountService);
  });

  const createMockAccount = (): AccountInfo => ({
    id: 1,
    accountType: 'blockchain',
    sourceName: 'bitcoin',
    identifier: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    providerName: 'blockstream',
    lastBalanceCheckAt: '2024-01-01T00:00:00.000Z',
    verificationStatus: 'match',
    sessionCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
  });

  describe('execute', () => {
    it('should delegate to AccountService and return result', async () => {
      const mockResult = {
        accounts: [createMockAccount()],
        count: 1,
      };

      mockViewAccounts.mockResolvedValue(ok(mockResult));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(mockViewAccounts).toHaveBeenCalledWith({
        accountId: undefined,
        accountType: undefined,
        source: undefined,
        showSessions: undefined,
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(mockResult);
      }
    });

    it('should pass all params to service', async () => {
      const mockResult = {
        accounts: [createMockAccount()],
        count: 1,
      };

      mockViewAccounts.mockResolvedValue(ok(mockResult));

      const params: ViewAccountsParams = {
        accountId: 5,
        accountType: 'blockchain',
        source: 'bitcoin',
        showSessions: true,
      };
      await handler.execute(params);

      expect(mockViewAccounts).toHaveBeenCalledWith({
        accountId: 5,
        accountType: 'blockchain',
        source: 'bitcoin',
        showSessions: true,
      });
    });

    it('should return error from service', async () => {
      const error = new Error('Service failed');
      mockViewAccounts.mockResolvedValue(err(error));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Service failed');
      }
    });

    it('should handle empty results', async () => {
      const mockResult = {
        accounts: [],
        count: 0,
      };

      mockViewAccounts.mockResolvedValue(ok(mockResult));

      const params: ViewAccountsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.count).toBe(0);
        expect(result.value.accounts).toEqual([]);
      }
    });
  });

  describe('destroy', () => {
    it('should not throw error when called', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
