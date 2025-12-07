import type { BitcoinTransaction } from '@exitbook/blockchain-providers';
import { getBitcoinChainConfig } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { BitcoinTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'bc1quser1111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'bc1qexternal111111111111111111111111111';
const ANOTHER_EXTERNAL = 'bc1qanother222222222222222222222222222';

function createProcessor() {
  const chainConfig = getBitcoinChainConfig('bitcoin');
  if (!chainConfig) {
    throw new Error('Bitcoin chain config not found');
  }
  return new BitcoinTransactionProcessor(chainConfig);
}

describe('BitcoinTransactionProcessor', () => {
  test('incoming transfer - user receives BTC, does NOT pay fee', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800000,
        currency: 'BTC',
        feeAmount: '0.0001', // Paid by sender
        feeCurrency: 'BTC',
        id: 'tx1abc',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev1',
            value: '200010000', // 2.0001 BTC in satoshis
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            index: 0,
            value: '200000000', // 2.0 BTC received
          },
        ],
        providerName: 'blockstream.info',
        status: 'success',
        timestamp: Date.now(),
      },
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

    // User did NOT spend UTXOs, so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('2');
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('outgoing transfer - user sends BTC, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800001,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx2def',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev2',
            value: '100010000', // 1.0001 BTC in satoshis
            vout: 0,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '100000000', // 1.0 BTC sent
          },
        ],
        providerName: 'mempool.space',
        status: 'success',
        timestamp: Date.now(),
      },
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

    // User spent their UTXO, so they paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('1.0001');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('self-transfer - user sends to own address, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800002,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx3ghi',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev3',
            value: '50010000', // 0.5001 BTC
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            index: 0,
            value: '50000000', // 0.5 BTC back to self
          },
        ],
        providerName: 'blockchain.com',
        status: 'success',
        timestamp: Date.now(),
      },
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

    // Self-transfer: user paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('transfer with change - typical send pattern, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800003,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx4jkl',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev4',
            value: '100010000', // 1.0001 BTC
            vout: 0,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '30000000', // 0.3 BTC sent
          },
          {
            address: USER_ADDRESS,
            index: 1,
            value: '70000000', // 0.7 BTC change back to user
          },
        ],
        providerName: 'blockstream.info',
        status: 'success',
        timestamp: Date.now(),
      },
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

    // User spent UTXO, so they paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('transfer');

    // Net outflow: 1.0001 - 0.7 = 0.3001 BTC (0.3 sent + 0.0001 fee)
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('0.3001');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('0.7');
  });

  test('multi-input transaction - user consolidates UTXOs, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800004,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx5mno',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev5a',
            value: '30000000', // 0.3 BTC
            vout: 0,
          },
          {
            address: USER_ADDRESS,
            txid: 'prev5b',
            value: '20010000', // 0.2001 BTC
            vout: 1,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '50000000', // 0.5 BTC sent
          },
        ],
        providerName: 'mempool.space',
        status: 'success',
        timestamp: Date.now(),
      },
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

    // User spent multiple UTXOs, so they paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('0.5001');
  });

  test('multi-output deposit - user receives split UTXO, does NOT pay fee', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800005,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx6pqr',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev6',
            value: '100010000', // 1.0001 BTC
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            index: 0,
            value: '50000000', // 0.5 BTC to user
          },
          {
            address: USER_ADDRESS,
            index: 1,
            value: '50000000', // 0.5 BTC to user
          },
        ],
        providerName: 'blockchain.com',
        status: 'success',
        timestamp: Date.now(),
      },
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

    // User did NOT spend UTXOs, so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.operation.type).toBe('transfer');
    // Bitcoin consolidates multiple outputs of same asset to same address
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('1');
  });

  test('failed transaction - user still pays fee if they initiated', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800007,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx8vwx',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev8',
            value: '100010000',
            vout: 0,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '100000000',
          },
        ],
        providerName: 'mempool.space',
        status: 'failed',
        timestamp: Date.now(),
      },
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

    // User initiated (spent UTXO), so they paid the fee even though it failed
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('processes multiple transactions independently', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800009,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx10a',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev10a',
            value: '100010000',
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            index: 0,
            value: '100000000',
          },
        ],
        providerName: 'blockstream.info',
        status: 'success',
        timestamp: Date.now(),
      },
      {
        blockHeight: 800010,
        currency: 'BTC',
        feeAmount: '0.0002',
        feeCurrency: 'BTC',
        id: 'tx10b',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev10b',
            value: '50020000',
            vout: 0,
          },
        ],
        outputs: [
          {
            address: ANOTHER_EXTERNAL,
            index: 0,
            value: '50000000',
          },
        ],
        providerName: 'mempool.space',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    // First transaction: incoming, no fee
    expect(transactions[0]?.fees).toHaveLength(0);
    expect(transactions[0]?.movements.inflows).toHaveLength(1);

    // Second transaction: outgoing, pays fee
    const secondFee = transactions[1]?.fees.find((f) => f.scope === 'network');
    expect(secondFee?.amount.toFixed()).toBe('0.0002');
    expect(transactions[1]?.movements.outflows).toHaveLength(1);
  });
});
