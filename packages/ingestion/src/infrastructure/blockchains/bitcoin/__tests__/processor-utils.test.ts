import type { BitcoinTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { analyzeBitcoinFundFlow, determineBitcoinTransactionType } from '../processor-utils.js';

const USER_ADDRESS = 'bc1quser1111111111111111111111111111111';
const DERIVED_ADDRESS_1 = 'bc1qderived1111111111111111111111111111';
const DERIVED_ADDRESS_2 = 'bc1qderived2222222222222222222222222222';
const EXTERNAL_ADDRESS = 'bc1qexternal111111111111111111111111111';

describe('analyzeBitcoinFundFlow', () => {
  test('analyzes outgoing transaction correctly', () => {
    const normalizedTx: BitcoinTransaction = {
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
          value: '100000000', // 1.0 BTC
        },
      ],
      providerName: 'blockstream.info',
      status: 'success',
      timestamp: Date.now(),
    };

    const result = analyzeBitcoinFundFlow(normalizedTx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(false);
    expect(fundFlow.isOutgoing).toBe(true);
    expect(fundFlow.walletInput).toBe('1.0001');
    expect(fundFlow.walletOutput).toBe('0');
    expect(fundFlow.fromAddress).toBe(USER_ADDRESS);
    expect(fundFlow.toAddress).toBe(EXTERNAL_ADDRESS);
  });

  test('analyzes incoming transaction correctly', () => {
    const normalizedTx: BitcoinTransaction = {
      blockHeight: 800001,
      currency: 'BTC',
      feeAmount: '0.0001',
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
          value: '200000000', // 2.0 BTC
        },
      ],
      providerName: 'mempool.space',
      status: 'success',
      timestamp: Date.now(),
    };

    const result = analyzeBitcoinFundFlow(normalizedTx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.walletInput).toBe('0');
    expect(fundFlow.walletOutput).toBe('2');
    expect(fundFlow.fromAddress).toBe(EXTERNAL_ADDRESS);
    expect(fundFlow.toAddress).toBe(USER_ADDRESS);
  });

  test('handles transaction with change correctly', () => {
    const normalizedTx: BitcoinTransaction = {
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
    };

    const result = analyzeBitcoinFundFlow(normalizedTx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(false);
    expect(fundFlow.isOutgoing).toBe(true);
    expect(fundFlow.walletInput).toBe('3.00015');
    expect(fundFlow.walletOutput).toBe('2');
    expect(fundFlow.netAmount).toBe('1.00015'); // abs(walletOutput - walletInput)
  });

  test('handles derived addresses correctly', () => {
    const normalizedTx: BitcoinTransaction = {
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
    };

    const result = analyzeBitcoinFundFlow(normalizedTx, {
      address: USER_ADDRESS,
      derivedAddresses: [DERIVED_ADDRESS_1, DERIVED_ADDRESS_2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isOutgoing).toBe(true);
    expect(fundFlow.walletInput).toBe('1.00012');
    expect(fundFlow.walletOutput).toBe('0');
    expect(fundFlow.fromAddress).toBe(DERIVED_ADDRESS_1);
  });

  test('performs case-insensitive address matching', () => {
    const normalizedTx: BitcoinTransaction = {
      blockHeight: 800008,
      currency: 'BTC',
      feeAmount: '0.0001',
      feeCurrency: 'BTC',
      id: 'tx9yza',
      inputs: [
        {
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
    };

    const result = analyzeBitcoinFundFlow(normalizedTx, { address: USER_ADDRESS.toLowerCase() });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.walletInput).toBe('1.0001');
  });
});

describe('determineBitcoinTransactionType', () => {
  test('classifies incoming-only as deposit', () => {
    const fundFlow = {
      fromAddress: EXTERNAL_ADDRESS,
      isIncoming: true,
      isOutgoing: false,
      netAmount: '2',
      toAddress: USER_ADDRESS,
      totalInput: '2.0001',
      totalOutput: '2',
      walletInput: '0',
      walletOutput: '2',
    };

    const type = determineBitcoinTransactionType(fundFlow, {});

    expect(type).toBe('deposit');
  });

  test('classifies outgoing-only as withdrawal', () => {
    const fundFlow = {
      fromAddress: USER_ADDRESS,
      isIncoming: false,
      isOutgoing: true,
      netAmount: '1.0001',
      toAddress: EXTERNAL_ADDRESS,
      totalInput: '1.0001',
      totalOutput: '1',
      walletInput: '1.0001',
      walletOutput: '0',
    };

    const type = determineBitcoinTransactionType(fundFlow, {});

    expect(type).toBe('withdrawal');
  });

  test('classifies both incoming and outgoing as transfer', () => {
    const fundFlow = {
      fromAddress: USER_ADDRESS,
      isIncoming: true,
      isOutgoing: true,
      netAmount: '1.00015',
      toAddress: EXTERNAL_ADDRESS,
      totalInput: '3.00015',
      totalOutput: '3',
      walletInput: '3.00015',
      walletOutput: '2',
    };

    const type = determineBitcoinTransactionType(fundFlow, {});

    expect(type).toBe('transfer');
  });

  test('classifies very small net change as fee-only transaction', () => {
    const fundFlow = {
      fromAddress: USER_ADDRESS,
      isIncoming: true,
      isOutgoing: true,
      netAmount: '0.000005', // Very small change (< 0.00001 BTC threshold)
      toAddress: USER_ADDRESS,
      totalInput: '0.500005',
      totalOutput: '0.5',
      walletInput: '0.500005',
      walletOutput: '0.5',
    };

    const type = determineBitcoinTransactionType(fundFlow, {});

    expect(type).toBe('fee');
  });

  test('defaults to transfer when neither incoming nor outgoing', () => {
    const fundFlow = {
      fromAddress: undefined,
      isIncoming: false,
      isOutgoing: false,
      netAmount: '0',
      toAddress: undefined,
      totalInput: '0',
      totalOutput: '0',
      walletInput: '0',
      walletOutput: '0',
    };

    const type = determineBitcoinTransactionType(fundFlow, {});

    expect(type).toBe('transfer');
  });
});
