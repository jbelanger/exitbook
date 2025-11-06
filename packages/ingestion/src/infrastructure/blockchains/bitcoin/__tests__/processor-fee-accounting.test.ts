import type { BitcoinTransaction } from '@exitbook/providers';
import { describe, expect, test } from 'vitest';

import { BitcoinTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'bc1quser1111111111111111111111111111111';
const DERIVED_ADDRESS_1 = 'bc1qderived1111111111111111111111111111';
const DERIVED_ADDRESS_2 = 'bc1qderived2222222222222222222222222222';
const EXTERNAL_ADDRESS = 'bc1qexternal111111111111111111111111111';
const ANOTHER_EXTERNAL = 'bc1qanother222222222222222222222222222';

function createProcessor() {
  return new BitcoinTransactionProcessor();
}

describe('BitcoinTransactionProcessor - Fee Accounting (Issue #78)', () => {
  test('deducts fee when user sends BTC (outgoing transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800000,
        currency: 'BTC',
        feeAmount: '0.0001', // 10,000 satoshis
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

    // User spent their UTXO (outgoing), so they paid the fee
    const networkFee = transaction.fees.find((f) => f.scope === 'network');
    expect(networkFee?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('1.0001');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('does NOT deduct fee when user receives BTC (incoming transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800001,
        currency: 'BTC',
        feeAmount: '0.0001', // 10,000 satoshis (paid by sender)
        feeCurrency: 'BTC',
        id: 'tx2def',
        inputs: [
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev2',
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
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee for self-transfers (user sends to own address)', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800002,
        currency: 'BTC',
        feeAmount: '0.00005', // 5,000 satoshis
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

    // User spent their UTXO (self-transfer), so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.00005');
    // Self-transfer has both isIncoming and isOutgoing, so it's classified as 'transfer'
    // However, since output equals input (minus fee), it's actually just outgoing (withdrawal)
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('0.00005');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('0');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('deducts fee for withdrawal with change (typical send pattern)', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800003,
        currency: 'BTC',
        feeAmount: '0.00015', // 15,000 satoshis
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

    // User spent UTXO with change return, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.00015');
    // Input: 3.00015 BTC, Output to user: 2.0 BTC, Output to external: 1.0 BTC
    // walletInput = 3.00015, walletOutput = 2.0 → outgoing (withdrawal)
    // Outflows: walletInput = 3.00015 BTC debited from wallet (includes change + fee)
    // Net amount represents what actually left the wallet to external parties (1 BTC)
    // Inflows: walletOutput = 2.0 BTC (change received back)
    // Net effect on balance: inflow (2.0) - outflow gross (3.00015) = -1.00015 BTC (1 BTC sent + 0.00015 BTC fee)
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toBeDefined();
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('1.00015');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('deducts fee for multi-input transaction from user wallet', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800004,
        currency: 'BTC',
        feeAmount: '0.0002', // 20,000 satoshis
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

    // User spent multiple UTXOs from their wallet, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.0002');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('0.8002');
    expect(transaction.movements.outflows?.[0]?.netAmount?.toFixed()).toBe('0.8');
  });

  test('does NOT deduct fee for multi-output deposit to user (UTXO split)', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800005,
        currency: 'BTC',
        feeAmount: '0.0001', // 10,000 satoshis (paid by sender)
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
            address: ANOTHER_EXTERNAL,
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

  test('handles derived addresses correctly (xpub wallet)', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800006,
        currency: 'BTC',
        feeAmount: '0.00012', // 12,000 satoshis
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

  test('does NOT deduct fee when receiving to derived address', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800007,
        currency: 'BTC',
        feeAmount: '0.0001', // 10,000 satoshis (paid by sender)
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
            address: DERIVED_ADDRESS_1, // User's derived address
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

  test('case-insensitive address matching', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800008,
        currency: 'BTC',
        feeAmount: '0.0001',
        feeCurrency: 'BTC',
        id: 'tx9yza',
        inputs: [
          {
            // Addresses normalized to lowercase (as they would be from BitcoinAddressSchema)
            address: USER_ADDRESS.toLowerCase(),
            txid: 'prev9',
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
        timestamp: Date.now(),
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS.toLowerCase() });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Case-insensitive matching should work
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.0001');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('failed transaction (user still pays fee if they initiated)', async () => {
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

    // Failed transaction: user initiated (has outflows), so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.0001');
    expect(transaction.status).toBe('failed');
  });

  // Edge cases we DON'T fully handle yet (documented for future improvement)

  test.skip('TODO: OP_RETURN transaction (data storage) - user pays fee', async () => {
    const processor = createProcessor();

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800010,
        currency: 'BTC',
        feeAmount: '0.00001',
        feeCurrency: 'BTC',
        id: 'tx11efg',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev11',
            value: '1000', // Small amount
            vout: 0,
          },
        ],
        outputs: [
          {
            address: undefined, // OP_RETURN has no address
            index: 0,
            value: '0', // 0-value OP_RETURN output
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

    // User created OP_RETURN, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.00001');
  });

  test.skip('TODO: Multisig transaction - proportional fee handling', async () => {
    const processor = createProcessor();

    // In a 2-of-3 multisig, user is one of three signers
    // Current implementation: if user's wallet has ANY input, they pay full fee
    // Future improvement: proportional fee based on input amounts

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800011,
        currency: 'BTC',
        feeAmount: '0.0003', // 30,000 satoshis total fee
        feeCurrency: 'BTC',
        id: 'tx12hij',
        inputs: [
          {
            address: USER_ADDRESS,
            txid: 'prev12a',
            value: '50000000', // 0.5 BTC (user's contribution)
            vout: 0,
          },
          {
            address: EXTERNAL_ADDRESS,
            txid: 'prev12b',
            value: '50000000', // 0.5 BTC (other signer)
            vout: 0,
          },
          {
            address: ANOTHER_EXTERNAL,
            txid: 'prev12c',
            value: '50000000', // 0.5 BTC (third signer)
            vout: 0,
          },
        ],
        outputs: [
          {
            address: EXTERNAL_ADDRESS,
            index: 0,
            value: '149970000', // Total - fee
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

    // Current behavior: user pays full fee (0.0003)
    // Ideal behavior: user pays 1/3 of fee (0.0001) based on input proportion
    // TODO: Implement proportional fee logic for multisig
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('0.0001'); // Proportional
  });

  test.skip('TODO: Lightning channel close - complex fee handling', async () => {
    const processor = createProcessor();

    // Lightning channel close: user both sends (channel balance) and receives (their funds back)
    // Fee payer depends on who initiated the close
    // Current implementation may not distinguish cooperative vs force close

    const normalizedData: BitcoinTransaction[] = [
      {
        blockHeight: 800012,
        currency: 'BTC',
        feeAmount: '0.0005', // Higher fee for force close
        feeCurrency: 'BTC',
        id: 'tx13klm',
        inputs: [
          {
            address: 'lightning_multisig_address',
            txid: 'channel_funding',
            value: '100050000', // 1.0005 BTC channel capacity
            vout: 0,
          },
        ],
        outputs: [
          {
            address: USER_ADDRESS, // User receives their balance
            index: 0,
            value: '60000000', // 0.6 BTC
          },
          {
            address: EXTERNAL_ADDRESS, // Counterparty receives their balance
            index: 1,
            value: '40000000', // 0.4 BTC
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

    // TODO: Need to detect if user initiated close to determine fee responsibility
    // For now, implementation treats this as incoming (no wallet input), so fee = 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0'); // May be incorrect
  });
});
