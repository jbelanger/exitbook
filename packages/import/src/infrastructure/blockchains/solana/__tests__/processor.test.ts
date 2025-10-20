import type { SolanaTransaction } from '@exitbook/providers';
import { describe, expect, test } from 'vitest';

import { SolanaTransactionProcessor } from '../processor.ts';

const USER_ADDRESS = 'user1111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'external222222222222222222222222222222222222';
const CONTRACT_ADDRESS = 'contract333333333333333333333333333333333333';
const TOKEN_ACCOUNT = 'token4444444444444444444444444444444444444444';

function createProcessor() {
  return new SolanaTransactionProcessor();
}

describe('SolanaTransactionProcessor - Fund Flow Direction', () => {
  test('classifies incoming SOL transfer as deposit', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000', // 2 SOL
            preBalance: '1000000000', // 1 SOL
          },
        ],
        amount: '1000000000', // 1 SOL in lamports
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sig1abc',
        providerId: 'helius',
        slot: 100000,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('SOL');
    expect(transaction.movements.primary.amount.toString()).toBe('1');
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('SOL');
    expect(transaction.movements.inflows[0]?.amount.toString()).toBe('1');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('classifies outgoing SOL transfer as withdrawal', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // 0.5 SOL
            preBalance: '2500000000', // 2.5 SOL
          },
        ],
        amount: '2000000000', // 2 SOL in lamports
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sig2def',
        providerId: 'helius',
        slot: 100001,
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('SOL');
    expect(transaction.movements.primary.amount.toString()).toBe('2');
    expect(transaction.movements.primary.direction).toBe('out');
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('SOL');
    expect(transaction.movements.outflows[0]?.amount.toString()).toBe('2');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('classifies self-transfer as transfer', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '995000', // Same balance minus fee (self-transfer)
            preBalance: '1000000',
          },
        ],
        amount: '0', // No net change for self-transfer
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sig3ghi',
        providerId: 'helius',
        slot: 100002,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - balance change from fee creates self-transfer pattern
    // (SOL out for fee, results in transfer classification)
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal'); // Outflow from fee
  });

  test('classifies incoming token transfer as deposit', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        amount: '1000000', // 1 USDC (6 decimals)
        currency: 'USDC',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sig4jkl',
        providerId: 'helius',
        slot: 100003,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAccount: TOKEN_ACCOUNT,
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '2000000',
            preAmount: '1000000',
            symbol: 'USDC',
          },
        ],
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - amounts are not normalized from token decimals
    expect(transaction.movements.primary.asset).toBe('USDC');
    expect(transaction.movements.primary.amount.toString()).toBe('1000000');
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.metadata?.tokenAddress).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  test('classifies outgoing token transfer as withdrawal', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        amount: '5000000', // 5 USDC (6 decimals)
        currency: 'USDC',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sig5mno',
        providerId: 'helius',
        slot: 100004,
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenAccount: TOKEN_ACCOUNT,
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '0',
            preAmount: '5000000',
            symbol: 'USDC',
          },
        ],
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - amounts are not normalized from token decimals
    expect(transaction.movements.primary.asset).toBe('USDC');
    expect(transaction.movements.primary.amount.toString()).toBe('5000000');
    expect(transaction.movements.primary.direction).toBe('out');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.operation.type).toBe('withdrawal');
  });
});

describe('SolanaTransactionProcessor - Transaction Type Classification', () => {
  test('marks zero-amount transactions as fee', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [],
        amount: '0',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sig6pqr',
        providerId: 'helius',
        slot: 100005,
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.amount.toString()).toBe('0');
    expect(transaction.movements.primary.direction).toBe('neutral');
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
  });

  test('classifies dust-amount deposit correctly', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '1000001000', // +0.000001 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '1000', // 0.000001 SOL (below 0.00001 threshold)
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sig7stu',
        providerId: 'helius',
        slot: 100006,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Dust deposits are still deposits, but flagged with note
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('dust_amount');
    expect(transaction.note?.message).toContain('Dust deposit');
  });

  test('handles failed transactions', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sig8vwx',
        providerId: 'helius',
        slot: 100007,
        status: 'failed',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - failed transactions still classified
    expect(transaction.status).toBe('failed');
    expect(transaction.blockchain?.is_confirmed).toBe(false);
  });
});

