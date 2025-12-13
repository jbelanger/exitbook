import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ClearService, TransactionProcessService } from '@exitbook/ingestion';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ProcessHandler } from '../process-handler.js';

describe('ProcessHandler', () => {
  let mockProcessService: TransactionProcessService;
  let mockClearService: ClearService;
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

    // Create handler instance
    processHandler = new ProcessHandler(mockProcessService, undefined, mockClearService);
  });

  describe('Resource Management', () => {
    test('should create providerManager during construction', () => {
      // The handler should be created successfully
      expect(processHandler).toBeDefined();
      expect(processHandler).toHaveProperty('destroy');
    });

    test('should cleanup provider manager on destroy', () => {
      // Get the private providerManager instance via reflection
      const providerManager = (processHandler as unknown as { providerManager: BlockchainProviderManager })
        .providerManager;
      expect(providerManager).toBeDefined();

      // Spy on the destroy method
      const destroySpy = vi.spyOn(providerManager, 'destroy');

      // Call destroy on handler
      processHandler.destroy();

      // Verify providerManager.destroy() was called
      expect(destroySpy).toHaveBeenCalledOnce();
    });

    test('should not throw when destroy is called multiple times', () => {
      // First destroy
      expect(() => processHandler.destroy()).not.toThrow();

      // Second destroy should also not throw
      expect(() => processHandler.destroy()).not.toThrow();
    });

    test('should have providerManager stored as instance variable', () => {
      // Verify the providerManager is stored on the instance (not just local variable)
      const providerManager = (processHandler as unknown as { providerManager: BlockchainProviderManager })
        .providerManager;
      expect(providerManager).toBeDefined();
      expect(providerManager).toHaveProperty('destroy');
      expect(providerManager).toHaveProperty('executeWithFailover');
    });
  });
});
