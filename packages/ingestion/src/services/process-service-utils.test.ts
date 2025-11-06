import type { DataSource, ExternalTransactionData } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  buildSessionProcessingQueue,
  extractUniqueDataSourceIds,
  filterSessionsWithPendingData,
  groupRawDataBySession,
  type SessionProcessingData,
} from './process-service-utils.ts';

describe('process-service-utils', () => {
  describe('groupRawDataBySession', () => {
    it('should group raw data by session ID', () => {
      const rawData: ExternalTransactionData[] = [
        {
          id: 1,
          dataSourceId: 10,
          providerId: 'blockstream',
          externalId: 'tx1',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 2,
          dataSourceId: 10,
          providerId: 'blockstream',
          externalId: 'tx2',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 3,
          dataSourceId: 20,
          providerId: 'blockstream',
          externalId: 'tx3',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
      ];

      const result = groupRawDataBySession(rawData);

      expect(result.size).toBe(2);
      const session10Data = result.get(10)!;
      const session20Data = result.get(20)!;
      expect(session10Data).toHaveLength(2);
      expect(session20Data).toHaveLength(1);
      expect(session10Data[0]!.externalId).toBe('tx1');
      expect(session10Data[1]!.externalId).toBe('tx2');
      expect(session20Data[0]!.externalId).toBe('tx3');
    });

    it('should skip items with null dataSourceId', () => {
      const rawData: ExternalTransactionData[] = [
        {
          id: 1,
          dataSourceId: 10,
          providerId: 'blockstream',
          externalId: 'tx1',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 2,
          dataSourceId: undefined as unknown as number,
          providerId: 'blockstream',
          externalId: 'tx2',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
      ];

      const result = groupRawDataBySession(rawData);

      expect(result.size).toBe(1);
      expect(result.get(10)).toHaveLength(1);
    });

    it('should return empty map for empty input', () => {
      const result = groupRawDataBySession([]);

      expect(result.size).toBe(0);
    });
  });

  describe('extractUniqueDataSourceIds', () => {
    it('should extract unique data source IDs', () => {
      const rawData: ExternalTransactionData[] = [
        {
          id: 1,
          dataSourceId: 10,
          providerId: 'blockstream',
          externalId: 'tx1',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 2,
          dataSourceId: 10,
          providerId: 'blockstream',
          externalId: 'tx2',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 3,
          dataSourceId: 20,
          providerId: 'blockstream',
          externalId: 'tx3',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
      ];

      const result = extractUniqueDataSourceIds(rawData);

      expect(result).toHaveLength(2);
      expect(result).toContain(10);
      expect(result).toContain(20);
    });

    it('should filter out null data source IDs', () => {
      const rawData: ExternalTransactionData[] = [
        {
          id: 1,
          dataSourceId: 10,
          providerId: 'blockstream',
          externalId: 'tx1',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
        {
          id: 2,
          dataSourceId: undefined as unknown as number,
          providerId: 'blockstream',
          externalId: 'tx2',
          rawData: {},
          normalizedData: {},
          processingStatus: 'pending',
          createdAt: new Date(),
        },
      ];

      const result = extractUniqueDataSourceIds(rawData);

      expect(result).toHaveLength(1);
      expect(result).toContain(10);
    });

    it('should return empty array for empty input', () => {
      const result = extractUniqueDataSourceIds([]);

      expect(result).toHaveLength(0);
    });
  });

  describe('filterSessionsWithPendingData', () => {
    it('should filter sessions with pending data', () => {
      const sessions: DataSource[] = [
        {
          id: 10,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          status: 'completed',
          startedAt: new Date(),
          createdAt: new Date(),
          importParams: {},
          importResultMetadata: {},
        },
        {
          id: 20,
          sourceId: 'ethereum',
          sourceType: 'blockchain',
          status: 'completed',
          startedAt: new Date(),
          createdAt: new Date(),
          importParams: {},
          importResultMetadata: {},
        },
        {
          id: 30,
          sourceId: 'solana',
          sourceType: 'blockchain',
          status: 'completed',
          startedAt: new Date(),
          createdAt: new Date(),
          importParams: {},
          importResultMetadata: {},
        },
      ];

      const rawDataBySession = new Map<number, ExternalTransactionData[]>([
        [
          10,
          [
            {
              id: 1,
              dataSourceId: 10,
              providerId: 'blockstream',
              externalId: 'tx1',
              rawData: {},
              normalizedData: {},
              processingStatus: 'pending',
              createdAt: new Date(),
            },
          ],
        ],
        [
          20,
          [
            {
              id: 2,
              dataSourceId: 20,
              providerId: 'alchemy',
              externalId: 'tx2',
              rawData: {},
              normalizedData: {},
              processingStatus: 'processed',
              createdAt: new Date(),
            },
          ],
        ],
      ]);

      const result = filterSessionsWithPendingData(sessions, rawDataBySession);

      expect(result).toHaveLength(1);
      expect(result[0]?.session.id).toBe(10);
      expect(result[0]?.rawDataItems).toHaveLength(1);
    });

    it('should filter by dataSourceId when provided', () => {
      const sessions: DataSource[] = [
        {
          id: 10,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          status: 'completed',
          startedAt: new Date(),
          createdAt: new Date(),
          importParams: {},
          importResultMetadata: {},
        },
        {
          id: 20,
          sourceId: 'ethereum',
          sourceType: 'blockchain',
          status: 'completed',
          startedAt: new Date(),
          createdAt: new Date(),
          importParams: {},
          importResultMetadata: {},
        },
      ];

      const rawDataBySession = new Map<number, ExternalTransactionData[]>([
        [
          10,
          [
            {
              id: 1,
              dataSourceId: 10,
              providerId: 'blockstream',
              externalId: 'tx1',
              rawData: {},
              normalizedData: {},
              processingStatus: 'pending',
              createdAt: new Date(),
            },
          ],
        ],
        [
          20,
          [
            {
              id: 2,
              dataSourceId: 20,
              providerId: 'alchemy',
              externalId: 'tx2',
              rawData: {},
              normalizedData: {},
              processingStatus: 'pending',
              createdAt: new Date(),
            },
          ],
        ],
      ]);

      const result = filterSessionsWithPendingData(sessions, rawDataBySession, { dataSourceId: 20 });

      expect(result).toHaveLength(1);
      expect(result[0]?.session.id).toBe(20);
    });

    it('should return empty array when no sessions have pending data', () => {
      const sessions: DataSource[] = [
        {
          id: 10,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          status: 'completed',
          startedAt: new Date(),
          createdAt: new Date(),
          importParams: {},
          importResultMetadata: {},
        },
      ];

      const rawDataBySession = new Map<number, ExternalTransactionData[]>([
        [
          10,
          [
            {
              id: 1,
              dataSourceId: 10,
              providerId: 'blockstream',
              externalId: 'tx1',
              rawData: {},
              normalizedData: {},
              processingStatus: 'processed',
              createdAt: new Date(),
            },
          ],
        ],
      ]);

      const result = filterSessionsWithPendingData(sessions, rawDataBySession);

      expect(result).toHaveLength(0);
    });
  });

  describe('buildSessionProcessingQueue', () => {
    it('should return sessions with raw data items', () => {
      const sessions: SessionProcessingData[] = [
        {
          session: {
            id: 10,
            sourceId: 'bitcoin',
            sourceType: 'blockchain',
            status: 'completed',
            startedAt: new Date(),
            createdAt: new Date(),
            importParams: {},
            importResultMetadata: {},
          },
          rawDataItems: [
            {
              id: 1,
              dataSourceId: 10,
              providerId: 'blockstream',
              externalId: 'tx1',
              rawData: {},
              normalizedData: {},
              processingStatus: 'pending',
              createdAt: new Date(),
            },
          ],
        },
        {
          session: {
            id: 20,
            sourceId: 'ethereum',
            sourceType: 'blockchain',
            status: 'completed',
            startedAt: new Date(),
            createdAt: new Date(),
            importParams: {},
            importResultMetadata: {},
          },
          rawDataItems: [],
        },
      ];

      const result = buildSessionProcessingQueue(sessions);

      expect(result).toHaveLength(1);
      expect(result[0]?.session.id).toBe(10);
    });

    it('should filter out sessions with no raw data items', () => {
      const sessions: SessionProcessingData[] = [
        {
          session: {
            id: 10,
            sourceId: 'bitcoin',
            sourceType: 'blockchain',
            status: 'completed',
            startedAt: new Date(),
            createdAt: new Date(),
            importParams: {},
            importResultMetadata: {},
          },
          rawDataItems: [],
        },
      ];

      const result = buildSessionProcessingQueue(sessions);

      expect(result).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      const result = buildSessionProcessingQueue([]);

      expect(result).toHaveLength(0);
    });
  });
});
