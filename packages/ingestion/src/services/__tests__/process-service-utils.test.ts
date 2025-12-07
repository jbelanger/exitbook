import type { ExternalTransactionData } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { extractUniqueAccountIds } from '../process-service-utils.js';

describe('process-service-utils', () => {
  describe('extractUniqueAccountIds', () => {
    it('should extract unique account IDs', () => {
      const rawData: ExternalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          providerName: 'blockstream',
          externalId: 'tx1',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 2,
          accountId: 1,
          providerName: 'blockstream',
          externalId: 'tx2',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 3,
          accountId: 2,
          providerName: 'blockstream',
          externalId: 'tx3',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
      ];

      const result = extractUniqueAccountIds(rawData);

      expect(result).toHaveLength(2);
      expect(result).toContain(1);
      expect(result).toContain(2);
    });

    it('should return empty array for empty input', () => {
      const result = extractUniqueAccountIds([]);

      expect(result).toHaveLength(0);
    });
  });
});
