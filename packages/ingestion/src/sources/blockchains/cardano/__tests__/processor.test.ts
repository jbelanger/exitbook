import type { CardanoTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { CardanoTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'addr1quser1111111111111111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'addr1qexternal11111111111111111111111111111111111111111111111';

function createProcessor() {
  return new CardanoTransactionProcessor();
}

describe('CardanoTransactionProcessor', () => {
  test('incoming transfer - user receives ADA, does NOT pay fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000000,
        currency: 'ADA',
        feeAmount: '0.17', // Paid by sender
        feeCurrency: 'ADA',
        id: 'tx1abc',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2170000', // 2.17 ADA in lovelace
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev1',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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

  test('outgoing transfer - user sends ADA, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000001,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx2def',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2170000', // 2.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev2',
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA sent
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('2.17');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('self-transfer - user sends to own address, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000002,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx3ghi',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '5170000', // 5.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev3',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '5000000', // 5.0 ADA back to self
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('transfer with change - typical send pattern, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000003,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx4jkl',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '10170000', // 10.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev4',
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '3000000', // 3.0 ADA sent
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '7000000', // 7.0 ADA change
                unit: 'lovelace',
              },
            ],
            outputIndex: 1,
          },
        ],
        providerName: 'blockfrost',
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
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('transfer');

    // Outflows: full input amount, Inflows: change received
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('10.17');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('7');
  });

  test('multi-input transaction - user consolidates UTXOs, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000004,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx5mno',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '3000000', // 3.0 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev5a',
          },
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2170000', // 2.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 1,
            txHash: 'prev5b',
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '5000000', // 5.0 ADA sent
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('5.17');
  });

  test('multi-output deposit - user receives split UTXO, does NOT pay fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000005,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx6pqr',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '10170000', // 10.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev6',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '5000000', // 5.0 ADA to user
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '5000000', // 5.0 ADA to user
                unit: 'lovelace',
              },
            ],
            outputIndex: 1,
          },
        ],
        providerName: 'blockfrost',
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
    // Cardano consolidates multiple outputs of same asset
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('10');
  });

  test('multi-asset transaction - handles native tokens and ADA', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000006,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx7stu',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2170000', // 2.17 ADA
                unit: 'lovelace',
              },
              {
                quantity: '1000', // 1000 tokens
                unit: 'policy1.token1',
              },
            ],
            outputIndex: 0,
            txHash: 'prev7',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA
                unit: 'lovelace',
              },
              {
                quantity: '1000', // 1000 tokens
                unit: 'policy1.token1',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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

    // Multi-asset: ADA + native token
    expect(transaction.movements.inflows).toHaveLength(2);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('1000');
    expect(transaction.movements.inflows?.[1]?.grossAmount.toFixed()).toBe('2');
  });

  test('multi-asset with duplicate assets - consolidates correctly', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000007,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx8vwx',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '5170000', // 5.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev8',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '3000000', // 3.0 ADA (same asset, different output)
                unit: 'lovelace',
              },
            ],
            outputIndex: 1,
          },
        ],
        providerName: 'blockfrost',
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

    // Should consolidate duplicate ADA amounts
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('5');
  });

  test('multi-asset fee handling - fee only deducted from ADA', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000008,
        currency: 'ADA',
        feeAmount: '0.17', // Fee in ADA only
        feeCurrency: 'ADA',
        id: 'tx9xyz',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2170000', // 2.17 ADA
                unit: 'lovelace',
              },
              {
                quantity: '500', // 500 tokens
                unit: 'policy1.token1',
              },
            ],
            outputIndex: 0,
            txHash: 'prev9',
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA
                unit: 'lovelace',
              },
              {
                quantity: '500', // 500 tokens
                unit: 'policy1.token1',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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

    // Fee only on ADA
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.17');

    // Both assets transferred
    expect(transaction.movements.outflows).toHaveLength(2);
  });

  test('failed transaction - user still pays fee if they initiated', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000009,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx10abc',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2170000',
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev10',
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2000000',
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('processes multiple transactions independently', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000011,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx12a',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2170000',
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev12a',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2000000',
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
      {
        blockHeight: 9000012,
        currency: 'ADA',
        feeAmount: '0.20',
        feeCurrency: 'ADA',
        id: 'tx12b',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '5200000',
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev12b',
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '5000000',
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
        ],
        providerName: 'blockfrost',
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
    expect(secondFee?.amount.toFixed()).toBe('0.2');
    expect(transactions[1]?.movements.outflows).toHaveLength(1);
  });
});