describe('SolanaTransactionProcessor - Swap Detection', () => {
  test('detects single-asset swap (SOL -> USDC)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // -0.5 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sigSwap1',
        instructions: [
          {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
          },
        ],
        providerId: 'helius',
        slot: 100010,
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '1000000000', // +1000 USDC
            preAmount: '0',
            symbol: 'USDC',
          },
        ],
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Verify both assets tracked - amounts are not normalized from token decimals
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('USDC');
    expect(transaction.movements.inflows[0]?.amount.toString()).toBe('1000000000');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('SOL');
    expect(transaction.movements.outflows[0]?.amount.toString()).toBe('0.5');

    // Primary should be the largest (USDC)
    expect(transaction.movements.primary.asset).toBe('USDC');
  });

  test('detects reverse swap (USDC -> SOL)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '1500000000', // +0.5 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'USDC',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sigSwap2',
        instructions: [
          {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
          },
        ],
        providerId: 'helius',
        slot: 100011,
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '0',
            preAmount: '500000000', // -500 USDC
            symbol: 'USDC',
          },
        ],
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Verify both assets tracked
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('SOL');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('USDC');
  });
});

describe('SolanaTransactionProcessor - Staking Detection', () => {
  test('detects stake operation', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // -0.5 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '500000000', // 0.5 SOL staked
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sigStake1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111112', // Stake Program
          },
        ],
        providerId: 'helius',
        slot: 100020,
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('stake');
    expect(transaction.metadata?.hasStaking).toBe(true);
  });

  test('detects unstake operation', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '6000000000', // +5 SOL (larger amount to avoid reward classification)
            preBalance: '1000000000',
          },
        ],
        amount: '5000000000', // 5 SOL unstaked (>1 to avoid reward classification)
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: CONTRACT_ADDRESS,
        id: 'sigUnstake1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111112',
          },
        ],
        providerId: 'helius',
        slot: 100021,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify unstaking classification (amount >= 1 SOL)
    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('unstake');
    expect(transaction.metadata?.hasStaking).toBe(true);
  });

  test('detects staking reward', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '1000100000', // +0.0001 SOL (small reward)
            preBalance: '1000000000',
          },
        ],
        amount: '100000', // 0.0001 SOL reward
        currency: 'SOL',
        feeAmount: '0', // No fee for rewards
        feeCurrency: 'SOL',
        from: CONTRACT_ADDRESS,
        id: 'sigReward1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111112',
          },
        ],
        providerId: 'helius',
        slot: 100022,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('reward');
    expect(transaction.metadata?.hasStaking).toBe(true);
  });
});

describe('SolanaTransactionProcessor - Multi-Asset Tracking', () => {
  test('tracks multiple assets in complex transaction', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // -0.5 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sigComplex1',
        providerId: 'helius',
        slot: 100030,
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '1000000000', // +1000 USDC
            preAmount: '0',
            symbol: 'USDC',
          },
          {
            account: TOKEN_ACCOUNT + '2',
            decimals: 9,
            mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
            owner: USER_ADDRESS,
            postAmount: '500000000000', // +500 USDT
            preAmount: '0',
            symbol: 'USDT',
          },
        ],
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should track all 3 assets (SOL out, USDC in, USDT in)
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('SOL');

    expect(transaction.movements.inflows).toHaveLength(2);
    const usdcInflow = transaction.movements.inflows.find((i) => i.asset === 'USDC');
    const usdtInflow = transaction.movements.inflows.find((i) => i.asset === 'USDT');

    expect(usdcInflow).toBeDefined();
    expect(usdcInflow?.amount.toString()).toBe('1000000000');

    expect(usdtInflow).toBeDefined();
    expect(usdtInflow?.amount.toString()).toBe('500000000000');

    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('classification_uncertain');
  });

  test('consolidates duplicate assets', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000', // +1 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sigConsolidate1',
        providerId: 'helius',
        slot: 100031,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '1500000', // +1.5 USDC total
            preAmount: '500000', // +0.5 USDC from this change
            symbol: 'USDC',
          },
          {
            account: TOKEN_ACCOUNT + '2',
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Same USDC mint
            owner: USER_ADDRESS,
            postAmount: '1000000', // +1 USDC from this change
            preAmount: '0',
            symbol: 'USDC',
          },
        ],
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should consolidate USDC movements (1000000 + 1000000 = 2000000 raw units)
    expect(transaction.movements.inflows).toHaveLength(2); // SOL and USDC
    const usdcInflow = transaction.movements.inflows.find((i) => i.asset === 'USDC');
    const solInflow = transaction.movements.inflows.find((i) => i.asset === 'SOL');

    expect(usdcInflow).toBeDefined();
    expect(usdcInflow?.amount.toString()).toBe('2000000');

    expect(solInflow).toBeDefined();
    expect(solInflow?.amount.toString()).toBe('1');
  });
});

