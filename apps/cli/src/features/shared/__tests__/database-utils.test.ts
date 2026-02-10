/* eslint-disable @typescript-eslint/require-await -- Acceptable for tests */
import type { KyselyDB } from '@exitbook/data';
import * as dataModule from '@exitbook/data';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withDatabase } from '../database-utils.js';

// Mock the data module
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual('@exitbook/data');
  return {
    ...actual,
    initializeDatabase: vi.fn(),
    closeDatabase: vi.fn(),
  };
});

describe('database-utils', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('withDatabase', () => {
    it('should open database, execute function, and close database', async () => {
      const mockDatabase = { mock: 'database' } as unknown as KyselyDB;
      const initSpy = vi.mocked(dataModule.initializeDatabase).mockResolvedValue(mockDatabase);
      const closeSpy = vi.mocked(dataModule.closeDatabase).mockResolvedValue();

      const result = await withDatabase(async (db) => {
        expect(db).toBe(mockDatabase);
        return 'test-result';
      });

      expect(result).toBe('test-result');
      expect(initSpy).toHaveBeenCalledOnce();
      expect(closeSpy).toHaveBeenCalledWith(mockDatabase);
      expect(closeSpy).toHaveBeenCalledOnce();
    });

    it('should close database even if function throws', async () => {
      const mockDatabase = { mock: 'database' } as unknown as KyselyDB;
      vi.mocked(dataModule.initializeDatabase).mockResolvedValue(mockDatabase);
      const closeSpy = vi.mocked(dataModule.closeDatabase).mockResolvedValue();

      const testError = new Error('Test error');

      await expect(
        withDatabase(async () => {
          throw testError;
        })
      ).rejects.toThrow(testError);

      expect(closeSpy).toHaveBeenCalledWith(mockDatabase);
      expect(closeSpy).toHaveBeenCalledOnce();
    });

    it('should propagate the return value from the function', async () => {
      const mockDatabase = { mock: 'database' } as unknown as KyselyDB;
      vi.mocked(dataModule.initializeDatabase).mockResolvedValue(mockDatabase);
      vi.mocked(dataModule.closeDatabase).mockResolvedValue();

      const complexResult = { data: [1, 2, 3], count: 3 };
      const result = await withDatabase(async () => complexResult);

      expect(result).toEqual(complexResult);
    });
  });
});
