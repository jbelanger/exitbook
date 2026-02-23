import type { XrpTransaction } from '@exitbook/blockchain-providers';
import { getXrpChainConfig } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { XrpProcessor } from '../processor.js';

const USER_ADDRESS = 'rN7n7otQDd6FczFgLdhmKRAWNZDy7g4EAZ';
const EXTERNAL_ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';
const ANOTHER_EXTERNAL = 'rLHzPsX6oXkzU9fhRk7E4bR7hWj7YpXpqQ';

function createProcessor() {
  const chainConfig = getXrpChainConfig('xrp');
  if (!chainConfig) {
    throw new Error('XRP chain config not found');
  }
  return new XrpProcessor(chainConfig);
}

function createTransaction(overrides: Partial<XrpTransaction> = {}): XrpTransaction {
  return {
    id: 'tx-default',
    eventId: '0xdefaulteventid',
    account: EXTERNAL_ADDRESS,
    currency: 'XRP',
    feeAmount: '0.000012',
    feeCurrency: 'XRP',
    ledgerIndex: 12345678,
    providerName: 'xrpl-rpc',
    sequence: 1,
    status: 'success',
    timestamp: 1700000000,
    transactionType: 'Payment',
    ...overrides,
  };
}

describe('XrpProcessor', () => {
  test('incoming transfer - user receives XRP, does NOT pay fee', async () => {
    const processor = createProcessor();

    const normalizedData: XrpTransaction[] = [
      createTransaction({
        id: 'tx1abc',
        account: EXTERNAL_ADDRESS,
        destination: USER_ADDRESS,
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '102',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT send, so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('2');
    expect(transaction.movements.inflows?.[0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('outgoing transfer - user sends XRP, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: XrpTransaction[] = [
      createTransaction({
        id: 'tx2def',
        account: USER_ADDRESS,
        destination: EXTERNAL_ADDRESS,
        feeAmount: '0.000012',
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '98',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User sent XRP, so they paid the fee
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees?.[0]?.amount.toFixed()).toBe('0.000012');
    expect(transaction.fees?.[0]?.scope).toBe('network');
    expect(transaction.fees?.[0]?.settlement).toBe('balance');

    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('1.999988');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('1.999988');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('transaction with no balance change for wallet', async () => {
    const processor = createProcessor();

    const normalizedData: XrpTransaction[] = [
      createTransaction({
        id: 'tx3ghi',
        account: EXTERNAL_ADDRESS,
        transactionType: 'TrustSet',
        balanceChanges: [
          {
            account: EXTERNAL_ADDRESS,
            balance: '100',
            currency: 'XRP',
            previousBalance: '100.000012',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // External transaction with no balance change for wallet should be filtered out
    // (no accounting impact on the wallet)
    expect(result.value).toHaveLength(0);
  });

  test('multiple transactions in batch', async () => {
    const processor = createProcessor();

    const normalizedData: XrpTransaction[] = [
      createTransaction({
        id: 'tx4jkl',
        account: EXTERNAL_ADDRESS,
        destination: USER_ADDRESS,
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '101',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
      }),
      createTransaction({
        id: 'tx5mno',
        account: USER_ADDRESS,
        destination: ANOTHER_EXTERNAL,
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '99.5',
            currency: 'XRP',
            previousBalance: '101',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);

    // First transaction (incoming)
    const tx1 = result.value[0];
    expect(tx1?.movements.inflows).toHaveLength(1);
    expect(tx1?.movements.outflows).toHaveLength(0);
    expect(tx1?.fees).toHaveLength(0);

    // Second transaction (outgoing)
    const tx2 = result.value[1];
    expect(tx2?.movements.outflows).toHaveLength(1);
    expect(tx2?.movements.inflows).toHaveLength(0);
    expect(tx2?.fees).toHaveLength(1);
  });

  test('handles failed transactions', async () => {
    const processor = createProcessor();

    const normalizedData: XrpTransaction[] = [
      createTransaction({
        id: 'tx6pqr',
        account: USER_ADDRESS,
        destination: EXTERNAL_ADDRESS,
        status: 'failed',
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '100',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Failed transaction with no balance change should be filtered out
    // (no accounting impact - no fee was actually charged)
    expect(result.value).toHaveLength(0);
  });

  test('constructs correct blockchain metadata', async () => {
    const processor = createProcessor();

    const normalizedData: XrpTransaction[] = [
      createTransaction({
        id: 'tx7stu',
        account: EXTERNAL_ADDRESS,
        destination: USER_ADDRESS,
        ledgerIndex: 87654321,
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '101',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.blockchain).toBeDefined();
    expect(transaction?.blockchain?.name).toBe('xrp');
    expect(transaction?.blockchain?.block_height).toBe(87654321);
    expect(transaction?.blockchain?.transaction_hash).toBe('tx7stu');
    expect(transaction?.blockchain?.is_confirmed).toBe(true);
  });
});
