import { describe, expect, test } from 'vitest';

import {
  NearBlocksActivitiesResponseSchema,
  NearBlocksActivitySchema,
  NearBlocksFtTransactionSchema,
  NearBlocksFtTransactionsResponseSchema,
  NearBlocksReceiptSchema,
  NearBlocksReceiptsResponseSchema,
} from '../nearblocks.schemas.js';

describe('NearBlocksActivitySchema', () => {
  test('should validate valid activity', () => {
    const validActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      absolute_staked_amount: '0',
      affected_account_id: 'alice.near',
      block_height: '100000',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      direction: 'INBOUND',
      event_index: '1',
      involved_account_id: undefined,
      receipt_id: 'receipt123',
      transaction_hash: undefined,
    };

    const result = NearBlocksActivitySchema.safeParse(validActivity);
    expect(result.success).toBe(true);
  });

  test('should validate activity with optional fields', () => {
    const activityWithOptionals = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      absolute_staked_amount: '0',
      affected_account_id: 'alice.near',
      block_height: '100001',
      block_timestamp: '1640000000000000000',
      cause: 'CONTRACT_REWARD',
      delta_nonstaked_amount: '100000000000000000000000',
      direction: 'OUTBOUND',
      event_index: '2',
      involved_account_id: 'validator.near',
      receipt_id: 'receipt123',
      transaction_hash: 'tx123',
    };

    const result = NearBlocksActivitySchema.safeParse(activityWithOptionals);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cause).toBe('CONTRACT_REWARD');
      expect(result.data.involved_account_id).toBe('validator.near');
    }
  });

  test('should reject activity with empty absolute_nonstaked_amount', () => {
    const invalidActivity = {
      absolute_nonstaked_amount: '',
      block_timestamp: '1640000000000000000',
      direction: 'INBOUND',
      receipt_id: 'receipt123',
    };

    const result = NearBlocksActivitySchema.safeParse(invalidActivity);
    expect(result.success).toBe(false);
  });

  test('should reject activity with empty block_timestamp', () => {
    const invalidActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      block_timestamp: '',
      direction: 'INBOUND',
      receipt_id: 'receipt123',
    };

    const result = NearBlocksActivitySchema.safeParse(invalidActivity);
    expect(result.success).toBe(false);
  });

  test('should reject activity with empty receipt_id', () => {
    const invalidActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      block_timestamp: '1640000000000000000',
      direction: 'INBOUND',
      receipt_id: '',
    };

    const result = NearBlocksActivitySchema.safeParse(invalidActivity);
    expect(result.success).toBe(false);
  });

  test('should reject activity with invalid direction', () => {
    const invalidActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      block_timestamp: '1640000000000000000',
      direction: 'INVALID',
      receipt_id: 'receipt123',
    };

    const result = NearBlocksActivitySchema.safeParse(invalidActivity);
    expect(result.success).toBe(false);
  });

  test('should accept both INBOUND and OUTBOUND directions', () => {
    const inbound = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      absolute_staked_amount: '0',
      affected_account_id: 'alice.near',
      block_height: '123456',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSACTION',
      direction: 'INBOUND',
      event_index: '0',
      involved_account_id: 'bob.near',
      receipt_id: 'receipt123',
      transaction_hash: 'tx123',
    };

    const outbound = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      absolute_staked_amount: '0',
      affected_account_id: 'alice.near',
      block_height: '123457',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSACTION',
      direction: 'OUTBOUND',
      event_index: '0',
      involved_account_id: 'bob.near',
      receipt_id: 'receipt456',
      transaction_hash: 'tx456',
    };

    expect(NearBlocksActivitySchema.safeParse(inbound).success).toBe(true);
    expect(NearBlocksActivitySchema.safeParse(outbound).success).toBe(true);
  });
});

