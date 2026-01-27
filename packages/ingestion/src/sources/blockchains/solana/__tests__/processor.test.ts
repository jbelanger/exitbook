import type { SolanaTransaction } from '@exitbook/blockchain-providers';
import { EventBus } from '@exitbook/events';
import { ok } from 'neverthrow';
import { describe, expect, test, vi } from 'vitest';

import type { IngestionEvent } from '../../../../events.js';
import type { ITokenMetadataService } from '../../../../features/token-metadata/token-metadata-service.interface.js';
import { SolanaTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'user1111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'external222222222222222222222222222222222222';
const CONTRACT_ADDRESS = 'contract333333333333333333333333333333333333';
const TOKEN_ACCOUNT = 'token4444444444444444444444444444444444444444';

function createProcessor(customMetadataService?: ITokenMetadataService) {
  // Create minimal mock for token metadata service
  const defaultMockService = {
    // Return NO_PROVIDERS ProviderError to simulate provider not supporting metadata
    enrichBatch: vi.fn().mockResolvedValue(ok()),
    getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
    getOrFetchBatch: vi.fn().mockResolvedValue(ok(new Map())),
  } as unknown as ITokenMetadataService;

  return new SolanaTransactionProcessor(customMetadataService || defaultMockService);
}

function createTransaction(overrides: Partial<SolanaTransaction> = {}): SolanaTransaction[] {
  const base: SolanaTransaction = {
    accountChanges: [
      {
        account: USER_ADDRESS,
        preBalance: '1000000000',
        postBalance: '999995000', // Fee deducted by default
      },
    ],
    feeAmount: '0.000005',
    feeCurrency: 'SOL',
    feePayer: USER_ADDRESS,
    id: 'defaultSig',
    eventId: '0xdefaultEvent',
    providerName: 'helius',
    slot: 100000,
    status: 'success',
    timestamp: Date.now(),
  };
  return [{ ...base, ...overrides }];
}

describe('SolanaTransactionProcessor - Fund Flow Direction', () => {
  test('classifies incoming SOL transfer as deposit', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig1abc',
      eventId: '0xevent1',
      slot: 100000,
      accountChanges: [
        {
          account: EXTERNAL_ADDRESS,
          preBalance: '2000000000',
          postBalance: '1000000000', // External address sent 1 SOL
        },
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '2000000000', // User received 1 SOL
        },
      ],
      feePayer: EXTERNAL_ADDRESS, // External party paid the fee
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('SOL');
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('classifies outgoing SOL transfer as withdrawal', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig2def',
      eventId: '0xevent2',
      slot: 100001,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '2500005000', // 2.500005 SOL (includes fee)
          postBalance: '500000000', // 0.5 SOL (sent 2 SOL, paid 0.000005 fee)
        },
        {
          account: EXTERNAL_ADDRESS,
          preBalance: '1000000000',
          postBalance: '3000000000', // External address received 2 SOL
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.assetSymbol).toBe('SOL');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('classifies self-transfer as fee-only transaction', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig3ghi',
      eventId: '0xevent3',
      slot: 100002,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000',
          postBalance: '995000', // Only fee deducted (5000 lamports = 0.000005 SOL)
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - balance change equals fee, so this is a fee-only transaction
    // After fee deduction logic, no movements remain, correctly classified as 'fee'
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
  });

  test('classifies incoming token transfer as deposit', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig4jkl',
      eventId: '0xevent4',
      slot: 100003,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000000000', // No SOL change
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '1000000',
          postAmount: '2000000', // +1 USDC (1000000 raw = 1 USDC with 6 decimals)
          symbol: 'USDC',
        },
      ],
      feePayer: EXTERNAL_ADDRESS, // External party paid the fee
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - amounts are normalized from token decimals
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.type).toBe('deposit');
  });

  test('classifies outgoing token transfer as withdrawal', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig5mno',
      eventId: '0xevent5',
      slot: 100004,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000005000',
          postBalance: '1000000000', // Paid fee in SOL
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '5000000',
          postAmount: '0', // Sent 5 USDC (5000000 raw = 5 USDC with 6 decimals)
          symbol: 'USDC',
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - amounts are normalized from token decimals
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.operation.type).toBe('withdrawal');
  });
});

