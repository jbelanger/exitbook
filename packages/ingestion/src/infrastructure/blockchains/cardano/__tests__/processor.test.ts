import type { CardanoTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { CardanoTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'addr1qyuser111111111111111111111111111111111111111111111111111111';
const DERIVED_ADDRESS_1 = 'addr1qyderived1111111111111111111111111111111111111111111111111';
const DERIVED_ADDRESS_2 = 'addr1qyderived2222222222222222222222222222222222222222222222';
const EXTERNAL_ADDRESS = 'addr1qyexternal11111111111111111111111111111111111111111111111111';

function createProcessor() {
  return new CardanoTransactionProcessor();
}

describe('CardanoTransactionProcessor - Fund Flow Direction', () => {
  test('classifies incoming ADA transfer as deposit', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000000,
        currency: 'ADA',
        feeAmount: '0.17',
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
            index: 0,
            txId: 'prev1',
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
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.asset).toBe('ADA');
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');

    // User did NOT spend UTXOs, so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
  });

  test('classifies outgoing ADA transfer as withdrawal', async () => {
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
                quantity: '2170000', // 2.17 ADA in lovelace
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev2',
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
            ],
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.asset).toBe('ADA');
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('2.17');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    // User spent UTXO, so they paid the fee
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.17');
  });

  test('classifies transfer with change correctly', async () => {
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
            index: 0,
            txId: 'prev3',
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA to recipient
                unit: 'lovelace',
              },
            ],
            index: 0,
          },
          {
            address: USER_ADDRESS, // Change back to user
            amounts: [
              {
                quantity: '3000000', // 3.0 ADA change
                unit: 'lovelace',
              },
            ],
            index: 1,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User spent UTXO with change return
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.17');
    // Transaction with change is classified as 'transfer' (both owns input AND receives output)
    expect(transaction.operation.type).toBe('transfer');
    // Outflows: spent amount (5.17 ADA)
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('5.17');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('5');
    // Inflows: change received (3.0 ADA)
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('3');
  });
});

describe('CardanoTransactionProcessor - Multi-Asset', () => {
  test('handles multi-asset transaction correctly', async () => {
    const processor = createProcessor();

    const policyId = '1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const tokenUnit = policyId + '4d494c4b';

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000004,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx4jkl',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2170000', // 2.17 ADA
                unit: 'lovelace',
              },
              {
                decimals: 6,
                quantity: '100000000', // 100 MILK tokens (6 decimals)
                symbol: 'MILK',
                unit: tokenUnit,
              },
            ],
            index: 0,
            txId: 'prev4',
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
                decimals: 6,
                quantity: '50000000', // 50 MILK tokens
                symbol: 'MILK',
                unit: tokenUnit,
              },
            ],
            index: 0,
          },
          {
            address: USER_ADDRESS, // Change
            amounts: [
              {
                decimals: 6,
                quantity: '50000000', // 50 MILK tokens change
                symbol: 'MILK',
                unit: tokenUnit,
              },
            ],
            index: 1,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Track both ADA and MILK movements
    expect(transaction.movements.outflows).toHaveLength(2); // ADA and MILK
    expect(transaction.movements.inflows).toHaveLength(1); // MILK change

    // Check ADA outflow (with fee deduction)
    const adaOutflow = transaction.movements.outflows?.find((o) => o.asset === 'ADA');
    expect(adaOutflow).toBeDefined();
    expect(adaOutflow?.grossAmount.toFixed()).toBe('2.17');
    expect(adaOutflow?.netAmount?.toFixed()).toBe('2');

    // Check MILK outflow
    const milkOutflow = transaction.movements.outflows?.find((o) => o.asset === 'MILK');
    expect(milkOutflow).toBeDefined();
    expect(milkOutflow?.grossAmount.toFixed()).toBe('100');
    expect(milkOutflow?.netAmount?.toFixed()).toBe('100');

    // Check MILK inflow (change)
    const milkInflow = transaction.movements.inflows?.find((i) => i.asset === 'MILK');
    expect(milkInflow).toBeDefined();
    expect(milkInflow?.netAmount?.toFixed()).toBe('50');

    // Should have classification uncertainty note
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('classification_uncertain');
  });

  test('consolidates duplicate assets', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000005,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx5mno',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '1170000', // 1.17 ADA
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev5a',
          },
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '1000000', // 1.0 ADA
                unit: 'lovelace',
              },
            ],
            index: 1,
            txId: 'prev5b',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA total received
                unit: 'lovelace',
              },
            ],
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should consolidate ADA inflows
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.asset).toBe('ADA');
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('2');
  });
});

