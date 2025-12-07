import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { BlockchainAdapter } from '../../infrastructure/blockchains/shared/blockchain-adapter.ts';
import type { ImportParams } from '../../types/importers.js';
import { normalizeBlockchainImportParams } from '../import-service-utils.js';

describe('import-service-utils', () => {
  describe('normalizeBlockchainImportParams', () => {
    it('should return error when address is missing', () => {
      const sourceName = 'bitcoin';
      const params: ImportParams = {};
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceName, params, adapter);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Address required');
      }
    });

    it('should normalize address successfully', () => {
      const sourceName = 'bitcoin';
      const params: ImportParams = { address: 'BC1Q...' };
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceName, params, adapter);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.address).toBe('bc1q...');
      }
    });

    it('should return error when normalization fails', () => {
      const sourceName = 'bitcoin';
      const params: ImportParams = { address: 'invalid-address' };
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: () => err(new Error('Invalid address format')),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceName, params, adapter);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Invalid address format');
      }
    });

    it('should preserve other params when normalizing address', () => {
      const sourceName = 'bitcoin';
      const params: ImportParams = {
        address: 'BC1Q...',
        providerName: 'blockstream',
      };
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceName, params, adapter);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.address).toBe('bc1q...');
        expect(result.value.providerName).toBe('blockstream');
      }
    });
  });
});