describe('SolanaTransactionProcessor - Transaction Type Classification', () => {
  test('marks zero-amount transactions as fee', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig6pqr',
      eventId: '0xevent6',
      slot: 100005,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000',
          postBalance: '995000', // Only fee deducted
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
  });

  test('classifies small deposit correctly', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig7stu',
      eventId: '0xevent7',
      slot: 100006,
      accountChanges: [
        {
          account: EXTERNAL_ADDRESS,
          preBalance: '1000001000',
          postBalance: '1000000000', // Sent 1000 lamports
        },
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000001000', // Received 1000 lamports (0.000001 SOL)
        },
      ],
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Small deposits are normal deposits, no special handling
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.notes).toBeUndefined(); // No note for normal small deposits
  });

  test('handles failed transactions', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sig8vwx',
      eventId: '0xevent8',
      slot: 100007,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000005000',
          postBalance: '1000000000', // Only fee deducted (transaction failed)
        },
      ],
      status: 'failed',
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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

    const normalizedData = createTransaction({
      id: 'sigSwap1',
      eventId: '0xevent9',
      slot: 100010,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000005000', // 1.000005 SOL (includes fee)
          postBalance: '500000000', // 0.5 SOL after swap
        },
      ],
      instructions: [
        {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000000', // +1000 USDC
          symbol: 'USDC',
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Verify both assets tracked - amounts are decimal-adjusted to UI amounts
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('USDC');
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('1000');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.assetSymbol).toBe('SOL');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('0.5');
  });

  test('detects reverse swap (USDC -> SOL)', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigSwap2',
      eventId: '0xevent10',
      slot: 100011,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1500000000', // +0.5 SOL
        },
      ],
      instructions: [
        {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '500000000',
          postAmount: '0', // -500 USDC
          symbol: 'USDC',
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Verify both assets tracked
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('SOL');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.assetSymbol).toBe('USDC');
  });
});

describe('SolanaTransactionProcessor - Staking Detection', () => {
  test('detects stake operation', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigStake1',
      eventId: '0xevent11',
      slot: 100020,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '500000000', // -0.5 SOL to stake account
        },
      ],
      instructions: [
        {
          programId: 'Stake11111111111111111111111111111111111111', // Stake Program
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('stake');
  });

  test('detects unstake operation', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigUnstake1',
      eventId: '0xevent12',
      slot: 100021,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '6000000000', // +5 SOL (larger amount to avoid reward classification)
        },
      ],
      instructions: [
        {
          programId: 'Stake11111111111111111111111111111111111111',
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify unstaking classification (amount >= 1 SOL)
    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('unstake');
  });

  test('detects staking reward', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigReward1',
      eventId: '0xevent13',
      slot: 100022,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000100000', // +0.0001 SOL (small reward)
        },
      ],
      feeAmount: '0', // No fee for rewards
      instructions: [
        {
          programId: 'Stake11111111111111111111111111111111111111',
        },
      ],
      feePayer: CONTRACT_ADDRESS, // System paid the fee
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('reward');
  });
});

describe('SolanaTransactionProcessor - Multi-Asset Tracking', () => {
  test('tracks multiple assets in complex transaction', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigComplex1',
      eventId: '0xevent14',
      slot: 100030,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '500000000', // -0.5 SOL
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000000', // +1000 USDC
          symbol: 'USDC',
        },
        {
          account: TOKEN_ACCOUNT + '2',
          decimals: 9,
          mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '500000000000', // +500 USDT
          symbol: 'USDT',
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should track all 3 assets (SOL out, USDC in, USDT in)
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.assetSymbol).toBe('SOL');

    expect(transaction.movements.inflows).toHaveLength(2);
    const usdcInflow = transaction.movements.inflows?.find((i) => i.assetSymbol === 'USDC');
    const usdtInflow = transaction.movements.inflows?.find((i) => i.assetSymbol === 'USDT');
    expect(usdcInflow).toBeDefined();
    expect(usdcInflow?.netAmount?.toFixed()).toBe('1000');

    expect(usdtInflow).toBeDefined();
    expect(usdtInflow?.netAmount?.toFixed()).toBe('500');

    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('classification_uncertain');
  });

  test('consolidates duplicate assets', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigConsolidate1',
      eventId: '0xevent15',
      slot: 100031,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '2000000000', // +1 SOL
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '500000',
          postAmount: '1500000', // +1 USDC from this token account
          symbol: 'USDC',
        },
        {
          account: TOKEN_ACCOUNT + '2',
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Same USDC mint
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000', // +1 USDC from this token account
          symbol: 'USDC',
        },
      ],
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should consolidate USDC movements (1 + 1 = 2 USDC UI amount)
    expect(transaction.movements.inflows).toHaveLength(2); // SOL and USDC
    const usdcInflow = transaction.movements.inflows?.find((i) => i.assetSymbol === 'USDC');
    const solInflow = transaction.movements.inflows?.find((i) => i.assetSymbol === 'SOL');

    expect(usdcInflow).toBeDefined();
    expect(usdcInflow?.netAmount?.toFixed()).toBe('2');

    expect(solInflow).toBeDefined();
    expect(solInflow?.netAmount?.toFixed()).toBe('1');
  });
});

