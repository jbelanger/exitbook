import type { CardanoTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { CardanoTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'addr1qyuser111111111111111111111111111111111111111111111111111111';
const DERIVED_ADDRESS_1 = 'addr1qyderived1111111111111111111111111111111111111111111111111';
const DERIVED_ADDRESS_2 = 'addr1qyderived2222222222222222222222222222222222222222222222';
const EXTERNAL_ADDRESS = 'addr1qyexternal11111111111111111111111111111111111111111111111111';
const ANOTHER_EXTERNAL = 'addr1qyanother2222222222222222222222222222222222222222222222222';

function createProcessor() {
  return new CardanoTransactionProcessor();
}

describe('CardanoTransactionProcessor - Fee Accounting', () => {
  test('deducts fee when user sends ADA (outgoing transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000000,
        currency: 'ADA',
        feeAmount: '0.17', // Fee in ADA
        feeCurrency: 'ADA',
        id: 'tx1abc',
        inputs: [
          {
            address: USER_ADDRESS,
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User spent their UTXO (outgoing), so they paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('2.17');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('does NOT deduct fee when user receives ADA (incoming transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000001,
        currency: 'ADA',
        feeAmount: '0.17', // Fee paid by sender
        feeCurrency: 'ADA',
        id: 'tx2def',
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
            txHash: 'prev2',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA received
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT spend any UTXOs (incoming only), so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee for self-transfers (user sends to own address)', async () => {
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
                quantity: '1170000', // 1.17 ADA in lovelace
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev3',
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS, // Send to self
            amounts: [
              {
                quantity: '1000000', // 1.0 ADA (minus fee)
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User spent their UTXO (self-transfer), so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.17');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
    expect(transaction.operation.type).toBe('transfer');
  });

  test('deducts fee for withdrawal with change (typical send pattern)', async () => {
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
                quantity: '5170000', // 5.17 ADA in lovelace
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
                quantity: '2000000', // 2.0 ADA sent to recipient
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
          {
            address: USER_ADDRESS, // Change back to user
            amounts: [
              {
                quantity: '3000000', // 3.0 ADA change
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User spent UTXO with change return, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.17');
    // Transaction with change is classified as 'transfer' (both owns input AND receives output)
    expect(transaction.operation.type).toBe('transfer');
    // Outflows: total input spent (5.17 ADA)
    expect(transaction.movements.outflows).toBeDefined();
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('5.17');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('5');
    // Inflows: change received (3.0 ADA)
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('3');
  });

  test('deducts fee for multi-input transaction from user wallet', async () => {
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
                quantity: '1000000', // 1.0 ADA
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
                quantity: '1170000', // 1.17 ADA
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User spent multiple UTXOs from their wallet, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('2.17');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('2');
  });

  test('does NOT deduct fee for multi-output deposit to user', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000005,
        currency: 'ADA',
        feeAmount: '0.17', // Fee paid by sender
        feeCurrency: 'ADA',
        id: 'tx6pqr',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '3170000', // 3.17 ADA
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
                quantity: '1000000', // 1.0 ADA to user
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
          },
          {
            address: ANOTHER_EXTERNAL,
            amounts: [
              {
                quantity: '2000000', // 2.0 ADA to someone else
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT spend any UTXOs (incoming only), so they did NOT pay the fee
    expect(transaction.fees).toHaveLength(0);
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles derived addresses correctly for withdrawal', async () => {
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
            address: DERIVED_ADDRESS_1,
            amounts: [
              {
                quantity: '1000000', // 1.0 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev7a',
          },
          {
            address: DERIVED_ADDRESS_2,
            amounts: [
              {
                quantity: '1170000', // 1.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 1,
            txHash: 'prev7b',
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
      address: USER_ADDRESS,
      derivedAddresses: [DERIVED_ADDRESS_1, DERIVED_ADDRESS_2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User's derived addresses spent UTXOs, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.17');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('does NOT deduct fee when receiving to derived address', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000007,
        currency: 'ADA',
        feeAmount: '0.17', // Fee paid by sender
        feeCurrency: 'ADA',
        id: 'tx8vwx',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            amounts: [
              {
                quantity: '2170000', // 2.17 ADA
                unit: 'lovelace',
              },
            ],
            outputIndex: 0,
            txHash: 'prev8',
          },
        ],
        outputs: [
          {
            address: DERIVED_ADDRESS_1, // User's derived address
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

  test('handles multi-asset transaction fee correctly (fee only on ADA)', async () => {
    const processor = createProcessor();

    const policyId = '1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const tokenUnit = policyId + '4d494c4b';

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000008,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx9yza',
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
                quantity: '100000000', // 100 MILK tokens
                symbol: 'MILK',
                unit: tokenUnit,
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
                decimals: 6,
                quantity: '100000000', // 100 MILK tokens
                symbol: 'MILK',
                unit: tokenUnit,
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Fee is paid in ADA and deducted from ADA outflow only
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.17');
    expect(transaction.fees.find((f) => f.scope === 'network')?.asset.toString()).toBe('ADA');

    // Check ADA outflow (with fee deduction)
    const adaOutflow = transaction.movements.outflows?.find((o) => o.asset.toString() === 'ADA');
    expect(adaOutflow).toBeDefined();
    expect(adaOutflow?.grossAmount.toFixed()).toBe('2.17');
    expect(adaOutflow?.netAmount?.toFixed()).toBe('2');

    // Check MILK outflow (no fee deduction)
    const milkOutflow = transaction.movements.outflows?.find((o) => o.asset.toString() === 'MILK');
    expect(milkOutflow).toBeDefined();
    expect(milkOutflow?.grossAmount.toFixed()).toBe('100');
    expect(milkOutflow?.netAmount?.toFixed()).toBe('100');
  });

  test('failed transaction (user still pays fee if they initiated)', async () => {
    const processor = createProcessor();

    const normalizedData: CardanoTransaction[] = [
      {
        blockHeight: 9000009,
        currency: 'ADA',
        feeAmount: '0.17',
        feeCurrency: 'ADA',
        id: 'tx10bcd',
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Failed transaction: user initiated (has outflows), so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.17');
    expect(transaction.status).toBe('failed');
  });
});
