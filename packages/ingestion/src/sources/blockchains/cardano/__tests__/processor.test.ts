import type {
  CardanoTransaction,
  CardanoTransactionInput,
  CardanoTransactionOutput,
} from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { CardanoProcessor } from '../processor.js';

const USER_ADDRESS = 'addr1quser1111111111111111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'addr1qexternal11111111111111111111111111111111111111111111111';

function createProcessor() {
  return new CardanoProcessor();
}

function createInput(
  address: string,
  amounts: { quantity: string; unit: string }[] | string,
  unit = 'lovelace',
  overrides: Partial<CardanoTransactionInput> = {}
): CardanoTransactionInput {
  return {
    address,
    amounts: typeof amounts === 'string' ? [{ quantity: amounts, unit }] : amounts,
    outputIndex: 0,
    txHash: 'prev-tx',
    ...overrides,
  };
}

function createOutput(
  address: string,
  amounts: { quantity: string; unit: string }[] | string,
  unit = 'lovelace',
  overrides: Partial<CardanoTransactionOutput> = {}
): CardanoTransactionOutput {
  return {
    address,
    amounts: typeof amounts === 'string' ? [{ quantity: amounts, unit }] : amounts,
    outputIndex: 0,
    ...overrides,
  };
}

function createTransaction(overrides: Partial<CardanoTransaction> = {}): CardanoTransaction {
  return {
    blockHeight: 9000000,
    currency: 'ADA',
    eventId: '0xevent',
    feeAmount: '0.17',
    feeCurrency: 'ADA',
    id: 'tx-default',
    inputs: [createInput(EXTERNAL_ADDRESS, '2170000')],
    outputs: [createOutput(USER_ADDRESS, '2000000')],
    providerName: 'blockfrost',
    status: 'success',
    timestamp: Date.now(),
    ...overrides,
  } as CardanoTransaction;
}

describe('CardanoProcessor', () => {
  test('incoming transfer - user receives ADA, does NOT pay fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      createTransaction({
        id: 'tx1abc',
        eventId: '0xevent1abc',
        inputs: [createInput(EXTERNAL_ADDRESS, '2170000', 'lovelace', { txHash: 'prev1' })],
        outputs: [createOutput(USER_ADDRESS, '2000000')],
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
      createTransaction({
        blockHeight: 9000001,
        id: 'tx2def',
        inputs: [createInput(USER_ADDRESS, '2170000', 'lovelace', { txHash: 'prev2' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '2000000')],
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
      createTransaction({
        blockHeight: 9000002,
        id: 'tx3ghi',
        inputs: [createInput(USER_ADDRESS, '5170000', 'lovelace', { txHash: 'prev3' })],
        outputs: [createOutput(USER_ADDRESS, '5000000')],
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

    // Self-transfer: user paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('transfer with change - typical send pattern, pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      createTransaction({
        blockHeight: 9000003,
        id: 'tx4jkl',
        inputs: [createInput(USER_ADDRESS, '10170000', 'lovelace', { txHash: 'prev4' })],
        outputs: [
          createOutput(EXTERNAL_ADDRESS, '3000000'),
          createOutput(USER_ADDRESS, '7000000', 'lovelace', { outputIndex: 1 }),
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
      createTransaction({
        blockHeight: 9000004,
        id: 'tx5mno',
        inputs: [
          createInput(USER_ADDRESS, '3000000', 'lovelace', { txHash: 'prev5a' }),
          createInput(USER_ADDRESS, '2170000', 'lovelace', { outputIndex: 1, txHash: 'prev5b' }),
        ],
        outputs: [createOutput(EXTERNAL_ADDRESS, '5000000')],
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
      createTransaction({
        blockHeight: 9000005,
        id: 'tx6pqr',
        inputs: [createInput(EXTERNAL_ADDRESS, '10170000', 'lovelace', { txHash: 'prev6' })],
        outputs: [
          createOutput(USER_ADDRESS, '5000000'),
          createOutput(USER_ADDRESS, '5000000', 'lovelace', { outputIndex: 1 }),
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
      createTransaction({
        blockHeight: 9000006,
        id: 'tx7stu',
        inputs: [
          createInput(
            EXTERNAL_ADDRESS,
            [
              { quantity: '2170000', unit: 'lovelace' },
              { quantity: '1000', unit: 'policy1.token1' },
            ],
            'lovelace',
            { txHash: 'prev7' }
          ),
        ],
        outputs: [
          createOutput(USER_ADDRESS, [
            { quantity: '2000000', unit: 'lovelace' },
            { quantity: '1000', unit: 'policy1.token1' },
          ]),
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

    // Multi-asset: ADA + native token
    expect(transaction.movements.inflows).toHaveLength(2);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('1000');
    expect(transaction.movements.inflows?.[1]?.grossAmount.toFixed()).toBe('2');
  });

  test('multi-asset with duplicate assets - consolidates correctly', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      createTransaction({
        blockHeight: 9000007,
        id: 'tx8vwx',
        inputs: [createInput(EXTERNAL_ADDRESS, '5170000', 'lovelace', { txHash: 'prev8' })],
        outputs: [
          createOutput(USER_ADDRESS, '2000000'),
          createOutput(USER_ADDRESS, '3000000', 'lovelace', { outputIndex: 1 }),
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

    // Should consolidate duplicate ADA amounts
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('5');
  });

  test('multi-asset fee handling - fee only deducted from ADA', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      createTransaction({
        blockHeight: 9000008,
        id: 'tx9xyz',
        inputs: [
          createInput(
            USER_ADDRESS,
            [
              { quantity: '2170000', unit: 'lovelace' },
              { quantity: '500', unit: 'policy1.token1' },
            ],
            'lovelace',
            { txHash: 'prev9' }
          ),
        ],
        outputs: [
          createOutput(EXTERNAL_ADDRESS, [
            { quantity: '2000000', unit: 'lovelace' },
            { quantity: '500', unit: 'policy1.token1' },
          ]),
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

    // Fee only on ADA
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.17');

    // Both assets transferred
    expect(transaction.movements.outflows).toHaveLength(2);
  });

  test('failed transaction - user still pays fee if they initiated', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      createTransaction({
        blockHeight: 9000009,
        id: 'tx10abc',
        status: 'failed',
        inputs: [createInput(USER_ADDRESS, '2170000', 'lovelace', { txHash: 'prev10' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '2000000')],
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

    // User initiated (spent UTXO), so they paid the fee even though it failed
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('processes multiple transactions independently', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      createTransaction({
        blockHeight: 9000011,
        id: 'tx12a',
        inputs: [createInput(EXTERNAL_ADDRESS, '2170000', 'lovelace', { txHash: 'prev12a' })],
        outputs: [createOutput(USER_ADDRESS, '2000000')],
      }),
      createTransaction({
        blockHeight: 9000012,
        feeAmount: '0.20',
        id: 'tx12b',
        inputs: [createInput(USER_ADDRESS, '5200000', 'lovelace', { txHash: 'prev12b' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '5000000')],
      }),
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
