/**
 * Unit tests for NEAR V3 Processor Utilities
 *
 * Tests pure utility functions for V3 architecture:
 * - Grouping normalized data by transaction hash
 * - Correlating receipts with activities and ft-transfers
 * - Extracting fees with single source of truth
 * - Extracting fund flows
 * - Consolidating movements by asset
 * - Classifying operation types
 */
import type {
  NearBalanceChangeV3,
  NearReceiptV3,
  NearTokenTransferV3,
  NearTransactionV3,
  NearReceiptActionV3,
} from '@exitbook/blockchain-providers';
import { Decimal } from 'decimal.js';
import { describe, expect, test } from 'vitest';

import {
  classifyOperation,
  consolidateByAsset,
  convertReceiptToProcessorType,
  correlateTransactionData,
  deriveBalanceChangeDeltasFromAbsolutes,
  extractReceiptFees,
  extractFlows,
  groupNearEventsByTransaction,
  type Movement,
  validateTransactionGroup,
} from '../processor-utils.v3.js';
import type { NearReceipt, RawTransactionGroup } from '../types.v3.js';

// Test data factories
const createTransaction = (overrides: Partial<NearTransactionV3> = {}): NearTransactionV3 => ({
  id: overrides.transactionHash || 'tx123',
  eventId: `${overrides.transactionHash || 'tx123'}:tx`,
  streamType: 'transactions',
  transactionHash: 'tx123',
  signerAccountId: 'alice.near',
  receiverAccountId: 'bob.near',
  blockHash: 'block123',
  blockHeight: 12345,
  blockTimestamp: 1640000000,
  status: true,
  ...overrides,
});

const createReceipt = (overrides: Partial<NearReceiptV3> = {}): NearReceiptV3 => ({
  id: overrides.receiptId || 'receipt1',
  eventId: `${overrides.receiptId || 'receipt1'}:receipt`,
  streamType: 'receipts',
  receiptId: 'receipt1',
  transactionHash: 'tx123',
  predecessorAccountId: 'alice.near',
  receiverAccountId: 'bob.near',
  receiptKind: 'ACTION',
  blockHash: 'block123',
  blockHeight: 12345,
  blockTimestamp: 1640000000,
  executorAccountId: 'bob.near',
  gasBurnt: '2428000000000',
  tokensBurntYocto: '242800000000000000000',
  status: true,
  logs: [],
  actions: [],
  ...overrides,
});

const createBalanceChange = (overrides: Partial<NearBalanceChangeV3> = {}): NearBalanceChangeV3 => ({
  id: `${overrides.receiptId || 'receipt1'}:bc:0`,
  eventId: `${overrides.receiptId || 'receipt1'}:bc:0`,
  streamType: 'balance-changes',
  receiptId: 'receipt1',
  affectedAccountId: 'alice.near',
  direction: 'OUTBOUND',
  cause: 'TRANSFER',
  deltaAmountYocto: '-1000000000000000000000000',
  absoluteNonstakedAmount: '1000000000000000000000000',
  absoluteStakedAmount: '0',
  timestamp: 1640000000,
  blockHeight: '12345',
  ...overrides,
});

const createTokenTransfer = (overrides: Partial<NearTokenTransferV3> = {}): NearTokenTransferV3 => ({
  id: `${overrides.receiptId || 'receipt1'}:tt:0`,
  eventId: `${overrides.receiptId || 'receipt1'}:tt:0`,
  streamType: 'token-transfers',
  receiptId: 'receipt1',
  affectedAccountId: 'alice.near',
  involvedAccountId: 'bob.near',
  deltaAmountYocto: '-1000000',
  symbol: 'USDC',
  contractAddress: 'usdc.token.near',
  decimals: 6,
  timestamp: 1640000000,
  blockHeight: 12345,
  ...overrides,
});

