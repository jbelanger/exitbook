import type { Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProviderStatsDatabase, initializeProviderStatsDatabase, type ProviderStatsDB } from '../../database.js';
import type { ProviderStatsInput } from '../provider-stats-queries.js';
import { createProviderStatsQueries, type ProviderStatsQueries } from '../provider-stats-queries.js';

function okValue<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

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

describe('ProviderStatsQueries', () => {
  let db: ProviderStatsDB;
  let queries: ProviderStatsQueries;

  beforeEach(async () => {
    const dbResult = createProviderStatsDatabase(':memory:');
    if (dbResult.isErr()) {
      throw dbResult.error;
    }
    db = dbResult.value;

    const migrationResult = await initializeProviderStatsDatabase(db);
    if (migrationResult.isErr()) {
      throw migrationResult.error;
    }

    queries = createProviderStatsQueries(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('upserts and reads a provider row', async () => {
    okValue(await queries.upsert(makeInput()));

    const row = okValue(await queries.get('ethereum', 'alchemy'));
    expect(row).toBeDefined();
    expect(row?.blockchain).toBe('ethereum');
    expect(row?.provider_name).toBe('alchemy');
    expect(row?.avg_response_time).toBe(200);
    expect(row?.total_successes).toBe(50);
    expect(row?.is_healthy).toBe(1);
  });

  it('updates existing rows on conflict', async () => {
    okValue(await queries.upsert(makeInput({ totalSuccesses: 10 })));
    okValue(await queries.upsert(makeInput({ totalSuccesses: 99, avgResponseTime: 500 })));

    const row = okValue(await queries.get('ethereum', 'alchemy'));
    expect(row?.total_successes).toBe(99);
    expect(row?.avg_response_time).toBe(500);
  });

  it('stores unhealthy state and last error', async () => {
    okValue(
      await queries.upsert(
        makeInput({
          isHealthy: false,
          consecutiveFailures: 3,
          lastError: 'connection refused',
          failureCount: 3,
        })
      )
    );

    const row = okValue(await queries.get('ethereum', 'alchemy'));
    expect(row?.is_healthy).toBe(0);
    expect(row?.consecutive_failures).toBe(3);
    expect(row?.last_error).toBe('connection refused');
  });

  it('lists all rows and filters by blockchain', async () => {
    okValue(await queries.upsert(makeInput({ blockchain: 'ethereum', providerName: 'alchemy' })));
    okValue(await queries.upsert(makeInput({ blockchain: 'ethereum', providerName: 'infura' })));
    okValue(await queries.upsert(makeInput({ blockchain: 'bitcoin', providerName: 'blockstream' })));

    const all = okValue(await queries.getAll());
    const ethereumOnly = okValue(await queries.getByBlockchain('ethereum'));
    const missingChain = okValue(await queries.getByBlockchain('unknown'));

    expect(all).toHaveLength(3);
    expect(ethereumOnly).toHaveLength(2);
    expect(ethereumOnly.every((row) => row.blockchain === 'ethereum')).toBe(true);
    expect(missingChain).toEqual([]);
  });

  it('clears all stored stats', async () => {
    okValue(await queries.upsert(makeInput({ blockchain: 'ethereum', providerName: 'alchemy' })));
    okValue(await queries.upsert(makeInput({ blockchain: 'bitcoin', providerName: 'blockstream' })));

    okValue(await queries.clear());

    const all = okValue(await queries.getAll());
    expect(all).toEqual([]);
  });
});
