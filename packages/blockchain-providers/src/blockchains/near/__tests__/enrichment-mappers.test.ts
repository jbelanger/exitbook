import { parseDecimal } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import {
  mapNearBlocksActivityToAccountChange,
  mapNearBlocksFtTransactionToTokenTransfer,
} from '../providers/nearblocks/mapper-utils.ts';
import type { NearBlocksActivity, NearBlocksFtTransaction } from '../providers/nearblocks/nearblocks.schemas.ts';

describe('mapNearBlocksActivityToAccountChange', () => {
  const accountId = 'alice.near';

  test('should map INBOUND activity to positive account change (with delta)', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '231371389459736455600000000', // 231.37 NEAR balance after
      absolute_staked_amount: '0',
      affected_account_id: accountId,
      block_height: '100000',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      delta_nonstaked_amount: '100000000000000000000000', // +0.0001 NEAR actual change
      direction: 'INBOUND',
      event_index: '1',
      involved_account_id: undefined,
      receipt_id: 'receipt123',
      transaction_hash: undefined,
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(accountId);
      expect(result.value.postBalance).toBe('231371389459736455600000000'); // Balance after
      expect(result.value.preBalance).toBe('231271389459736455600000000'); // Balance before (postBalance - delta)
      // Verify the delta: postBalance - preBalance should equal delta_nonstaked_amount
      const delta = parseDecimal(result.value.postBalance).sub(parseDecimal(result.value.preBalance));
      expect(delta.toFixed()).toBe('100000000000000000000000');
    }
  });

  test('should map OUTBOUND activity to negative account change (with delta)', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '26582126544881235000000000', // 26.58 NEAR balance after
      absolute_staked_amount: '0',
      affected_account_id: accountId,
      block_height: '100001',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      delta_nonstaked_amount: '-204970000000000000000000000', // -204.97 NEAR actual change
      direction: 'OUTBOUND',
      event_index: '2',
      involved_account_id: undefined,
      receipt_id: 'receipt456',
      transaction_hash: undefined,
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(accountId);
      expect(result.value.postBalance).toBe('26582126544881235000000000'); // Balance after
      expect(result.value.preBalance).toBe('231552126544881235000000000'); // Balance before (postBalance - delta)
      // Verify the delta: postBalance - preBalance should equal delta_nonstaked_amount
      const delta = parseDecimal(result.value.postBalance).sub(parseDecimal(result.value.preBalance));
      expect(delta.toFixed()).toBe('-204970000000000000000000000');
    }
  });

  test('should handle very large amounts with delta', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000000000', // 1M NEAR in yocto balance after
      absolute_staked_amount: '0',
      affected_account_id: accountId,
      block_height: '100002',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      delta_nonstaked_amount: '50000000000000000000000000', // +50 NEAR actual change
      direction: 'INBOUND',
      event_index: '3',
      involved_account_id: undefined,
      receipt_id: 'receipt789',
      transaction_hash: undefined,
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.postBalance).toBe('1000000000000000000000000000000');
      expect(result.value.preBalance).toBe('999950000000000000000000000000');
      const delta = parseDecimal(result.value.postBalance).sub(parseDecimal(result.value.preBalance));
      expect(delta.toFixed()).toBe('50000000000000000000000000');
    }
  });

  test('should handle zero delta amounts', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '5000000000000000000000000', // 5 NEAR balance
      absolute_staked_amount: '0',
      affected_account_id: accountId,
      block_height: '100003',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      delta_nonstaked_amount: '0', // No actual change
      direction: 'INBOUND',
      event_index: '4',
      involved_account_id: undefined,
      receipt_id: 'receipt000',
      transaction_hash: undefined,
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.postBalance).toBe('5000000000000000000000000');
      expect(result.value.preBalance).toBe('5000000000000000000000000'); // Same as post, no change
      const delta = parseDecimal(result.value.postBalance).sub(parseDecimal(result.value.preBalance));
      expect(delta.toFixed()).toBe('0');
    }
  });

  test('should handle staking activity with negative delta', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '4082355433508820000000000', // 4.08 NEAR balance after
      absolute_staked_amount: '0',
      affected_account_id: accountId,
      block_height: '100004',
      block_timestamp: '1640000000000000000',
      cause: 'STAKE',
      delta_nonstaked_amount: '-200000000000000000000000000', // -200 NEAR staked
      direction: 'OUTBOUND',
      event_index: '5',
      involved_account_id: 'validator.near',
      receipt_id: 'receipt123',
      transaction_hash: 'tx123',
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(accountId);
      expect(result.value.postBalance).toBe('4082355433508820000000000'); // Balance after
      expect(result.value.preBalance).toBe('204082355433508820000000000'); // Balance before
      // Verify the delta is negative (staking removes from liquid balance)
      const delta = parseDecimal(result.value.postBalance).sub(parseDecimal(result.value.preBalance));
      expect(delta.toFixed()).toBe('-200000000000000000000000000');
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
      expect(errorMessage).toContain('Invalid NearBlocksActivity input');
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
      absolute_staked_amount: '0',
      affected_account_id: implicitAccountId,
      block_height: '100005',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      delta_nonstaked_amount: '1000000000000000000000000',
      direction: 'INBOUND',
      event_index: '6',
      involved_account_id: undefined,
      receipt_id: 'receipt123',
      transaction_hash: undefined,
    };

    const result = mapNearBlocksActivityToAccountChange(activity, implicitAccountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account).toBe(implicitAccountId);
    }
  });

  test('should fallback to direction-based calculation when delta_nonstaked_amount is missing (INBOUND)', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '1000000000000000000000000', // 1 NEAR
      absolute_staked_amount: '0',
      affected_account_id: accountId,
      block_height: '100006',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      direction: 'INBOUND',
      event_index: '7',
      involved_account_id: undefined,
      receipt_id: 'receipt789',
      transaction_hash: undefined,
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Fallback now emits zero-delta change when previous balance is unknown
      expect(result.value.postBalance).toBe('1000000000000000000000000');
      expect(result.value.preBalance).toBe('1000000000000000000000000');
    }
  });

  test('should fallback to direction-based calculation when delta_nonstaked_amount is missing (OUTBOUND)', () => {
    const activity: NearBlocksActivity = {
      absolute_nonstaked_amount: '500000000000000000000000', // 0.5 NEAR
      absolute_staked_amount: '0',
      affected_account_id: accountId,
      block_height: '100007',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      direction: 'OUTBOUND',
      event_index: '8',
      involved_account_id: undefined,
      receipt_id: 'receipt890',
      transaction_hash: undefined,
    };

    const result = mapNearBlocksActivityToAccountChange(activity, accountId);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.postBalance).toBe('500000000000000000000000');
      expect(result.value.preBalance).toBe('500000000000000000000000');
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
      expect(errorMessage).toContain('Invalid NearBlocksFtTransaction input');
      expect(errorMessage).toContain('at ft');
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
      expect(errorMessage).toContain('Invalid NearBlocksFtTransaction input');
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