describe('NEAR V3 Processor Utils - groupByTransactionHash', () => {
  test('should group single transaction with all types', () => {
    const rawData = [
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createTransaction({ transactionHash: 'tx1' }),
        transactionTypeHint: 'transactions',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createReceipt({ transactionHash: 'tx1', receiptId: 'receipt1' }),
        transactionTypeHint: 'receipts',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createBalanceChange({ receiptId: 'receipt1' }),
        transactionTypeHint: 'balance-changes',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createTokenTransfer({ receiptId: 'receipt1' }),
        transactionTypeHint: 'token-transfers',
      },
    ];

    const groups = groupNearEventsByTransaction(rawData);

    expect(groups.size).toBe(1);
    const group = groups.get('tx1');
    expect(group).toBeDefined();
    expect(group!.transaction).toBeDefined();
    expect(group!.receipts).toHaveLength(1);
    expect(group!.balanceChanges).toHaveLength(1);
    expect(group!.tokenTransfers).toHaveLength(1);
  });

  test('should handle legacy transaction type hints (activities, ft-transfers)', () => {
    const rawData = [
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createTransaction({ transactionHash: 'tx1' }),
        transactionTypeHint: 'transactions',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createBalanceChange({ receiptId: 'receipt1' }),
        transactionTypeHint: 'activities',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createTokenTransfer({ receiptId: 'receipt1' }),
        transactionTypeHint: 'ft-transfers',
      },
    ];

    const groups = groupNearEventsByTransaction(rawData);

    expect(groups.size).toBe(1);
    const group = groups.get('tx1');
    expect(group!.balanceChanges).toHaveLength(1);
    expect(group!.tokenTransfers).toHaveLength(1);
  });

  test('should group multiple transactions separately', () => {
    const rawData = [
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createTransaction({ transactionHash: 'tx1' }),
        transactionTypeHint: 'transactions',
      },
      {
        blockchainTransactionHash: 'tx2',
        normalizedData: createTransaction({ transactionHash: 'tx2' }),
        transactionTypeHint: 'transactions',
      },
    ];

    const groups = groupNearEventsByTransaction(rawData);

    expect(groups.size).toBe(2);
    expect(groups.get('tx1')?.transaction).toBeDefined();
    expect(groups.get('tx2')?.transaction).toBeDefined();
  });

  test('should accumulate multiple receipts for same transaction', () => {
    const rawData = [
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createReceipt({ receiptId: 'receipt1' }),
        transactionTypeHint: 'receipts',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createReceipt({ receiptId: 'receipt2' }),
        transactionTypeHint: 'receipts',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createReceipt({ receiptId: 'receipt3' }),
        transactionTypeHint: 'receipts',
      },
    ];

    const groups = groupNearEventsByTransaction(rawData);

    expect(groups.size).toBe(1);
    const group = groups.get('tx1');
    expect(group!.receipts).toHaveLength(3);
  });

  test('should accumulate multiple balance changes for same transaction', () => {
    const rawData = [
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createBalanceChange({ affectedAccountId: 'alice.near' }),
        transactionTypeHint: 'balance-changes',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createBalanceChange({ affectedAccountId: 'bob.near' }),
        transactionTypeHint: 'balance-changes',
      },
    ];

    const groups = groupNearEventsByTransaction(rawData);

    expect(groups.size).toBe(1);
    const group = groups.get('tx1');
    expect(group!.balanceChanges).toHaveLength(2);
  });

  test('should throw error on duplicate transaction record', () => {
    const rawData = [
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createTransaction({ transactionHash: 'tx1' }),
        transactionTypeHint: 'transactions',
      },
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: createTransaction({ transactionHash: 'tx1' }),
        transactionTypeHint: 'transactions',
      },
    ];

    expect(() => groupNearEventsByTransaction(rawData)).toThrow('Duplicate transaction record for hash tx1');
  });

  test('should throw error on unknown transaction type hint', () => {
    const rawData = [
      {
        blockchainTransactionHash: 'tx1',
        normalizedData: {},
        transactionTypeHint: 'unknown-type',
      },
    ];

    expect(() => groupNearEventsByTransaction(rawData)).toThrow('Unknown transaction type hint: unknown-type');
  });

  test('should handle empty input', () => {
    const groups = groupNearEventsByTransaction([]);
    expect(groups.size).toBe(0);
  });
});

describe('NEAR V3 Processor Utils - validateTransactionGroup', () => {
  test('should validate group with transaction present', () => {
    const group: RawTransactionGroup = {
      transaction: createTransaction(),
      receipts: [],
      balanceChanges: [],
      tokenTransfers: [],
    };

    const result = validateTransactionGroup('tx123', group);

    expect(result.isOk()).toBe(true);
  });

  test('should fail validation when transaction is missing', () => {
    const group: RawTransactionGroup = {
      transaction: undefined,
      receipts: [],
      balanceChanges: [],
      tokenTransfers: [],
    };

    const result = validateTransactionGroup('tx123', group);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Missing transaction record for hash tx123');
    }
  });

  test('should allow empty receipts, activities, and ftTransfers', () => {
    const group: RawTransactionGroup = {
      transaction: createTransaction(),
      receipts: [],
      balanceChanges: [],
      tokenTransfers: [],
    };

    const result = validateTransactionGroup('tx123', group);

    expect(result.isOk()).toBe(true);
  });
});