describe('NearBlocksActivitiesResponseSchema', () => {
  test('should validate response with activities', () => {
    const response = {
      activities: [
        {
          absolute_nonstaked_amount: '1000000000000000000000000',
          absolute_staked_amount: '0',
          affected_account_id: 'alice.near',
          block_height: '123456',
          block_timestamp: '1640000000000000000',
          cause: 'TRANSACTION',
          direction: 'INBOUND' as const,
          event_index: '0',
          involved_account_id: 'bob.near',
          receipt_id: 'receipt123',
          transaction_hash: 'tx123',
        },
      ],
    };

    const result = NearBlocksActivitiesResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  test('should validate response with cursor', () => {
    const response = {
      cursor: 'next-page-cursor',
      activities: [],
    };

    const result = NearBlocksActivitiesResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursor).toBe('next-page-cursor');
    }
  });

  test('should validate empty activities array', () => {
    const response = {
      activities: [],
    };

    const result = NearBlocksActivitiesResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe('NearBlocksReceiptSchema', () => {
  test('should validate valid receipt', () => {
    const validReceipt = {
      transaction_hash: 'tx123',
      predecessor_account_id: 'alice.near',
      receipt_id: 'receipt123',
      receiver_account_id: 'bob.near',
    };

    const result = NearBlocksReceiptSchema.safeParse(validReceipt);
    expect(result.success).toBe(true);
  });

  test('should validate receipt with optional block_timestamp', () => {
    const receiptWithTimestamp = {
      block_timestamp: '1640000000000000000',
      transaction_hash: 'tx123',
      predecessor_account_id: 'alice.near',
      receipt_id: 'receipt123',
      receiver_account_id: 'bob.near',
    };

    const result = NearBlocksReceiptSchema.safeParse(receiptWithTimestamp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.block_timestamp).toBe('1640000000000000000');
    }
  });

  test('should reject receipt with empty transaction_hash', () => {
    const invalidReceipt = {
      transaction_hash: '',
      predecessor_account_id: 'alice.near',
      receipt_id: 'receipt123',
      receiver_account_id: 'bob.near',
    };

    const result = NearBlocksReceiptSchema.safeParse(invalidReceipt);
    expect(result.success).toBe(false);
  });

  test('should reject receipt with empty predecessor_account_id', () => {
    const invalidReceipt = {
      transaction_hash: 'tx123',
      predecessor_account_id: '',
      receipt_id: 'receipt123',
      receiver_account_id: 'bob.near',
    };

    const result = NearBlocksReceiptSchema.safeParse(invalidReceipt);
    expect(result.success).toBe(false);
  });

  test('should reject receipt with empty receipt_id', () => {
    const invalidReceipt = {
      transaction_hash: 'tx123',
      predecessor_account_id: 'alice.near',
      receipt_id: '',
      receiver_account_id: 'bob.near',
    };

    const result = NearBlocksReceiptSchema.safeParse(invalidReceipt);
    expect(result.success).toBe(false);
  });

  test('should reject receipt with empty receiver_account_id', () => {
    const invalidReceipt = {
      transaction_hash: 'tx123',
      predecessor_account_id: 'alice.near',
      receipt_id: 'receipt123',
      receiver_account_id: '',
    };

    const result = NearBlocksReceiptSchema.safeParse(invalidReceipt);
    expect(result.success).toBe(false);
  });
});

describe('NearBlocksReceiptsResponseSchema', () => {
  test('should validate response with receipts', () => {
    const response = {
      txns: [
        {
          transaction_hash: 'tx123',
          predecessor_account_id: 'alice.near',
          receipt_id: 'receipt123',
          receiver_account_id: 'bob.near',
        },
      ],
    };

    const result = NearBlocksReceiptsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  test('should validate response with cursor', () => {
    const response = {
      cursor: 'next-page-cursor',
      txns: [],
    };

    const result = NearBlocksReceiptsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursor).toBe('next-page-cursor');
    }
  });

  test('should validate empty receipts array', () => {
    const response = {
      txns: [],
    };

    const result = NearBlocksReceiptsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe('NearBlocksFtTransactionSchema', () => {
  test('should validate valid FT transaction', () => {
    const validFtTx = {
      affected_account_id: 'alice.near',
      block_timestamp: '1640000000000000000',
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        name: 'USD Coin',
        symbol: 'USDC',
      },
      receipt_id: 'receipt123',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(validFtTx);
    expect(result.success).toBe(true);
  });

  test('should validate FT transaction with optional fields', () => {
    const ftTxWithOptionals = {
      affected_account_id: 'alice.near',
      block_height: 100000,
      block_timestamp: '1640000000000000000',
      cause: 'MINT',
      delta_amount: '1000000',
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        symbol: 'USDC',
      },
      involved_account_id: 'bob.near',
      receipt_id: 'receipt123',
      transaction_hash: 'tx123',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(ftTxWithOptionals);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cause).toBe('MINT');
      expect(result.data.delta_amount).toBe('1000000');
      expect(result.data.involved_account_id).toBe('bob.near');
    }
  });

  test('should reject FT transaction with empty affected_account_id', () => {
    const invalidFtTx = {
      affected_account_id: '',
      block_timestamp: '1640000000000000000',
      receipt_id: 'receipt123',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(invalidFtTx);
    expect(result.success).toBe(false);
  });

  test('should reject FT transaction with empty block_timestamp', () => {
    const invalidFtTx = {
      affected_account_id: 'alice.near',
      block_timestamp: '',
      receipt_id: 'receipt123',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(invalidFtTx);
    expect(result.success).toBe(false);
  });

  test('should reject FT transaction with empty receipt_id', () => {
    const invalidFtTx = {
      affected_account_id: 'alice.near',
      block_timestamp: '1640000000000000000',
      receipt_id: '',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(invalidFtTx);
    expect(result.success).toBe(false);
  });

  test('should validate FT transaction with minimal ft metadata', () => {
    const ftTx = {
      affected_account_id: 'alice.near',
      block_timestamp: '1640000000000000000',
      ft: {
        contract: 'token.near',
        decimals: 18,
      },
      receipt_id: 'receipt123',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(ftTx);
    expect(result.success).toBe(true);
  });

  test('should reject FT with negative decimals', () => {
    const ftTx = {
      affected_account_id: 'alice.near',
      block_timestamp: '1640000000000000000',
      ft: {
        contract: 'token.near',
        decimals: -1,
      },
      receipt_id: 'receipt123',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(ftTx);
    expect(result.success).toBe(false);
  });

  test('should reject FT with empty contract', () => {
    const ftTx = {
      affected_account_id: 'alice.near',
      block_timestamp: '1640000000000000000',
      ft: {
        contract: '',
        decimals: 6,
      },
      receipt_id: 'receipt123',
    };

    const result = NearBlocksFtTransactionSchema.safeParse(ftTx);
    expect(result.success).toBe(false);
  });
});

describe('NearBlocksFtTransactionsResponseSchema', () => {
  test('should validate response with FT transactions', () => {
    const response = {
      txns: [
        {
          affected_account_id: 'alice.near',
          block_timestamp: '1640000000000000000',
          receipt_id: 'receipt123',
          ft: {
            contract: 'token.near',
            decimals: 18,
            name: 'Test Token',
            symbol: 'TEST',
          },
        },
      ],
    };

    const result = NearBlocksFtTransactionsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  test('should validate response with cursor', () => {
    const response = {
      cursor: 'next-page-cursor',
      txns: [],
    };

    const result = NearBlocksFtTransactionsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursor).toBe('next-page-cursor');
    }
  });

  test('should validate empty FT transactions array', () => {
    const response = {
      txns: [],
    };

    const result = NearBlocksFtTransactionsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });
});