describe('SolanaTransactionProcessor - Edge Cases', () => {
  test('handles missing user address in session metadata', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        amount: '1000000000',
        currency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sigEdge1',
        providerId: 'helius',
        slot: 100040,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: '' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Missing user address');
    }
  });

  test('handles matching address correctly', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000',
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sigEdge2',
        providerId: 'helius',
        slot: 100041,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should properly match user address
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles missing fee data gracefully', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000',
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sigEdge3',
        providerId: 'helius',
        slot: 100042,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        // No feeAmount field
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - should default to 0
    expect(transaction.fees.total.amount.toString()).toBe('0');
    expect(transaction.fees.network?.amount.toString()).toBe('0');
  });

  test('handles transactions with missing optional fields', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000',
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sigEdge4',
        providerId: 'helius',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        // Missing: slot, blockHeight, blockId, signature, etc.
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toBeDefined();
    if (!result.value[0]) return;

    // Check structured fields
    expect(result.value[0].operation.type).toBe('deposit');
  });

  test('processes multiple transactions independently', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000',
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        from: EXTERNAL_ADDRESS,
        id: 'sig1',
        providerId: 'helius',
        slot: 100050,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '1000000000',
            preBalance: '2000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        from: USER_ADDRESS,
        id: 'sig2',
        providerId: 'helius',
        slot: 100051,
        status: 'success',
        timestamp: Date.now() + 1000,
        to: EXTERNAL_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toBeDefined();
    expect(result.value[0]?.id).toBe('sig1');
    expect(result.value[0]?.operation.type).toBe('deposit');
    expect(result.value[1]).toBeDefined();
    expect(result.value[1]?.id).toBe('sig2');
    expect(result.value[1]?.operation.type).toBe('withdrawal');
  });
});

describe('SolanaTransactionProcessor - Classification Uncertainty', () => {
  test('adds note for complex multi-asset transaction', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // -0.5 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '500000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sigComplex2',
        providerId: 'helius',
        slot: 100060,
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '0',
            preAmount: '1000000000', // -1000 USDC
            symbol: 'USDC',
          },
          {
            account: TOKEN_ACCOUNT + '2',
            decimals: 18,
            mint: '6D7NaB2xsLd7cauWu1wKk6KBsJohJmP2qZH9GEfVi5Ui',
            owner: USER_ADDRESS,
            postAmount: '5000000000000000000000', // +5000 DAI
            preAmount: '0',
            symbol: 'DAI',
          },
        ],
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('classification_uncertain');
    expect(transaction.note?.severity).toBe('info');
    expect(transaction.note?.message).toContain('Complex transaction');

    // Should track all assets
    expect(transaction.movements.outflows).toHaveLength(2); // SOL and USDC
    expect(transaction.movements.inflows).toHaveLength(1); // DAI
  });

  test('adds note for batch operation', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [],
        amount: '0',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sigBatch1',
        instructions: [
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        ],
        providerId: 'helius',
        slot: 100061,
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
      },
    ];
    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Zero amount transaction with no balance changes should be fee transaction
    // (batch note only applies when instructionCount > 3 AND there are fund movements)
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
    expect(transaction.metadata?.instructionCount).toBe(4);
    expect(transaction.metadata?.hasMultipleInstructions).toBe(true);
  });
});

describe('SolanaTransactionProcessor - Blockchain Metadata', () => {
  test('includes Solana-specific metadata', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '2000000000',
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        blockHeight: 100000,
        blockId: 'block123',
        computeUnitsConsumed: 150000,
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: EXTERNAL_ADDRESS,
        id: 'sigMeta1',
        providerId: 'helius',
        signature: 'sigMeta1abc',
        slot: 100000,
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check blockchain metadata
    expect(transaction.blockchain?.name).toBe('solana');
    expect(transaction.blockchain?.block_height).toBe(100000);
    expect(transaction.blockchain?.transaction_hash).toBe('sigMeta1');
    expect(transaction.blockchain?.is_confirmed).toBe(true);

    // Check Solana-specific metadata
    expect(transaction.metadata?.signature).toBe('sigMeta1abc');
    expect(transaction.metadata?.slot).toBe(100000);
    expect(transaction.metadata?.blockId).toBe('block123');
    expect(transaction.metadata?.computeUnitsUsed).toBe(150000);
    expect(transaction.metadata?.providerId).toBe('helius');
  });
});