describe('NEAR V3 Processor Utils - convertReceiptToProcessorType', () => {
  test('should convert receipt and add empty arrays', () => {
    const receipt = createReceipt({
      receiptId: 'receipt1',
      gasBurnt: '1000000000000',
      tokensBurntYocto: '100000000000000000000',
    });

    const converted = convertReceiptToProcessorType(receipt);

    expect(converted.receiptId).toBe('receipt1');
    expect(converted.gasBurnt).toBe('1000000000000');
    expect(converted.tokensBurntYocto).toBe('100000000000000000000');
    expect(converted.balanceChanges).toEqual([]);
    expect(converted.tokenTransfers).toEqual([]);
  });

  test('should preserve all receipt fields', () => {
    const receipt = createReceipt({
      receiptId: 'receipt1',
      transactionHash: 'tx123',
      predecessorAccountId: 'alice.near',
      receiverAccountId: 'bob.near',
      receiptKind: 'ACTION',
      blockHash: 'block123',
      blockHeight: 12345,
      blockTimestamp: 1640000000,
      executorAccountId: 'bob.near',
      status: true,
      logs: ['log1', 'log2'],
      actions: [{ actionType: 'transfer', deposit: '1000' }],
    });

    const converted = convertReceiptToProcessorType(receipt);

    expect(converted.receiptId).toBe('receipt1');
    expect(converted.transactionHash).toBe('tx123');
    expect(converted.predecessorAccountId).toBe('alice.near');
    expect(converted.receiverAccountId).toBe('bob.near');
    expect(converted.receiptKind).toBe('ACTION');
    expect(converted.blockHash).toBe('block123');
    expect(converted.blockHeight).toBe(12345);
    expect(converted.blockTimestamp).toBe(1640000000);
    expect(converted.executorAccountId).toBe('bob.near');
    expect(converted.status).toBe(true);
    expect(converted.logs).toEqual(['log1', 'log2']);
    expect(converted.actions).toHaveLength(1);
  });
});

describe('NEAR V3 Processor Utils - correlateTransactionData', () => {
  test('should correlate activities and transfers to receipts', () => {
    const group: RawTransactionGroup = {
      transaction: createTransaction({ transactionHash: 'tx1' }),
      receipts: [
        createReceipt({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createReceipt({ receiptId: 'receipt2', transactionHash: 'tx1' }),
      ],
      balanceChanges: [
        createBalanceChange({ receiptId: 'receipt1', deltaAmountYocto: '-1000000000000000000000000' }),
        createBalanceChange({ receiptId: 'receipt2', deltaAmountYocto: '500000000000000000000000' }),
      ],
      tokenTransfers: [createTokenTransfer({ receiptId: 'receipt1', deltaAmountYocto: '-1000000' })],
    };

    const result = correlateTransactionData(group);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const correlated = result.value;
    expect(correlated.receipts).toHaveLength(2);

    // Receipt 1 should have 1 balance change and 1 token transfer
    expect(correlated.receipts[0]!.balanceChanges).toHaveLength(1);
    expect(correlated.receipts[0]!.tokenTransfers).toHaveLength(1);

    // Receipt 2 should have 1 balance change and 0 token transfers
    expect(correlated.receipts[1]!.balanceChanges).toHaveLength(1);
    expect(correlated.receipts[1]!.tokenTransfers).toHaveLength(0);
  });

  test('should fail-fast when activity missing deltaAmount', () => {
    const group: RawTransactionGroup = {
      transaction: createTransaction(),
      receipts: [createReceipt({ receiptId: 'receipt1' })],
      balanceChanges: [
        createBalanceChange({
          receiptId: 'receipt1',
          affectedAccountId: 'alice.near',
          deltaAmountYocto: undefined,
        }),
      ],
      tokenTransfers: [],
    };

    const result = correlateTransactionData(group);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Balance change missing deltaAmount');
      expect(result.error.message).toContain('receipt1');
      expect(result.error.message).toContain('alice.near');
    }
  });

  test('should fail when transaction is missing', () => {
    const group: RawTransactionGroup = {
      transaction: undefined,
      receipts: [],
      balanceChanges: [],
      tokenTransfers: [],
    };

    const result = correlateTransactionData(group);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Missing transaction in group');
    }
  });

  test('should handle orphaned activities and transfers', () => {
    // Activities/transfers with receipt IDs that don't match any receipt
    const group: RawTransactionGroup = {
      transaction: createTransaction(),
      receipts: [createReceipt({ receiptId: 'receipt1' })],
      balanceChanges: [
        createBalanceChange({ receiptId: 'receipt1', deltaAmountYocto: '-1000000000000000000000000' }),
        createBalanceChange({ receiptId: 'orphan-receipt', deltaAmountYocto: '500000000000000000000000' }),
      ],
      tokenTransfers: [createTokenTransfer({ receiptId: 'orphan-receipt', deltaAmountYocto: '-1000000' })],
    };

    const result = correlateTransactionData(group);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const correlated = result.value;

    expect(correlated.receipts).toHaveLength(2);

    const primary = correlated.receipts.find((r) => r.receiptId === 'receipt1');
    const synthetic = correlated.receipts.find((r) => r.receiptId.startsWith('tx:'));

    expect(primary).toBeDefined();
    expect(primary!.balanceChanges).toHaveLength(1);
    expect(primary!.tokenTransfers).toHaveLength(0);

    expect(synthetic).toBeDefined();
    expect(synthetic!.balanceChanges).toHaveLength(1);
    expect(synthetic!.tokenTransfers).toHaveLength(1);
  });

  test('should handle receipts with no activities or transfers', () => {
    const group: RawTransactionGroup = {
      transaction: createTransaction(),
      receipts: [createReceipt({ receiptId: 'receipt1' })],
      balanceChanges: [],
      tokenTransfers: [],
    };

    const result = correlateTransactionData(group);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const correlated = result.value;
    expect(correlated.receipts).toHaveLength(1);
    expect(correlated.receipts[0]!.balanceChanges).toEqual([]);
    expect(correlated.receipts[0]!.tokenTransfers).toEqual([]);
  });

  test('should handle multiple activities per receipt', () => {
    const group: RawTransactionGroup = {
      transaction: createTransaction(),
      receipts: [createReceipt({ receiptId: 'receipt1' })],
      balanceChanges: [
        createBalanceChange({ receiptId: 'receipt1', affectedAccountId: 'alice.near', deltaAmountYocto: '-1000' }),
        createBalanceChange({ receiptId: 'receipt1', affectedAccountId: 'bob.near', deltaAmountYocto: '1000' }),
        createBalanceChange({ receiptId: 'receipt1', affectedAccountId: 'carol.near', deltaAmountYocto: '-500' }),
      ],
      tokenTransfers: [],
    };

    const result = correlateTransactionData(group);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const correlated = result.value;
    expect(correlated.receipts[0]!.balanceChanges).toHaveLength(3);
  });
});

