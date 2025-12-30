/* eslint-disable unicorn/no-null -- acceptable for tests */
import { ok, err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { NearReceiptEvent } from '../../../schemas.v2.js';
import { NearBlocksApiClientV2 } from '../nearblocks.api-client.v2.js';
import type { NearBlocksActivity, NearBlocksReceiptV2, NearBlocksTransactionV2 } from '../nearblocks.schemas.js';

describe('NearBlocksApiClientV2 streaming', () => {
  it('uses available balance when locked amount is present', async () => {
    const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks-v2');
    const client = new NearBlocksApiClientV2(config);

    const mockHttpGet = vi.fn(() =>
      Promise.resolve(
        ok({
          account: [
            {
              account_id: 'alice.near',
              amount: '1000000000000000000000000',
              locked: '250000000000000000000000',
              block_height: null,
              block_hash: null,
              code_hash: null,
              storage_paid_at: null,
              storage_usage: null,
              created: null,
              deleted: null,
            },
          ],
        })
      )
    );

    // @ts-expect-error override for test
    client.httpClient = { get: mockHttpGet };

    const result = await client.getAddressBalances({ address: 'alice.near' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.rawAmount).toBe('750000000000000000000000');
  });

  it('derives activity deltas when delta_nonstaked_amount is missing', async () => {
    const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks-v2');
    const client = new NearBlocksApiClientV2(config);

    const mockAddress = 'alice.near';
    const txHash = 'tx1';

    const mockTransaction: NearBlocksTransactionV2 = {
      actions: null,
      actions_agg: null,
      block: null,
      block_timestamp: '1640000000000000000',
      id: null,
      included_in_block_hash: null,
      outcomes: null,
      outcomes_agg: null,
      receipt_block: null,
      receipt_conversion_tokens_burnt: null,
      receipt_id: null,
      receipt_kind: null,
      receipt_outcome: null,
      receiver_account_id: 'bob.near',
      signer_account_id: mockAddress,
      transaction_hash: txHash,
      receipts: null,
    };

    const receiptBase: Omit<NearBlocksReceiptV2, 'receipt_id'> = {
      transaction_hash: txHash,
      predecessor_account_id: mockAddress,
      receiver_account_id: 'bob.near',
      receipt_kind: 'ACTION',
      receipt_block: {
        block_hash: 'blockhash',
        block_height: 1,
        block_timestamp: 1000,
      },
      receipt_outcome: {
        executor_account_id: 'bob.near',
        gas_burnt: '0',
        status: true,
        tokens_burnt: '0',
        logs: [],
      },
      actions: [],
    };

    const receiptsResponse = {
      txns: [
        { ...receiptBase, receipt_id: 'receipt1' },
        {
          ...receiptBase,
          receipt_id: 'receipt2',
          receipt_block: {
            block_hash: 'blockhash',
            block_height: 1,
            block_timestamp: 2000,
          },
        },
      ],
    };

    const activities: NearBlocksActivity[] = [
      {
        absolute_nonstaked_amount: '1000000000000000000000000',
        absolute_staked_amount: '0',
        affected_account_id: mockAddress,
        block_height: '1',
        block_timestamp: '1000',
        cause: 'TRANSFER',
        delta_nonstaked_amount: undefined,
        direction: 'INBOUND',
        event_index: '0',
        involved_account_id: 'bob.near',
        receipt_id: 'receipt1',
        transaction_hash: txHash,
      },
      {
        absolute_nonstaked_amount: '2000000000000000000000000',
        absolute_staked_amount: '0',
        affected_account_id: mockAddress,
        block_height: '2',
        block_timestamp: '2000',
        cause: 'TRANSFER',
        delta_nonstaked_amount: undefined,
        direction: 'INBOUND',
        event_index: '1',
        involved_account_id: 'bob.near',
        receipt_id: 'receipt2',
        transaction_hash: txHash,
      },
    ];

    const mockHttpGet = vi.fn((url: string) => {
      if (url.includes('/txns-only')) {
        return Promise.resolve(ok({ txns: [mockTransaction] }));
      }
      if (url.includes('/receipts')) {
        return Promise.resolve(ok(receiptsResponse));
      }
      if (url.includes('/activities')) {
        return Promise.resolve(ok({ activities }));
      }
      if (url.includes('/ft-txns')) {
        return Promise.resolve(ok({ txns: [] }));
      }
      return Promise.resolve(err(new Error(`Unexpected URL: ${url}`)));
    });

    // @ts-expect-error override for test
    client.httpClient = { get: mockHttpGet };

    const operation = { type: 'getAddressTransactions' as const, address: mockAddress };
    const allEvents: NearReceiptEvent[] = [];

    for await (const result of client.executeStreaming<NearReceiptEvent>(operation)) {
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        allEvents.push(...result.value.data.map((item) => item.normalized));
      }
    }

    expect(allEvents).toHaveLength(2);

    const first = allEvents.find((event) => event.receiptId === 'receipt1');
    const second = allEvents.find((event) => event.receiptId === 'receipt2');

    const firstChange = first?.balanceChanges?.[0];
    const secondChange = second?.balanceChanges?.[0];

    expect(firstChange).toBeDefined();
    expect(secondChange).toBeDefined();
    expect(firstChange?.postBalance).toBe('1000000000000000000000000');
    expect(firstChange?.preBalance).toBe('1000000000000000000000000');
    expect(secondChange?.postBalance).toBe('2000000000000000000000000');
    expect(secondChange?.preBalance).toBe('1000000000000000000000000');
  });
});
