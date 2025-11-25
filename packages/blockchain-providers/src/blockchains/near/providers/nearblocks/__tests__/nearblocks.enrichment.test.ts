import { ok, err, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import { NearBlocksApiClient } from '../nearblocks.api-client.js';
import type { NearBlocksActivity, NearBlocksReceipt } from '../nearblocks.schemas.js';

const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');

// Utility to build minimal receipt/activity objects that satisfy the schemas used in the code paths under test
function buildReceipt(transaction_hash: string, receipt_id: string): NearBlocksReceipt {
  return {
    block_timestamp: '1',
    transaction_hash,
    predecessor_account_id: 'alice.near',
    receipt_id,
    receiver_account_id: 'bob.near',
  };
}

function buildActivity(receipt_id: string, opts?: Partial<NearBlocksActivity>): NearBlocksActivity {
  return {
    absolute_nonstaked_amount: '10',
    absolute_staked_amount: '0',
    affected_account_id: 'alice.near',
    block_height: '1',
    block_timestamp: '1000000000',
    cause: 'TRANSFER',
    delta_nonstaked_amount: undefined,
    direction: 'INBOUND',
    event_index: '0',
    involved_account_id: undefined,
    receipt_id,
    transaction_hash: 'tx',
    ...(opts || {}),
  };
}

describe('NearBlocks enrichment pagination helpers', () => {
  it('fetchReceiptsForBatch paginates until batch coverage is reached', async () => {
    const client = new NearBlocksApiClient(config);

    const get = vi.fn(async (url: string) => {
      if (url.includes('page=1')) {
        const receipts = Array.from({ length: 25 }).map((_, i) => buildReceipt('txA', `rA-${i}`));
        return ok({ txns: receipts });
      }
      if (url.includes('page=2')) {
        const receipts = Array.from({ length: 10 }).map((_, i) => buildReceipt('txB', `rB-${i}`));
        return okAsync({ txns: receipts });
      }
      return err(new Error('unexpected page'));
    });

    // @ts-expect-error override for test
    client.httpClient = { get };

    // @ts-expect-error private helper under test
    const { receiptsByTxHash, truncated } = await client.fetchReceiptsForBatch({
      address: 'alice.near',
      startPage: 1,
      perPage: 25,
      txHashes: new Set(['txA', 'txB']),
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(receiptsByTxHash.get('txA')?.length).toBe(25);
    expect(receiptsByTxHash.get('txB')?.length).toBe(10);
    expect(truncated).toBe(false);
  });

  it('fetchActivitiesForBatch walks cursor pages until all receiptIds are covered', async () => {
    const client = new NearBlocksApiClient(config);

    const get = vi.fn(async (url: string) => {
      if (!url.includes('cursor')) {
        const activities = Array.from({ length: 25 }).map((_, i) => buildActivity('rA', { event_index: `${i}` }));
        return okAsync({ activities, cursor: 'cursor-1' });
      }
      if (url.includes('cursor-1')) {
        const activities = Array.from({ length: 5 }).map((_, i) => buildActivity('rB', { event_index: `${i}` }));
        return ok({ activities, cursor: 'cursor-2' });
      }
      return err(new Error('unexpected cursor'));
    });

    // @ts-expect-error override for test
    client.httpClient = { get };

    // @ts-expect-error private helper under test
    const { activitiesByReceiptId, nextCursor, truncated } = await client.fetchActivitiesForBatch({
      address: 'alice.near',
      perPage: 25,
      initialCursor: undefined,
      targetReceiptIds: new Set(['rA', 'rB']),
      previousBalances: new Map<string, bigint>(),
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(activitiesByReceiptId.get('rA')?.length).toBe(25);
    expect(activitiesByReceiptId.get('rB')?.length).toBe(5);
    expect(nextCursor).toBe('cursor-2');
    expect(truncated).toBe(false);
  });
});