describe('NEAR V3 Processor Utils - deriveBalanceChangeDeltasFromAbsolutes', () => {
  test('should derive deltas from absolute balances across ordered activities', () => {
    const changes: NearBalanceChangeV3[] = [
      createBalanceChange({
        receiptId: 'r1',
        deltaAmountYocto: undefined,
        absoluteNonstakedAmount: '100',
        direction: 'INBOUND',
        timestamp: 1,
        blockHeight: '1',
      }),
      createBalanceChange({
        receiptId: 'r2',
        deltaAmountYocto: undefined,
        absoluteNonstakedAmount: '150',
        direction: 'INBOUND',
        timestamp: 2,
        blockHeight: '2',
      }),
      createBalanceChange({
        receiptId: 'r3',
        deltaAmountYocto: undefined,
        absoluteNonstakedAmount: '120',
        direction: 'OUTBOUND',
        timestamp: 3,
        blockHeight: '3',
      }),
    ];

    const result = deriveBalanceChangeDeltasFromAbsolutes(changes);

    expect(result.derivedDeltas.get('r1:bc:0')).toBe('100');
    expect(result.derivedDeltas.get('r2:bc:0')).toBe('50');
    expect(result.derivedDeltas.get('r3:bc:0')).toBe('-30');
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('assumed prior balance 0');
  });

  test('should warn when first activity cannot be derived', () => {
    const changes: NearBalanceChangeV3[] = [
      createBalanceChange({
        receiptId: 'r1',
        deltaAmountYocto: undefined,
        absoluteNonstakedAmount: '100',
        direction: 'OUTBOUND',
        timestamp: 1,
        blockHeight: '1',
      }),
    ];

    const result = deriveBalanceChangeDeltasFromAbsolutes(changes);

    expect(result.derivedDeltas.size).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('Unable to derive');
  });

  test('should prioritize receipt-linked events when timestamps match', () => {
    const changes: NearBalanceChangeV3[] = [
      createBalanceChange({
        receiptId: 'r0',
        deltaAmountYocto: '90',
        absoluteNonstakedAmount: '90',
        direction: 'INBOUND',
        timestamp: 1,
        blockHeight: '1',
      }),
      createBalanceChange({
        receiptId: 'r1',
        deltaAmountYocto: undefined,
        absoluteNonstakedAmount: '100',
        direction: 'INBOUND',
        timestamp: 2,
        blockHeight: '2',
      }),
      createBalanceChange({
        receiptId: undefined,
        deltaAmountYocto: undefined,
        absoluteNonstakedAmount: '100',
        direction: 'OUTBOUND',
        timestamp: 2,
        blockHeight: '2',
      }),
    ];

    const result = deriveBalanceChangeDeltasFromAbsolutes(changes);

    expect(result.derivedDeltas.get('r1:bc:0')).toBe('10');
  });
});

