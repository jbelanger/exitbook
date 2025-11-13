import type { BitcoinTransaction } from '@exitbook/blockchain-providers';
import { getBitcoinChainConfig } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { BitcoinTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'bc1quser1111111111111111111111111111111';
const DERIVED_ADDRESS_1 = 'bc1qderived1111111111111111111111111111';
const DERIVED_ADDRESS_2 = 'bc1qderived2222222222222222222222222222';
const EXTERNAL_ADDRESS = 'bc1qexternal111111111111111111111111111';

function createProcessor() {
  const chainConfig = getBitcoinChainConfig('bitcoin');
  if (!chainConfig) {
    throw new Error('Bitcoin chain config not found');
  }
  return new BitcoinTransactionProcessor(chainConfig);
}

describe('BitcoinTransactionProcessor - Fund Flow Direction', () => {
  test('classifies incoming BTC transfer as deposit', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800000,
        currency: 'BTC',
        feeAmount: '0.0001',
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
            value: '200000000', // 2.0 BTC
          },
        ],
        providerName: 'blockstream.info',
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
    expect(transaction.movements.inflows![0]?.asset.toString()).toBe('BTC');
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');

    // User did NOT spend UTXOs, so they did NOT pay the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
  });

  test('classifies outgoing BTC transfer as withdrawal', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800000,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx1abc',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev1',
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
        providerName: 'blockstream.info',
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
    expect(transaction.movements.outflows![0]?.asset.toString()).toBe('BTC');
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('1.0001');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    // User spent UTXO, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.0001');
  });

  test('classifies self-transfer correctly', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800002,
        currency: 'BTC',
        feeAmount: '0.00005',
        feeCurrency: 'BTC',
        id: 'tx3ghi',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev3',
            value: '50005000', // 0.50005 BTC in satoshis
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS, // Send to self
            index: 0,
            value: '50000000', // 0.5 BTC (minus fee)
          },
        ],
        providerName: 'blockstream.info',
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

    // Check structured fields - self-transfer with fee
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.00005');
  });

  test('handles withdrawal with change correctly', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800003,
        currency: 'BTC',
        feeAmount: '0.00015',
        feeCurrency: 'BTC',
        id: 'tx4jkl',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev4',
            value: '300015000', // 3.00015 BTC in satoshis
            vout: 0,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '100000000', // 1.0 BTC sent to recipient
          },
          {
            address: USER_ADDRESS, // Change back to user
            index: 1,
            value: '200000000', // 2.0 BTC change
          },
        ],
        providerName: 'mempool.space',
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
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.00015');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toBeDefined();
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('1.00015');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.inflows).toHaveLength(0);
  });
});

describe('BitcoinTransactionProcessor - Multi-Input/Output', () => {
  test('handles multi-input transaction correctly', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800004,
        currency: 'BTC',
        feeAmount: '0.0002',
        feeCurrency: 'BTC',
        id: 'tx5mno',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev5a',
            value: '50000000', // 0.5 BTC
            vout: 0,
          },
          {
            address: USER_ADDRESS,
            txid: 'prev5b',
            value: '30020000', // 0.3002 BTC
            vout: 1,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '80000000', // 0.8 BTC sent
          },
        ],
        providerName: 'blockstream.info',
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

    // User spent multiple UTXOs from their wallet
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.0002');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('0.8002');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('0.8');
  });

  test('handles multi-output deposit correctly', async () => {
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
            value: '300010000', // 3.0001 BTC
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            index: 0,
            value: '100000000', // 1.0 BTC to user
          },
          {
            address: 'bc1qanother222222222222222222222222222',
            index: 1,
            value: '200000000', // 2.0 BTC to someone else
          },
        ],
        providerName: 'mempool.space',
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
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });
});

describe('BitcoinTransactionProcessor - Derived Addresses', () => {
  test('handles derived addresses correctly for withdrawal', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800006,
        currency: 'BTC',
        feeAmount: '0.00012',
        feeCurrency: 'BTC',
        id: 'tx7stu',
        inputs: [
          {
            address: DERIVED_ADDRESS_1,
            txid: 'prev7a',
            value: '50000000', // 0.5 BTC
            vout: 0,
          },
          {
            address: DERIVED_ADDRESS_2,
            txid: 'prev7b',
            value: '50012000', // 0.50012 BTC
            vout: 1,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '100000000', // 1.0 BTC sent
          },
        ],
        providerName: 'blockstream.info',
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
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.00012');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('handles derived addresses correctly for deposit', async () => {
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
            address: EXTERNAL_ADDRESS,
            txid: 'prev8',
            value: '150010000', // 1.5001 BTC
            vout: 0,
          },
        ],
        outputs: [
          {
            address: DERIVED_ADDRESS_1,
            index: 0,
            value: '150000000', // 1.5 BTC
          },
        ],
        providerName: 'mempool.space',
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
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });
});

describe('BitcoinTransactionProcessor - Edge Cases', () => {
  test('handles missing user address in session metadata', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800000,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx1abc',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev1',
            value: '200010000',
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS,
            index: 0,
            value: '200000000',
          },
        ],
        providerName: 'blockstream.info',
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

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800009,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx10bcd',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev10',
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
        providerName: 'blockstream.info',
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
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.0001');
  });

  test('processes multiple transactions independently', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800000,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'sig1',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev1',
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
        blockHeight: 800001,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'sig2',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev2',
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
        providerName: 'blockstream.info',
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

describe('BitcoinTransactionProcessor - Blockchain Metadata', () => {
  test('includes Bitcoin-specific metadata', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800000,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'sigMeta1',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev1',
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
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check blockchain metadata
    expect(transaction.blockchain?.name).toBe('bitcoin');
    expect(transaction.blockchain?.block_height).toBe(800000);
    expect(transaction.blockchain?.transaction_hash).toBe('sigMeta1');
    expect(transaction.blockchain?.is_confirmed).toBe(true);

    // Check Bitcoin-specific metadata
    expect(transaction.metadata?.providerName).toBe('blockstream.info');
  });
});
