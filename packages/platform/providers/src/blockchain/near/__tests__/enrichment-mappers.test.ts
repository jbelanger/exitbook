import { describe, expect, test } from 'vitest';

import { mapNearBlocksActivityToAccountChange, mapNearBlocksFtTransactionToTokenTransfer } from '../mapper-utils.js';
import type { NearBlocksActivity, NearBlocksFtTransaction } from '../nearblocks/nearblocks.schemas.js';

describe('mapNearBlocksActivityToAccountChange', () => {
  const accountId = 'alice.near';

  test('should map INBOUND activity to positive account change', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000', // 1 NEAR in yocto
      block_timestamp: '1640000000000000000',
      direction: 'INBOUND',
      receipt_id: 'receipt123',
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(accountId);
      expect(result.value.postBalance).toBe('1'); // Positive for INBOUND
      expect(result.value.preBalance).toBe('0');
    }
  });

  test('should map OUTBOUND activity to negative account change', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '500000000000000000000000', // 0.5 NEAR in yocto
      block_timestamp: '1640000000000000000',
      direction: 'OUTBOUND',
      receipt_id: 'receipt456',
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(accountId);
      expect(result.value.postBalance).toBe('-0.5'); // Negative for OUTBOUND
      expect(result.value.preBalance).toBe('0');
    }
  });

  test('should handle very large amounts', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000000000', // 1M NEAR in yocto
      block_timestamp: '1640000000000000000',
      direction: 'INBOUND',
      receipt_id: 'receipt789',
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.postBalance).toBe('1000000');
    }
  });

  test('should handle zero amounts', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '0',
      block_timestamp: '1640000000000000000',
      direction: 'INBOUND',
      receipt_id: 'receipt000',
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.postBalance).toBe('0');
    }
  });

  test('should handle activity with optional fields', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '2000000000000000000000000',
      block_timestamp: '1640000000000000000',
      cause: 'CONTRACT_REWARD',
      counterparty: 'validator.near',
      delta_nonstaked_amount: '100000000000000000000000',
      direction: 'INBOUND',
      receipt_id: 'receipt123',
      transaction_hash: 'tx123',
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(accountId);
      expect(result.value.postBalance).toBe('2');
    }
  });

  test('should reject invalid activity data', () => {
    const invalidActivity = {
      absolute_nonstaked_amount: '',
      block_timestamp: '1640000000000000000',
      direction: 'INBOUND',
      receipt_id: 'receipt123',
    } as NearBlocksActivity;

    const result = mapNearBlocksActivityToAccountChange(invalidActivity, accountId);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const errorMessage = result.error.type === 'error' ? result.error.message : result.error.reason;
      expect(errorMessage).toContain('Invalid NearBlocks activity input data');
    }
  });

  test('should reject activity with invalid direction', () => {
    const invalidActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      block_timestamp: '1640000000000000000',
      direction: 'INVALID',
      receipt_id: 'receipt123',
    } as unknown as NearBlocksActivity;

    const result = mapNearBlocksActivityToAccountChange(invalidActivity, accountId);

    expect(result.isErr()).toBe(true);
  });

  test('should handle implicit account IDs', () => {
    const implicitAccountId = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000',
      block_timestamp: '1640000000000000000',
      direction: 'INBOUND',
      receipt_id: 'receipt123',
    };

    const result = mapNearBlocksActivityToAccountChange(activity, implicitAccountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(implicitAccountId);
    }
  });
});