describe('CardanoTransactionProcessor - Derived Addresses', () => {
  test('handles derived addresses for withdrawal', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000006,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx6pqr',
        inputs: [
          {
            address: DERIVED_ADDRESS_1,
            amounts: [
              {
                quantity: '1000000', // 1.0 ADA
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev6a',
          },
          {
            address: DERIVED_ADDRESS_2,
            amounts: [
              {
                quantity: '1170000', // 1.17 ADA
                unit: 'lovelace',
              },
            ],
            index: 1,
            txId: 'prev6b',
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
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, {
      address: USER_ADDRESS,
      derivedAddresses: [DERIVED_ADDRESS_1, DERIVED_ADDRESS_2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User's derived addresses spent UTXOs, so they paid the fee
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('handles derived addresses for deposit', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000007,
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
            ],
            index: 0,
            txId: 'prev7',
          },
        ],
        outputs: [
          {
            address: DERIVED_ADDRESS_1,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA
                unit: 'lovelace',
              },
            ],
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, {
      address: USER_ADDRESS,
      derivedAddresses: [DERIVED_ADDRESS_1, DERIVED_ADDRESS_2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT spend UTXOs (incoming to derived address), so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.operation.type).toBe('deposit');
  });
});

describe('CardanoTransactionProcessor - Edge Cases', () => {
  test('handles missing user address in session metadata', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000000,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx1abc',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2170000',
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev1',
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
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: '' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Missing user address');
    }
  });

  test('handles failed transactions', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000008,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx8vwx',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2170000',
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev8',
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
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'failed',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.status).toBe('failed');
    expect(transaction.blockchain?.is_confirmed).toBe(false);
    // Failed transaction: user initiated (has outflows), so they paid the fee
    expect(transaction.fees).toHaveLength(1);
  });

  test('processes multiple transactions independently', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000009,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'sig1',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2170000',
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev1',
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
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
      {
        blockHeight: 9000010,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'sig2',
        inputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2170000',
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev2',
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
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now() + 1000,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toBeDefined();
    expect(result.value[0]?.externalId).toBe('sig1');
    expect(result.value[0]?.operation.type).toBe('deposit');
    expect(result.value[1]).toBeDefined();
    expect(result.value[1]?.externalId).toBe('sig2');
    expect(result.value[1]?.operation.type).toBe('withdrawal');
  });
});

describe('CardanoTransactionProcessor - Blockchain Metadata', () => {
  test('includes Cardano-specific metadata', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000000,
        blockId: 'block123',
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'sigMeta1',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2170000',
                unit: 'lovelace',
              },
            ],
            index: 0,
            txId: 'prev1',
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
            index: 0,
          },
        ],
        providerName: 'blockfrost',
        status: 'success',
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check blockchain metadata
    expect(transaction.blockchain?.name).toBe('cardano');
    expect(transaction.blockchain?.block_height).toBe(9000000);
    expect(transaction.blockchain?.transaction_hash).toBe('sigMeta1');
    expect(transaction.blockchain?.is_confirmed).toBe(true);

    // Check Cardano-specific metadata
    expect(transaction.metadata?.blockId).toBe('block123');
    expect(transaction.metadata?.inputCount).toBe(1);
    expect(transaction.metadata?.outputCount).toBe(1);
    expect(transaction.metadata?.providerName).toBe('blockfrost');
  });
});