describe('NEAR V3 Processor Utils - extractReceiptFees', () => {
  test('should extract fee from receipt gasBurnt and tokensBurnt (priority 1)', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: '2428000000000',
      tokensBurntYocto: '242800000000000000000', // Raw yoctoNEAR
      balanceChanges: [],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.asset).toBe('NEAR');
    expect(result.movements[0]!.amount.toFixed()).toBe('0.0002428');
    expect(result.movements[0]!.direction).toBe('out');
    expect(result.movements[0]!.flowType).toBe('fee');
    expect(result.warning).toBeUndefined();
  });

  test('should extract fee from balance changes with fee cause (priority 2)', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: undefined,
      tokensBurntYocto: undefined,
      balanceChanges: [
        createBalanceChange({
          cause: 'CONTRACT_REWARD',
          deltaAmountYocto: '100000000000000000000000',
        }),
        createBalanceChange({
          cause: 'FEE',
          deltaAmountYocto: '-50000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.asset).toBe('NEAR');
    expect(result.movements[0]!.amount.toFixed()).toBe('0.00005');
    expect(result.movements[0]!.direction).toBe('out');
    expect(result.movements[0]!.flowType).toBe('fee');
    expect(result.warning).toBeUndefined();
  });

  test('should extract fee from balance changes with gas cause', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: undefined,
      tokensBurntYocto: undefined,
      balanceChanges: [
        createBalanceChange({
          cause: 'GAS_REFUND',
          deltaAmountYocto: '10000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.amount.toFixed()).toBe('0.00001');
  });

  test('should ignore TRANSACTION cause for fee extraction', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: undefined,
      tokensBurntYocto: undefined,
      balanceChanges: [
        createBalanceChange({
          cause: 'TRANSACTION',
          deltaAmountYocto: '-100000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(0);
  });

  test('should warn on fee mismatch >1% between sources', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: '2428000000000',
      tokensBurntYocto: '1000000000000000000000',
      balanceChanges: [
        createBalanceChange({
          cause: 'FEE',
          deltaAmountYocto: '-500000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    // Should use receipt value (priority 1)
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.amount.toFixed()).toBe('0.001');

    // Should include warning about mismatch
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('Fee mismatch');
    expect(result.warning).toContain('tokensBurnt=0.001 NEAR');
    expect(result.warning).toContain('balance changes=0.0005 NEAR');
    expect(result.warning).toContain('Using receipt value as authoritative');
  });

  test('should not warn on fee mismatch <1%', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: '2428000000000',
      tokensBurntYocto: '1000000000000000000000',
      balanceChanges: [
        createBalanceChange({
          cause: 'FEE',
          deltaAmountYocto: '-1005000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(1);
    expect(result.warning).toBeUndefined();
  });

  test('should handle zero tokensBurnt', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: '2428000000000',
      tokensBurntYocto: '0',
      balanceChanges: [],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(0);
    expect(result.warning).toBeUndefined();
  });

  test('should return empty movements when no fees found', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: undefined,
      tokensBurntYocto: undefined,
      balanceChanges: [
        createBalanceChange({
          cause: 'TRANSFER',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(0);
    expect(result.warning).toBeUndefined();
  });

  test('should aggregate multiple fee-related balance changes', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      gasBurnt: undefined,
      tokensBurntYocto: undefined,
      balanceChanges: [
        createBalanceChange({
          cause: 'FEE',
          deltaAmountYocto: '-100000000000000000000',
        }),
        createBalanceChange({
          cause: 'GAS',
          deltaAmountYocto: '-50000000000000000000',
        }),
        createBalanceChange({
          cause: 'TRANSACTION',
          deltaAmountYocto: '-25000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const result = extractReceiptFees(receipt, 'alice.near');

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.amount.toFixed()).toBe('0.00015');
  });
});

describe('NEAR V3 Processor Utils - extractFlows', () => {
  test('should extract NEAR inflow from INBOUND balance change', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [
        createBalanceChange({
          direction: 'INBOUND',
          cause: 'TRANSFER',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
    expect(flows[0]!.asset).toBe('NEAR');
    expect(flows[0]!.amount.toFixed()).toBe('1');
    expect(flows[0]!.direction).toBe('in');
    expect(flows[0]!.flowType).toBe('native');
  });

  test('should extract NEAR outflow from OUTBOUND balance change', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [
        createBalanceChange({
          direction: 'OUTBOUND',
          cause: 'TRANSFER',
          deltaAmountYocto: '-2000000000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
    expect(flows[0]!.asset).toBe('NEAR');
    expect(flows[0]!.amount.toFixed()).toBe('2');
    expect(flows[0]!.direction).toBe('out');
    expect(flows[0]!.flowType).toBe('native');
  });

  test('should derive direction from delta sign when mismatch occurs', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [
        createBalanceChange({
          direction: 'INBOUND',
          cause: 'RECEIPT',
          deltaAmountYocto: '-1000000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
    expect(flows[0]!.direction).toBe('out');
  });

  test('should skip fee-related balance changes', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [
        createBalanceChange({
          cause: 'FEE',
          deltaAmountYocto: '-100000000000000000000',
        }),
        createBalanceChange({
          cause: 'GAS_REFUND',
          deltaAmountYocto: '50000000000000000000',
        }),
        createBalanceChange({
          cause: 'TRANSFER',
          direction: 'INBOUND',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const flows = extractFlows(receipt, 'alice.near');

    // Should only include the TRANSFER, not fee/gas
    expect(flows).toHaveLength(1);
    expect(flows[0]!.flowType).toBe('native');
  });

  test('should skip zero delta balance changes', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [
        createBalanceChange({
          cause: 'TRANSFER',
          deltaAmountYocto: '0',
        }),
        createBalanceChange({
          cause: 'TRANSFER',
          direction: 'INBOUND',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
    expect(flows[0]!.amount.toFixed()).toBe('1');
  });

  test('should skip balance changes with missing deltaAmount', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [
        createBalanceChange({
          cause: 'TRANSFER',
          deltaAmountYocto: undefined,
        }),
        createBalanceChange({
          cause: 'TRANSFER',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ],
      tokenTransfers: [],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
  });

  test('should extract token transfer flows', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [],
      tokenTransfers: [
        createTokenTransfer({
          affectedAccountId: 'alice.near',
          deltaAmountYocto: '-1000000',
          symbol: 'USDC',
          contractAddress: 'usdc.token.near',
        }),
      ],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
    expect(flows[0]!.asset).toBe('USDC');
    expect(flows[0]!.amount.toFixed()).toBe('1');
    expect(flows[0]!.contractAddress).toBe('usdc.token.near');
    expect(flows[0]!.direction).toBe('in'); // affected account is primary address
    expect(flows[0]!.flowType).toBe('token_transfer');
  });

  test('should determine token transfer direction from affected account', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [],
      tokenTransfers: [
        createTokenTransfer({
          affectedAccountId: 'bob.near',
          deltaAmountYocto: '1000000',
          symbol: 'USDC',
        }),
      ],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
    expect(flows[0]!.direction).toBe('out'); // affected account is NOT primary address
  });

  test('should skip zero delta token transfers', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [],
      tokenTransfers: [
        createTokenTransfer({
          deltaAmountYocto: '0',
          symbol: 'USDC',
        }),
      ],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(0);
  });

  test('should handle mixed NEAR and token flows', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [
        createBalanceChange({
          direction: 'OUTBOUND',
          cause: 'TRANSFER',
          deltaAmountYocto: '-1000000000000000000000000',
        }),
      ],
      tokenTransfers: [
        createTokenTransfer({
          affectedAccountId: 'alice.near',
          deltaAmountYocto: '500000',
          symbol: 'USDC',
        }),
      ],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(2);
    expect(flows.find((f) => f.asset === 'NEAR')).toBeDefined();
    expect(flows.find((f) => f.asset === 'USDC')).toBeDefined();
  });

  test('should handle UNKNOWN token symbol', () => {
    const receipt: NearReceipt = {
      ...createReceipt(),
      balanceChanges: [],
      tokenTransfers: [
        createTokenTransfer({
          affectedAccountId: 'alice.near',
          deltaAmountYocto: '1000000',
          symbol: undefined,
        }),
      ],
    };

    const flows = extractFlows(receipt, 'alice.near');

    expect(flows).toHaveLength(1);
    expect(flows[0]!.asset).toBe('UNKNOWN');
  });
});

describe('NEAR V3 Processor Utils - consolidateByAsset', () => {
  test('should consolidate same asset movements', () => {
    const movements: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('1.5'),
        direction: 'in',
        flowType: 'native',
      },
      {
        asset: 'NEAR',
        amount: new Decimal('2.5'),
        direction: 'in',
        flowType: 'native',
      },
    ];

    const consolidated = consolidateByAsset(movements);

    expect(consolidated.size).toBe(1);
    const nearMovement = consolidated.get('NEAR');
    expect(nearMovement).toBeDefined();
    expect(nearMovement!.amount.toFixed()).toBe('4');
  });

  test('should keep different assets separate', () => {
    const movements: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('1'),
        direction: 'in',
        flowType: 'native',
      },
      {
        asset: 'USDC',
        amount: new Decimal('100'),
        direction: 'out',
        flowType: 'token_transfer',
        contractAddress: 'usdc.token.near',
      },
    ];

    const consolidated = consolidateByAsset(movements);

    expect(consolidated.size).toBe(2);
    expect(consolidated.get('NEAR')).toBeDefined();
    expect(consolidated.get('usdc.token.near')).toBeDefined();
  });

  test('should use contract address as key for tokens', () => {
    const movements: Movement[] = [
      {
        asset: 'USDC',
        amount: new Decimal('50'),
        contractAddress: 'usdc.token.near',
        direction: 'in',
        flowType: 'token_transfer',
      },
      {
        asset: 'USDC',
        amount: new Decimal('50'),
        contractAddress: 'usdc.token.near',
        direction: 'in',
        flowType: 'token_transfer',
      },
    ];

    const consolidated = consolidateByAsset(movements);

    expect(consolidated.size).toBe(1);
    const usdcMovement = consolidated.get('usdc.token.near');
    expect(usdcMovement).toBeDefined();
    expect(usdcMovement!.amount.toFixed()).toBe('100');
  });

  test('should keep different contract addresses separate', () => {
    const movements: Movement[] = [
      {
        asset: 'USDC',
        amount: new Decimal('50'),
        contractAddress: 'usdc.token.near',
        direction: 'in',
        flowType: 'token_transfer',
      },
      {
        asset: 'USDC',
        amount: new Decimal('50'),
        contractAddress: 'usdc.other.near',
        direction: 'in',
        flowType: 'token_transfer',
      },
    ];

    const consolidated = consolidateByAsset(movements);

    expect(consolidated.size).toBe(2);
    expect(consolidated.get('usdc.token.near')).toBeDefined();
    expect(consolidated.get('usdc.other.near')).toBeDefined();
  });

  test('should handle empty movements', () => {
    const consolidated = consolidateByAsset([]);
    expect(consolidated.size).toBe(0);
  });

  test('should preserve movement properties', () => {
    const movements: Movement[] = [
      {
        asset: 'USDC',
        amount: new Decimal('50'),
        contractAddress: 'usdc.token.near',
        direction: 'out',
        flowType: 'token_transfer',
      },
    ];

    const consolidated = consolidateByAsset(movements);

    const movement = consolidated.get('usdc.token.near');
    expect(movement).toBeDefined();
    expect(movement!.asset).toBe('USDC');
    expect(movement!.contractAddress).toBe('usdc.token.near');
    expect(movement!.direction).toBe('out');
    expect(movement!.flowType).toBe('token_transfer');
  });
});

describe('NEAR V3 Processor Utils - classifyOperation', () => {
  const createCorrelated = (overrides: Partial<{ receipts: NearReceipt[] }> = {}) => ({
    transaction: createTransaction(),
    receipts: overrides.receipts || [],
  });

  test('should classify deposit (inflows only, no tokens)', () => {
    const inflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('5'),
        direction: 'in',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated(), inflows, []);

    expect(classification.category).toBe('transfer');
    expect(classification.type).toBe('deposit');
  });

  test('should classify deposit with token transfers', () => {
    const inflows: Movement[] = [
      {
        asset: 'USDC',
        amount: new Decimal('100'),
        contractAddress: 'usdc.token.near',
        direction: 'in',
        flowType: 'token_transfer',
      },
    ];

    const classification = classifyOperation(createCorrelated(), inflows, []);

    expect(classification.category).toBe('transfer');
    expect(classification.type).toBe('deposit');
  });

  test('should classify withdrawal (outflows only, no tokens)', () => {
    const outflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('3'),
        direction: 'out',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated(), [], outflows);

    expect(classification.category).toBe('transfer');
    expect(classification.type).toBe('withdrawal');
  });

  test('should classify withdrawal with token transfers', () => {
    const outflows: Movement[] = [
      {
        asset: 'USDC',
        amount: new Decimal('50'),
        contractAddress: 'usdc.token.near',
        direction: 'out',
        flowType: 'token_transfer',
      },
    ];

    const classification = classifyOperation(createCorrelated(), [], outflows);

    expect(classification.category).toBe('transfer');
    expect(classification.type).toBe('withdrawal');
  });

  test('should classify swap (both flows with tokens)', () => {
    const inflows: Movement[] = [
      {
        asset: 'USDT',
        amount: new Decimal('100'),
        contractAddress: 'usdt.token.near',
        direction: 'in',
        flowType: 'token_transfer',
      },
    ];
    const outflows: Movement[] = [
      {
        asset: 'USDC',
        amount: new Decimal('100'),
        contractAddress: 'usdc.token.near',
        direction: 'out',
        flowType: 'token_transfer',
      },
    ];

    const classification = classifyOperation(createCorrelated(), inflows, outflows);

    expect(classification.category).toBe('trade');
    expect(classification.type).toBe('swap');
  });

  test('should classify transfer (both flows, no tokens)', () => {
    const inflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('1'),
        direction: 'in',
        flowType: 'native',
      },
    ];
    const outflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('2'),
        direction: 'out',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated(), inflows, outflows);

    expect(classification.category).toBe('transfer');
    expect(classification.type).toBe('transfer');
  });

  test('should classify fee-only transaction (no flows)', () => {
    const classification = classifyOperation(createCorrelated(), [], []);

    expect(classification.category).toBe('defi');
    expect(classification.type).toBe('batch');
  });

  test('should classify contract interaction as batch (no flows)', () => {
    const classification = classifyOperation(createCorrelated(), [], []);

    expect(classification.category).toBe('defi');
    expect(classification.type).toBe('batch');
  });

  test('should classify staking operation (stake action)', () => {
    const stakeAction: NearReceiptActionV3 = {
      actionType: 'stake',
    };

    const receipts: NearReceipt[] = [
      {
        ...createReceipt(),
        actions: [stakeAction],
      },
    ];

    const outflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('100'),
        direction: 'out',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated({ receipts }), [], outflows);

    expect(classification.category).toBe('staking');
    expect(classification.type).toBe('stake');
  });

  test('should classify staking reward (inflow with contract reward cause)', () => {
    const balanceChange = createBalanceChange({
      direction: 'INBOUND',
      cause: 'CONTRACT_REWARD',
      deltaAmountYocto: '1000000000000000000000000',
    });

    const receipts: NearReceipt[] = [
      {
        ...createReceipt(),
        balanceChanges: [balanceChange],
      },
    ];

    const inflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('0.5'),
        direction: 'in',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated({ receipts }), inflows, []);

    expect(classification.category).toBe('staking');
    expect(classification.type).toBe('reward');
  });

  test('should classify refund (inflow with gas refund cause)', () => {
    const balanceChange = createBalanceChange({
      direction: 'INBOUND',
      cause: 'GAS_REFUND',
      deltaAmountYocto: '250000000000000000000000',
    });

    const receipts: NearReceipt[] = [
      {
        ...createReceipt(),
        balanceChanges: [balanceChange],
      },
    ];

    const inflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('0.25'),
        direction: 'in',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated({ receipts }), inflows, []);

    expect(classification.category).toBe('transfer');
    expect(classification.type).toBe('refund');
  });

  test('should classify account creation (create_account action)', () => {
    const createAccountAction: NearReceiptActionV3 = {
      actionType: 'create_account',
    };

    const receipts: NearReceipt[] = [
      {
        ...createReceipt(),
        actions: [createAccountAction],
      },
    ];

    const classification = classifyOperation(createCorrelated({ receipts }), [], []);

    expect(classification.category).toBe('defi');
    expect(classification.type).toBe('batch');
  });

  test('should prioritize staking over regular deposit (stake action with outflow)', () => {
    const stakeAction: NearReceiptActionV3 = {
      actionType: 'stake',
    };

    const receipts: NearReceipt[] = [
      {
        ...createReceipt(),
        actions: [stakeAction],
      },
    ];

    const outflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('100'),
        direction: 'out',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated({ receipts }), [], outflows);

    expect(classification.category).toBe('staking');
    expect(classification.type).toBe('stake');
  });

  test('should prioritize rewards over regular deposit (contract reward cause with inflow)', () => {
    const balanceChange = createBalanceChange({
      direction: 'INBOUND',
      cause: 'CONTRACT_REWARD',
      deltaAmountYocto: '1000000000000000000000000',
    });

    const receipts: NearReceipt[] = [
      {
        ...createReceipt(),
        balanceChanges: [balanceChange],
      },
    ];

    const inflows: Movement[] = [
      {
        asset: 'NEAR',
        amount: new Decimal('1'),
        direction: 'in',
        flowType: 'native',
      },
    ];

    const classification = classifyOperation(createCorrelated({ receipts }), inflows, []);

    expect(classification.category).toBe('staking');
    expect(classification.type).toBe('reward');
  });
});
