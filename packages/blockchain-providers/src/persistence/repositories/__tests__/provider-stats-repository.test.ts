import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProviderStatsDatabase, initializeProviderStatsDatabase, type ProviderStatsDB } from '../../database.js';
import type { ProviderStatsInput } from '../provider-stats-repository.js';
import { ProviderStatsRepository } from '../provider-stats-repository.js';

function makeInput(overrides: Partial<ProviderStatsInput> = {}): ProviderStatsInput {
  return {
    blockchain: 'ethereum',
    providerName: 'alchemy',
    avgResponseTime: 200,
    errorRate: 0.02,
    consecutiveFailures: 0,
    isHealthy: true,
    lastChecked: Date.now(),
    failureCount: 0,
    lastFailureTime: 0,
    lastSuccessTime: Date.now(),
    totalSuccesses: 50,
    totalFailures: 1,
    ...overrides,
  };
}

describe('ProviderStatsRepository', () => {
  let db: ProviderStatsDB;
  let repository: ProviderStatsRepository;

  beforeEach(async () => {
    const dbResult = createProviderStatsDatabase(':memory:');
    if (dbResult.isErr()) throw dbResult.error;
    db = dbResult.value;

    const migrationResult = await initializeProviderStatsDatabase(db);
    if (migrationResult.isErr()) throw migrationResult.error;

    repository = new ProviderStatsRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('upsert', () => {
    it('inserts a new row', async () => {
      const input = makeInput();
      const result = await repository.upsert(input);
      expect(result.isOk()).toBe(true);

      const getResult = await repository.get('ethereum', 'alchemy');
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        const row = getResult.value;
        expect(row).toBeDefined();
        expect(row!.blockchain).toBe('ethereum');
        expect(row!.provider_name).toBe('alchemy');
        expect(row!.avg_response_time).toBe(200);
        expect(row!.total_successes).toBe(50);
        expect(row!.is_healthy).toBe(1);
      }
    });

    it('updates existing row on conflict', async () => {
      await repository.upsert(makeInput({ totalSuccesses: 10 }));
      await repository.upsert(makeInput({ totalSuccesses: 99, avgResponseTime: 500 }));

      const getResult = await repository.get('ethereum', 'alchemy');
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value!.total_successes).toBe(99);
        expect(getResult.value!.avg_response_time).toBe(500);
      }
    });

    it('persists unhealthy state and last_error', async () => {
      await repository.upsert(
        makeInput({
          isHealthy: false,
          consecutiveFailures: 3,
          lastError: 'connection refused',
          failureCount: 3,
        })
      );

      const getResult = await repository.get('ethereum', 'alchemy');
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value!.is_healthy).toBe(0);
        expect(getResult.value!.consecutive_failures).toBe(3);
        expect(getResult.value!.last_error).toBe('connection refused');
      }
    });
  });

  describe('getAll', () => {
    it('returns empty array when no rows exist', async () => {
      const result = await repository.getAll();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns all rows', async () => {
      await repository.upsert(makeInput({ blockchain: 'ethereum', providerName: 'alchemy' }));
      await repository.upsert(makeInput({ blockchain: 'ethereum', providerName: 'infura' }));
      await repository.upsert(makeInput({ blockchain: 'bitcoin', providerName: 'blockstream' }));

      const result = await repository.getAll();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
      }
    });
  });

  describe('getByBlockchain', () => {
    it('returns only rows for the specified blockchain', async () => {
      await repository.upsert(makeInput({ blockchain: 'ethereum', providerName: 'alchemy' }));
      await repository.upsert(makeInput({ blockchain: 'ethereum', providerName: 'infura' }));
      await repository.upsert(makeInput({ blockchain: 'bitcoin', providerName: 'blockstream' }));

      const result = await repository.getByBlockchain('ethereum');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((r) => r.blockchain === 'ethereum')).toBe(true);
      }
    });

    it('returns empty array for unknown blockchain', async () => {
      const result = await repository.getByBlockchain('unknown');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('clear', () => {
    it('removes all rows', async () => {
      await repository.upsert(makeInput({ blockchain: 'ethereum', providerName: 'alchemy' }));
      await repository.upsert(makeInput({ blockchain: 'bitcoin', providerName: 'blockstream' }));

      const clearResult = await repository.clear();
      expect(clearResult.isOk()).toBe(true);

      const allResult = await repository.getAll();
      expect(allResult.isOk()).toBe(true);
      if (allResult.isOk()) {
        expect(allResult.value).toEqual([]);
      }
    });
  });
});
