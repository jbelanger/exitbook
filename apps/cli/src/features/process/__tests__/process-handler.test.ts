import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { KyselyDB } from '@exitbook/data';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ProcessHandler } from '../process-handler.js';

describe('ProcessHandler', () => {
  let mockDatabase: KyselyDB;
  let processHandler: ProcessHandler;

  beforeEach(() => {
    // Mock the database
    mockDatabase = {} as KyselyDB;

    // Create handler instance
    processHandler = new ProcessHandler(mockDatabase);
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