describe('mapNearBlocksFtTransactionToTokenTransfer', () => {
  const accountId = 'alice.near';

  test('should map INBOUND FT transaction (affected_account_id matches user)', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '1000000', // 1 USDC (6 decimals)
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        name: 'USD Coin',
        symbol: 'USDC',
      },
      involved_account_id: 'bob.near',
      receipt_id: 'receipt123',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('1');
      expect(result.value.symbol).toBe('USDC');
      expect(result.value.contractAddress).toBe('usdc.near');
      expect(result.value.decimals).toBe(6);
      expect(result.value.from).toBe('bob.near');
      expect(result.value.to).toBe(accountId);
    }
  });

  test('should map OUTBOUND FT transaction (user sends tokens)', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: 'bob.near', // Receiver
      block_timestamp: '1640000000000000000',
      delta_amount: '-1000000', // -1 USDC (6 decimals)
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        symbol: 'USDC',
      },
      involved_account_id: 'bob.near', // Receiver as involved party
      receipt_id: 'receipt456',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('1'); // Absolute value
      expect(result.value.from).toBe(accountId);
      expect(result.value.to).toBe('bob.near');
    }
  });

  test('should handle token with 18 decimals', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '1000000000000000000', // 1 token with 18 decimals
      ft: {
        contract: 'dai.near',
        decimals: 18,
        symbol: 'DAI',
      },
      receipt_id: 'receipt789',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('1');
      expect(result.value.decimals).toBe(18);
    }
  });

  test('should handle token with 0 decimals', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '100',
      ft: {
        contract: 'nft-count.near',
        decimals: 0,
        symbol: 'NFT',
      },
      receipt_id: 'receipt000',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('100');
      expect(result.value.decimals).toBe(0);
    }
  });

  test('should handle missing involved_account_id (uses contract as counterparty)', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '1000000',
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        symbol: 'USDC',
      },
      receipt_id: 'receipt123',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.from).toBe('usdc.near'); // Falls back to contract
      expect(result.value.to).toBe(accountId);
    }
  });

  test('should handle missing delta_amount (defaults to 0)', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      ft: {
        contract: 'token.near',
        decimals: 6,
        symbol: 'TKN',
      },
      receipt_id: 'receipt123',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('0');
    }
  });

  test('should handle missing symbol (optional field)', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '1000000',
      ft: {
        contract: 'unknown.near',
        decimals: 6,
      },
      receipt_id: 'receipt123',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.symbol).toBeUndefined();
      expect(result.value.amount).toBe('1');
    }
  });

  test('should handle very large token amounts', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '1000000000000000000000000', // 1M tokens with 18 decimals
      ft: {
        contract: 'big.near',
        decimals: 18,
        symbol: 'BIG',
      },
      receipt_id: 'receipt999',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('1000000');
    }
  });

  test('should reject FT transaction without ft metadata', () => {
    const invalidFtTx = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      receipt_id: 'receipt123',
    } as NearBlocksFtTransaction;

    const result = mapNearBlocksFtTransactionToTokenTransfer(invalidFtTx, accountId);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const errorMessage = result.error.type === 'error' ? result.error.message : result.error.reason;
      expect(errorMessage).toContain('FT transaction missing token metadata');
    }
  });

  test('should reject invalid FT transaction data', () => {
    const invalidFtTx = {
      affected_account_id: '',
      block_timestamp: '1640000000000000000',
      receipt_id: 'receipt123',
    } as NearBlocksFtTransaction;

    const result = mapNearBlocksFtTransactionToTokenTransfer(invalidFtTx, accountId);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const errorMessage = result.error.type === 'error' ? result.error.message : result.error.reason;
      expect(errorMessage).toContain('Invalid NearBlocks FT transaction input data');
    }
  });

  test('should handle negative delta amounts correctly (absolute value)', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '-5000000', // -5 USDC
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        symbol: 'USDC',
      },
      receipt_id: 'receipt456',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('5'); // Absolute value
    }
  });

  test('should handle implicit account IDs', () => {
    const implicitAccountId = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: implicitAccountId,
      block_timestamp: '1640000000000000000',
      delta_amount: '1000000',
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        symbol: 'USDC',
      },
      receipt_id: 'receipt123',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, implicitAccountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.to).toBe(implicitAccountId);
    }
  });

  test('should handle FT transaction with all optional fields present', () => {
    const ftTx: NearBlocksFtTransaction = {
      affected_account_id: accountId,
      block_height: 100000,
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      delta_amount: '1000000',
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        name: 'USD Coin',
        symbol: 'USDC',
      },
      involved_account_id: 'bob.near',
      receipt_id: 'receipt123',
      transaction_hash: 'tx123',
    };

    const result = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.amount).toBe('1');
      expect(result.value.symbol).toBe('USDC');
      expect(result.value.from).toBe('bob.near');
      expect(result.value.to).toBe(accountId);
    }
  });
});
