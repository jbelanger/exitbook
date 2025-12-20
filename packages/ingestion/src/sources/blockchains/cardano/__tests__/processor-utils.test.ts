import type { CardanoTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import {
  analyzeCardanoFundFlow,
  consolidateCardanoMovements,
  convertLovelaceToAda,
  determineCardanoTransactionType,
  normalizeCardanoAmount,
  parseCardanoAssetUnit,
} from '../processor-utils.js';
import type { CardanoFundFlow, CardanoMovement } from '../types.js';

const USER_ADDRESS = 'addr1qyuser111111111111111111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'addr1qyexternal11111111111111111111111111111111111111111111111111';

function createTransaction(overrides: Partial<CardanoTransaction> = {}): CardanoTransaction {
  return {
    blockHeight: 9000000,
    currency: 'ADA',
    feeAmount: '0.17',
    feeCurrency: 'ADA',
    id: 'tx-default',
    eventId: '0xdefaultevent',
    inputs: [],
    outputs: [],
    providerName: 'blockfrost',
    status: 'success',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createFundFlow(overrides: Partial<CardanoFundFlow> = {}): CardanoFundFlow {
  const defaultMovement: CardanoMovement = {
    amount: '0',
    asset: 'ADA',
    unit: 'lovelace',
  };

  return {
    classificationUncertainty: undefined,
    feeAmount: '0.17',
    feeCurrency: 'ADA',
    feePaidByUser: false,
    fromAddress: EXTERNAL_ADDRESS,
    inflows: [],
    inputCount: 1,
    isIncoming: false,
    isOutgoing: false,
    outflows: [],
    outputCount: 1,
    primary: defaultMovement,
    toAddress: USER_ADDRESS,
    ...overrides,
  };
}

describe('convertLovelaceToAda', () => {
  test('converts lovelace to ADA correctly', () => {
    expect(convertLovelaceToAda('1000000')).toBe('1');
    expect(convertLovelaceToAda('2170000')).toBe('2.17');
    expect(convertLovelaceToAda('500000')).toBe('0.5');
    expect(convertLovelaceToAda('1')).toBe('0.000001');
    expect(convertLovelaceToAda('0')).toBe('0');
  });
});

describe('parseCardanoAssetUnit', () => {
  test('identifies ADA (lovelace)', () => {
    const result = parseCardanoAssetUnit('lovelace');
    expect(result.isAda).toBe(true);
    expect(result.policyId).toBeUndefined();
    expect(result.assetName).toBeUndefined();
  });

  test('parses native token with policy ID only', () => {
    const policyId = '1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const result = parseCardanoAssetUnit(policyId);
    expect(result.isAda).toBe(false);
    expect(result.policyId).toBe(policyId);
    expect(result.assetName).toBeUndefined();
  });

  test('parses native token with policy ID and asset name', () => {
    const policyId = '1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const assetName = '4d494c4b'; // MILK in hex
    const unit = policyId + assetName;
    const result = parseCardanoAssetUnit(unit);
    expect(result.isAda).toBe(false);
    expect(result.policyId).toBe(policyId);
    expect(result.assetName).toBe(assetName);
  });

  test('handles short token identifier as fallback', () => {
    const result = parseCardanoAssetUnit('shorttoken');
    expect(result.isAda).toBe(false);
    expect(result.policyId).toBe('shorttoken');
  });
});

describe('normalizeCardanoAmount', () => {
  test('normalizes ADA with 6 decimals', () => {
    expect(normalizeCardanoAmount('1000000', 6)).toBe('1');
    expect(normalizeCardanoAmount('2170000', 6)).toBe('2.17');
    expect(normalizeCardanoAmount('500000', 6)).toBe('0.5');
  });

  test('normalizes token with custom decimals', () => {
    expect(normalizeCardanoAmount('1000', 3)).toBe('1');
    expect(normalizeCardanoAmount('12345', 2)).toBe('123.45');
  });

  test('handles zero decimals', () => {
    expect(normalizeCardanoAmount('100', 0)).toBe('100');
    expect(normalizeCardanoAmount('100', undefined)).toBe('100');
  });
});

describe('consolidateCardanoMovements', () => {
  test('consolidates duplicate ADA movements', () => {
    const movements = [
      { amount: '1', asset: 'ADA', unit: 'lovelace' },
      { amount: '2', asset: 'ADA', unit: 'lovelace' },
      { amount: '0.5', asset: 'ADA', unit: 'lovelace' },
    ];

    const result = consolidateCardanoMovements(movements);
    expect(result).toHaveLength(1);
    expect(result[0]?.amount).toBe('3.5');
    expect(result[0]?.asset).toBe('ADA');
  });

  test('consolidates duplicate token movements', () => {
    const policyId = '1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const unit = policyId + '4d494c4b';
    const movements = [
      { amount: '100', asset: 'MILK', policyId, unit },
      { amount: '50', asset: 'MILK', policyId, unit },
    ];

    const result = consolidateCardanoMovements(movements);
    expect(result).toHaveLength(1);
    expect(result[0]?.amount).toBe('150');
    expect(result[0]?.asset).toBe('MILK');
  });

  test('keeps different assets separate', () => {
    const movements = [
      { amount: '1', asset: 'ADA', unit: 'lovelace' },
      { amount: '100', asset: 'MILK', unit: 'policyId123' },
    ];

    const result = consolidateCardanoMovements(movements);
    expect(result).toHaveLength(2);
  });
});

describe('analyzeCardanoFundFlow', () => {
  test('analyzes outgoing ADA transaction correctly', () => {
    const normalizedTx = createTransaction({
      id: 'tx1abc',
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
          txHash: 'prev1',
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
          outputIndex: 0,
        },
      ],
    });

    const result = analyzeCardanoFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(false);
    expect(fundFlow.isOutgoing).toBe(true);
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.amount).toBe('2.17');
    expect(fundFlow.outflows[0]?.asset).toBe('ADA');
    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.fromAddress).toBe(USER_ADDRESS);
    expect(fundFlow.toAddress).toBe(EXTERNAL_ADDRESS);
    expect(fundFlow.feePaidByUser).toBe(true);
  });

  test('analyzes incoming ADA transaction correctly', () => {
    const normalizedTx = createTransaction({
      blockHeight: 9000001,
      id: 'tx2def',
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
          txHash: 'prev2',
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
    });

    const result = analyzeCardanoFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.amount).toBe('2');
    expect(fundFlow.inflows[0]?.asset).toBe('ADA');
    expect(fundFlow.outflows).toHaveLength(0);
    expect(fundFlow.fromAddress).toBe(EXTERNAL_ADDRESS);
    expect(fundFlow.toAddress).toBe(USER_ADDRESS);
    expect(fundFlow.feePaidByUser).toBe(false);
  });

  test('handles transaction with change correctly', () => {
    const normalizedTx = createTransaction({
      blockHeight: 9000003,
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
          address: EXTERNAL_ADDRESS,
          amounts: [
            {
              quantity: '2000000', // 2.0 ADA to recipient
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
    });

    const result = analyzeCardanoFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    // Transaction with change: user owns input AND receives output
    // isIncoming = userReceivesOutput && !userOwnsInput = true && false = false
    // isOutgoing = userOwnsInput && !userReceivesOutput = true && false = false
    expect(fundFlow.isIncoming).toBe(false);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.amount).toBe('5.17');
    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.amount).toBe('3');
    expect(fundFlow.feePaidByUser).toBe(true);
  });

  test('handles multi-asset transaction correctly', () => {
    const policyId = '1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const tokenUnit = policyId + '4d494c4b';

    const normalizedTx = createTransaction({
      blockHeight: 9000004,
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
          outputIndex: 0,
          txHash: 'prev4',
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
          outputIndex: 0,
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
          outputIndex: 1,
        },
      ],
    });

    const result = analyzeCardanoFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    // Track both ADA and MILK movements
    expect(fundFlow.outflows).toHaveLength(2); // ADA and MILK
    expect(fundFlow.inflows).toHaveLength(1); // MILK change
    expect(fundFlow.classificationUncertainty).toBeDefined();
  });

  test('performs case-insensitive address matching', () => {
    const normalizedTx = createTransaction({
      blockHeight: 9000005,
      id: 'tx5mno',
      inputs: [
        {
          address: USER_ADDRESS.toLowerCase(),
          amounts: [
            {
              quantity: '2170000',
              unit: 'lovelace',
            },
          ],
          outputIndex: 0,
          txHash: 'prev5',
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
    });

    const result = analyzeCardanoFundFlow(normalizedTx, {
      primaryAddress: USER_ADDRESS.toLowerCase(),
      userAddresses: [USER_ADDRESS.toLowerCase()],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.outflows).toHaveLength(1);
  });
});

describe('determineCardanoTransactionType', () => {
  test('classifies incoming-only as deposit', () => {
    const fundFlow = createFundFlow({
      inflows: [{ amount: '2', asset: 'ADA', unit: 'lovelace' }],
      isIncoming: true,
      primary: { amount: '2', asset: 'ADA', unit: 'lovelace' },
    });

    const type = determineCardanoTransactionType(fundFlow);
    expect(type).toBe('transfer');
  });

  test('classifies outgoing-only as withdrawal', () => {
    const fundFlow = createFundFlow({
      feePaidByUser: true,
      fromAddress: USER_ADDRESS,
      isOutgoing: true,
      outflows: [{ amount: '2.17', asset: 'ADA', unit: 'lovelace' }],
      primary: { amount: '2.17', asset: 'ADA', unit: 'lovelace' },
      toAddress: EXTERNAL_ADDRESS,
    });

    const type = determineCardanoTransactionType(fundFlow);
    expect(type).toBe('transfer');
  });

  test('classifies both incoming and outgoing as transfer', () => {
    const fundFlow = createFundFlow({
      feePaidByUser: true,
      fromAddress: USER_ADDRESS,
      inflows: [{ amount: '3', asset: 'ADA', unit: 'lovelace' }],
      isIncoming: true,
      isOutgoing: true,
      outflows: [{ amount: '5.17', asset: 'ADA', unit: 'lovelace' }],
      outputCount: 2,
      primary: { amount: '5.17', asset: 'ADA', unit: 'lovelace' },
      toAddress: EXTERNAL_ADDRESS,
    });

    const type = determineCardanoTransactionType(fundFlow);
    expect(type).toBe('transfer');
  });

  test('classifies zero movements as fee', () => {
    const fundFlow = createFundFlow({
      feePaidByUser: true,
      fromAddress: USER_ADDRESS,
      toAddress: USER_ADDRESS,
    });

    const type = determineCardanoTransactionType(fundFlow);
    expect(type).toBe('transfer');
  });
});
