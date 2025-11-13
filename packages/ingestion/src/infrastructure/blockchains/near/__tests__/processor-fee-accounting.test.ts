import type { NearTransaction } from '@exitbook/blockchain-providers';
import { ok } from 'neverthrow';
import { describe, expect, test } from 'vitest';
import { vi } from 'vitest';

import type { ITokenMetadataService } from '../../../../services/token-metadata/token-metadata-service.interface.js';
import { NearTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'user.near';
const EXTERNAL_ADDRESS = 'external.near';
const CONTRACT_ADDRESS = 'token.near';

function createProcessor() {
  const mockTokenMetadataService = {
    enrichBatch: vi.fn().mockResolvedValue(ok()),
    getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as ITokenMetadataService;

  return new NearTransactionProcessor(mockTokenMetadataService);
}

function buildNearTx(overrides: Partial<NearTransaction> = {}): NearTransaction {
  return {
    amount: '0',
    currency: 'NEAR',
    from: USER_ADDRESS,
    id: 'test-tx',
    providerName: 'nearblocks',
    status: 'success',
    timestamp: Date.now(),
    to: EXTERNAL_ADDRESS,
    type: 'transfer',
    ...overrides,
  };
}

describe('NearTransactionProcessor - Fee Accounting (Issue #78)', () => {
  test('deducts fee when user sends NEAR (outgoing transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: NearTransaction[] = [
      buildNearTx({
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000000000000000000', // 0.5 NEAR
            preBalance: '2500100000000000000000000', // 2.5001 NEAR (includes fee)
          },
        ],
        amount: '2000000000000000000000000',
        feeAmount: '0.0001', // 100,000,000,000,000,000,000 yoctoNEAR
        feeCurrency: 'NEAR',
        id: 'tx1abc',
      }),
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User spent their NEAR (outgoing), so they paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('2.0001');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('does NOT deduct fee when user receives NEAR (incoming transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: NearTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000000000000000000', // 2 NEAR
            preBalance: '0',
          },
        ],
        amount: '2000000000000000000000000',
        currency: 'NEAR',
        feeAmount: '0.0001', // Fee paid by sender
        feeCurrency: 'NEAR',
        from: EXTERNAL_ADDRESS,
        id: 'tx2def',
        providerName: 'nearblocks',
        type: 'transfer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User received NEAR, so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('2');
    expect(transaction.movements.inflows?.[0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('records fee when outflow equals fee (fee-only transaction)', async () => {
    const processor = createProcessor();

    const normalizedData: NearTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '999900000000000000000000', // Balance minus fee only
            preBalance: '1000000000000000000000000',
          },
        ],
        actions: [
          {
            actionType: 'FunctionCall',
            gas: '30000000000000',
            methodName: 'some_method',
          },
        ],
        amount: '0',
        currency: 'NEAR',
        feeAmount: '0.0001',
        feeCurrency: 'NEAR',
        from: USER_ADDRESS,
        id: 'tx3ghi',
        providerName: 'nearblocks',
        type: 'transfer',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Fee-only transaction: outflow was absorbed, so explicit fee entry recorded
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.0001');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('fee');
  });

  test('handles multi-asset transaction with NEAR fee', async () => {
    const processor = createProcessor();

    const normalizedData: NearTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '999900000000000000000000', // Decreased by fee
            preBalance: '1000000000000000000000000',
          },
        ],
        actions: [
          {
            actionType: 'FunctionCall',
            gas: '30000000000000',
            methodName: 'ft_transfer',
          },
        ],
        amount: '0',
        currency: 'NEAR',
        feeAmount: '0.0001',
        feeCurrency: 'NEAR',
        from: USER_ADDRESS,
        id: 'tx4jkl',
        providerName: 'nearblocks',
        type: 'transfer',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenTransfers: [
          {
            amount: '1000000', // 1 USDC
            contractAddress: CONTRACT_ADDRESS,
            decimals: 6,
            from: USER_ADDRESS,
            symbol: 'USDC',
            to: EXTERNAL_ADDRESS,
          },
        ],
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User sent token and paid NEAR fee
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.0001');
    expect(transaction.fees[0]?.asset.toString()).toBe('NEAR');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.asset.toString()).toBe('USDC');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('1');
  });

  test('handles NEAR outflow larger than fee', async () => {
    const processor = createProcessor();

    const normalizedData: NearTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '97999900000000000000000000', // Lost 2.0001 NEAR total
            preBalance: '100000000000000000000000000',
          },
        ],
        amount: '2000000000000000000000000',
        currency: 'NEAR',
        feeAmount: '0.0001',
        feeCurrency: 'NEAR',
        from: USER_ADDRESS,
        id: 'tx5mno',
        providerName: 'nearblocks',
        type: 'transfer',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Outflow is larger than fee, so fee is deducted from outflow
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.0001');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('2.0001');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('2');
  });

  test('handles zero fee transaction', async () => {
    const processor = createProcessor();

    const normalizedData: NearTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000000000000000000',
            preBalance: '0',
          },
        ],
        amount: '2000000000000000000000000',
        currency: 'NEAR',
        feeAmount: '0',
        feeCurrency: 'NEAR',
        from: EXTERNAL_ADDRESS,
        id: 'tx6pqr',
        providerName: 'nearblocks',
        type: 'transfer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Zero fee, no fee entry
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.netAmount?.toFixed()).toBe('2');
  });
});