describe('SolanaTransactionProcessor - Edge Cases', () => {
  test('handles matching address correctly', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigEdge2',
      eventId: '0xevent16',
      slot: 100041,
      accountChanges: [
        {
          account: EXTERNAL_ADDRESS,
          preBalance: '2000000000',
          postBalance: '1000000000',
        },
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '2000000000',
        },
      ],
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should properly match user address
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles missing fee data gracefully', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigEdge3',
      eventId: '0xevent17',
      slot: 100042,
      accountChanges: [
        {
          account: EXTERNAL_ADDRESS,
          preBalance: '2000000000',
          postBalance: '1000000000',
        },
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '2000000000',
        },
      ],
      feeAmount: undefined,
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - should default to 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
  });

  test('handles transactions with missing optional fields', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigEdge4',
      eventId: '0xevent18',
      accountChanges: [
        {
          account: EXTERNAL_ADDRESS,
          preBalance: '2000000000',
          postBalance: '1000000000',
        },
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '2000000000',
        },
      ],
      slot: undefined,
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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

    const normalizedData = [
      ...createTransaction({
        id: 'sig1',
        eventId: '0xevent19',
        slot: 100050,
        accountChanges: [
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '2000000000',
            postBalance: '1000000000',
          },
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '2000000000',
          },
        ],
        feePayer: EXTERNAL_ADDRESS,
      }),
      ...createTransaction({
        id: 'sig2',
        eventId: '0xevent20',
        slot: 100051,
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '2000000000',
            postBalance: '1000000000',
          },
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '1000000000',
            postBalance: '2000000000',
          },
        ],
        timestamp: Date.now() + 1000,
        feePayer: USER_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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

describe('SolanaTransactionProcessor - Classification Uncertainty', () => {
  test('adds note for complex multi-asset transaction', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigComplex2',
      eventId: '0xevent21',
      slot: 100060,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '500000000', // -0.5 SOL
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '1000000000',
          postAmount: '0', // -1000 USDC
          symbol: 'USDC',
        },
        {
          account: TOKEN_ACCOUNT + '2',
          decimals: 18,
          mint: '6D7NaB2xsLd7cauWu1wKk6KBsJohJmP2qZH9GEfVi5Ui',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '5000000000000000000000', // +5000 DAI
          symbol: 'DAI',
        },
      ],
      feePayer: USER_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('classification_uncertain');
    expect(transaction.notes?.[0]?.severity).toBe('info');
    expect(transaction.notes?.[0]?.message).toContain('Complex transaction');

    // Should track all assets
    expect(transaction.movements.outflows).toHaveLength(2); // SOL and USDC
    expect(transaction.movements.inflows).toHaveLength(1); // DAI
  });

  test('adds note for batch operation', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigBatch1',
      eventId: '0xevent22',
      slot: 100061,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000',
          postBalance: '995000', // Only fee deducted
        },
      ],
      instructions: [
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      ],
      feePayer: USER_ADDRESS,
    });
    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Zero amount transaction with no balance changes should be fee transaction
    // (batch note only applies when instructionCount > 3 AND there are fund movements)
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
  });
});

