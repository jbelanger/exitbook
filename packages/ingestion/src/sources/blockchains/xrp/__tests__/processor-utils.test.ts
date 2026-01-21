import type { XrpTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { analyzeXrpFundFlow } from '../processor-utils.js';

const USER_ADDRESS = 'rN7n7otQDd6FczFgLdhmKRAWNZDy7g4EAZ';
const EXTERNAL_ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';

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

describe('analyzeXrpFundFlow', () => {
  test('analyzes incoming transaction correctly', () => {
    const normalizedTx = createTransaction({
      id: 'tx1abc',
      account: EXTERNAL_ADDRESS,
      destination: USER_ADDRESS,
      balanceChanges: [
        {
          account: USER_ADDRESS,
          balance: '100.5',
          currency: 'XRP',
          previousBalance: '100',
        },
      ],
    });

    const result = analyzeXrpFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.netAmount).toBe('0.5');
    expect(fundFlow.fromAddress).toBe(EXTERNAL_ADDRESS);
    expect(fundFlow.toAddress).toBe(USER_ADDRESS);
  });

  test('analyzes outgoing transaction correctly', () => {
    const normalizedTx = createTransaction({
      id: 'tx2def',
      account: USER_ADDRESS,
      destination: EXTERNAL_ADDRESS,
      balanceChanges: [
        {
          account: USER_ADDRESS,
          balance: '99',
          currency: 'XRP',
          previousBalance: '100',
        },
      ],
    });

    const result = analyzeXrpFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(false);
    expect(fundFlow.isOutgoing).toBe(true);
    expect(fundFlow.netAmount).toBe('1');
    expect(fundFlow.fromAddress).toBe(USER_ADDRESS);
    expect(fundFlow.toAddress).toBe(EXTERNAL_ADDRESS);
  });

  test('handles transaction with no balance change for wallet', () => {
    const normalizedTx = createTransaction({
      id: 'tx3ghi',
      account: EXTERNAL_ADDRESS,
      transactionType: 'AccountSet',
      balanceChanges: [
        {
          account: EXTERNAL_ADDRESS,
          balance: '100',
          currency: 'XRP',
          previousBalance: '100.000012',
        },
      ],
    });

    const result = analyzeXrpFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(false);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.netAmount).toBe('0');
    expect(fundFlow.fromAddress).toBe(EXTERNAL_ADDRESS);
    expect(fundFlow.toAddress).toBeUndefined();
  });

  test('handles transaction with zero net balance change', () => {
    const normalizedTx = createTransaction({
      id: 'tx4jkl',
      account: USER_ADDRESS,
      balanceChanges: [
        {
          account: USER_ADDRESS,
          balance: '100',
          currency: 'XRP',
          previousBalance: '100',
        },
      ],
    });

    const result = analyzeXrpFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(false);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.netAmount).toBe('0');
  });

  test('handles transaction without previous balance', () => {
    const normalizedTx = createTransaction({
      id: 'tx5mno',
      account: EXTERNAL_ADDRESS,
      destination: USER_ADDRESS,
      balanceChanges: [
        {
          account: USER_ADDRESS,
          balance: '20',
          currency: 'XRP',
        },
      ],
    });

    const result = analyzeXrpFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.netAmount).toBe('20'); // Assuming previous balance was 0
  });

  test('filters balance changes to XRP currency only', () => {
    const normalizedTx = createTransaction({
      id: 'tx6pqr',
      account: EXTERNAL_ADDRESS,
      destination: USER_ADDRESS,
      balanceChanges: [
        {
          account: USER_ADDRESS,
          balance: '100',
          currency: 'USD',
          previousBalance: '50',
        },
        {
          account: USER_ADDRESS,
          balance: '200.5',
          currency: 'XRP',
          previousBalance: '200',
        },
      ],
    });

    const result = analyzeXrpFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.netAmount).toBe('0.5'); // Only XRP balance change
  });

  test('errors when sender has fee but no balance change (data extraction bug)', () => {
    const normalizedTx = createTransaction({
      id: 'tx7stu',
      account: USER_ADDRESS, // User is the sender
      destination: EXTERNAL_ADDRESS,
      feeAmount: '0.000012', // Nonzero fee
      balanceChanges: [], // Missing balance change - data extraction bug
    });

    const result = analyzeXrpFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error).toContain('Missing balance change for sender address');
    expect(result.error).toContain(USER_ADDRESS);
    expect(result.error).toContain('data extraction bug');
  });
});
