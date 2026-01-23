import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ClearService, TransactionProcessService } from '@exitbook/ingestion';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ProcessHandler } from '../process-handler.js';

describe('ProcessHandler', () => {
  let mockProcessService: TransactionProcessService;
  let mockClearService: ClearService;
  let mockProviderManager: BlockchainProviderManager;
  let processHandler: ProcessHandler;

  beforeEach(() => {
    // Mock the process service
    mockProcessService = {
      processAllPending: vi.fn().mockResolvedValue(ok({ processed: 0, errors: [], failed: 0 })),
      processAccountTransactions: vi.fn().mockResolvedValue(ok({ processed: 0, errors: [], failed: 0 })),
    } as unknown as TransactionProcessService;

    // Mock the clear service
    mockClearService = {
      execute: vi.fn().mockResolvedValue(
        ok({
          deleted: {
            accounts: 0,
            transactions: 0,
            links: 0,
            lots: 0,
            disposals: 0,
            calculations: 0,
            transfers: 0,
            sessions: 0,
            rawData: 0,
          },
        })
      ),
    } as unknown as ClearService;

    // Mock the provider manager
    mockProviderManager = {
      destroy: vi.fn(),
      executeWithFailover: vi.fn(),
    } as unknown as BlockchainProviderManager;

    // Create handler instance
    processHandler = new ProcessHandler(mockProcessService, mockProviderManager, mockClearService);
  });

  describe('Resource Management', () => {
    test('should accept providerManager during construction', () => {
      // The handler should be created successfully with injected dependencies
      expect(processHandler).toBeDefined();
      expect(processHandler).toHaveProperty('destroy');
    });

    test('should cleanup provider manager on destroy', () => {
      // Call destroy on handler
      processHandler.destroy();

      // Verify providerManager.destroy() was called
      // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
      expect(mockProviderManager.destroy).toHaveBeenCalledOnce();
    });

    test('should not throw when destroy is called multiple times', () => {
      // First destroy
      expect(() => processHandler.destroy()).not.toThrow();

      // Second destroy should also not throw
      expect(() => processHandler.destroy()).not.toThrow();
    });
  });
});