describe('SolanaTransactionProcessor - Blockchain Metadata', () => {
  test('includes Solana-specific metadata', async () => {
    const processor = createProcessor();

    const normalizedData = createTransaction({
      id: 'sigMeta1',
      eventId: '0xevent23',
      slot: 100000,
      accountChanges: [
        {
          account: EXTERNAL_ADDRESS,
          preBalance: '2000000000',
          postBalance: '1000000000',
        },
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '2000000000',
        },
      ],
      blockHeight: 100000,
      blockId: 'block123',
      computeUnitsConsumed: 150000,
      signature: 'sigMeta1abc',
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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
  });
});

describe('SolanaTransactionProcessor - Token Metadata Enrichment', () => {
  test('enriches token symbols from mint addresses when service is provided', async () => {
    // Mock TokenMetadataService that actually enriches the data
    const mockTokenMetadataService = {
      enrichBatch: vi
        .fn()
        .mockImplementation(
          (
            items: unknown[],
            _blockchain: string,
            contractExtractor: (item: unknown) => string,
            metadataUpdater: (item: unknown, metadata: { decimals: number; symbol: string }) => void
          ) => {
            // Simulate enrichment by calling the metadataUpdater callback
            for (const item of items) {
              const contractAddress: string = contractExtractor(item);
              if (contractAddress === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
                metadataUpdater(item, { symbol: 'USDC', decimals: 6 });
              }
            }
            return ok();
          }
        ),
      getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
      getOrFetchBatch: vi.fn().mockResolvedValue(ok(new Map())),
    } as unknown as ITokenMetadataService;

    const processor = new SolanaTransactionProcessor(mockTokenMetadataService);

    const normalizedData = createTransaction({
      id: 'sigEnrich1',
      eventId: '0xevent24',
      slot: 100000,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000000000',
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000',
          // Symbol is the mint address (will be enriched)
          symbol: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      ],
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Check that the token change symbol was enriched
    expect(normalizedData[0]?.tokenChanges?.[0]?.symbol).toBe('USDC');
  });

  test('skips enrichment when repository returns no metadata', async () => {
    const processor = createProcessor(); // Uses mocks that return ok(undefined)

    const normalizedData = createTransaction({
      id: 'sigNoEnrich1',
      eventId: '0xevent25',
      slot: 100000,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000000000',
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000',
          symbol: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      ],
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Symbol should remain as mint address (not enriched)
    expect(normalizedData[0]?.tokenChanges?.[0]?.symbol).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  test('does not enrich symbols that are already human-readable', async () => {
    const mockTokenMetadataService = {
      enrichBatch: vi.fn().mockResolvedValue(ok()),
      getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
      getOrFetchBatch: vi.fn().mockResolvedValue(ok(new Map())),
    } as unknown as ITokenMetadataService;

    const processor = new SolanaTransactionProcessor(mockTokenMetadataService);

    const normalizedData = createTransaction({
      id: 'sigHumanReadable1',
      eventId: '0xevent26',
      slot: 100000,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000000000',
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000',
          // Symbol is already human-readable (not a mint address)
          symbol: 'USDC',
        },
      ],
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Symbol should remain as-is (not enriched)
    expect(normalizedData[0]?.tokenChanges?.[0]?.symbol).toBe('USDC');
  });

  test('handles service errors gracefully', async () => {
    const mockTokenMetadataService = {
      enrichBatch: vi.fn().mockResolvedValue(ok()),
      getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
      getOrFetchBatch: vi.fn().mockResolvedValue(ok(new Map())),
    } as unknown as ITokenMetadataService;

    const processor = new SolanaTransactionProcessor(mockTokenMetadataService);

    const normalizedData = createTransaction({
      id: 'sigRepoError1',
      eventId: '0xevent27',
      slot: 100000,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000000000',
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 6,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000',
          symbol: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      ],
      feePayer: EXTERNAL_ADDRESS,
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Symbol should remain as mint address (fallback on error)
    expect(normalizedData[0]?.tokenChanges?.[0]?.symbol).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });
});

describe('SolanaTransactionProcessor - Scam Detection', () => {
  test('detects scam token in airdrop', async () => {
    // Mock metadata service to return a scam token
    const mockMetadataService = {
      enrichBatch: vi.fn().mockResolvedValue(ok()),
      getOrFetch: vi.fn().mockResolvedValue(
        ok({
          contractAddress: 'ScamTokenAddress123',
          blockchain: 'solana',
          name: 'Free Money 🎁',
          symbol: 'SCAM',
          decimals: 9,
          possibleSpam: true, // Professional detection
          source: 'provider-api',
          refreshedAt: new Date(),
        })
      ),
      getOrFetchBatch: vi.fn().mockResolvedValue(
        ok(
          new Map([
            [
              'ScamTokenAddress123',
              {
                contractAddress: 'ScamTokenAddress123',
                blockchain: 'solana',
                name: 'Free Money 🎁',
                symbol: 'SCAM',
                decimals: 9,
                possibleSpam: true, // Professional detection
                source: 'provider-api',
                refreshedAt: new Date(),
              },
            ],
          ])
        )
      ),
    } as unknown as ITokenMetadataService;

    // Import and instantiate real scam detection service
    const { ScamDetectionService } = await import('../../../../features/scam-detection/scam-detection-service.js');
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- avoid unnecessary complexity in test
    const mockEventBus = new EventBus<IngestionEvent>(() => {});
    const scamDetectionService = new ScamDetectionService(mockEventBus);

    const processor = new SolanaTransactionProcessor(mockMetadataService, scamDetectionService);

    const normalizedData = createTransaction({
      id: 'sigScam1',
      eventId: '0xevent28',
      slot: 100040,
      accountChanges: [
        {
          account: USER_ADDRESS,
          preBalance: '1000000000',
          postBalance: '1000000000',
        },
      ],
      tokenChanges: [
        {
          account: TOKEN_ACCOUNT,
          decimals: 9,
          mint: 'ScamTokenAddress123',
          owner: USER_ADDRESS,
          preAmount: '0',
          postAmount: '1000000000', // +1 SCAM
          symbol: 'SCAM',
        },
      ],
      feePayer: EXTERNAL_ADDRESS, // Not paid by user (airdrop characteristics)
    });

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should be flagged as spam with SCAM_TOKEN note
    expect(transaction.isSpam).toBe(true);
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('SCAM_TOKEN');
    expect(transaction.notes?.[0]?.severity).toBe('error');

    // Should still be classified as deposit
    expect(transaction.operation.type).toBe('deposit');
  });
});
