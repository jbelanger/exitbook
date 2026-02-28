import type { BlockchainProviderManager, SolanaTransaction } from '@exitbook/blockchain-providers';
import { ok } from 'neverthrow';
import { describe, expect, test, vi } from 'vitest';

import { SolanaProcessor } from '../processor.js';

const USER_ADDRESS = 'user1111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'external222222222222222222222222222222222222';
const CONTRACT_ADDRESS = 'contract333333333333333333333333333333333333';
const TOKEN_ACCOUNT = 'token4444444444444444444444444444444444444444';

function createProcessor() {
  const mockProviderManager = {
    getTokenMetadata: vi.fn().mockResolvedValue(ok(new Map())),
  } as unknown as BlockchainProviderManager;

  return new SolanaProcessor(mockProviderManager);
}

function createTransaction(overrides: Partial<SolanaTransaction>): SolanaTransaction {
  return {
    id: 'default-sig',
    eventId: 'default-event',
    providerName: 'helius',
    status: 'success',
    timestamp: Date.now(),
    slot: 100000,
    feePayer: USER_ADDRESS,
    feeAmount: '0.000005',
    feeCurrency: 'SOL',
    accountChanges: [
      {
        account: USER_ADDRESS,
        preBalance: '1000000',
        postBalance: '995000', // Fee deducted by default
      },
    ],
    ...overrides,
  };
}

describe('SolanaProcessor - Fee Accounting (Issue #78)', () => {
  test('deducts fee when user sends SOL (outgoing transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1500005000',
            postBalance: '500000000', // -1.000005 SOL (1 sent + 0.000005 fee)
          },
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '1000000000',
            postBalance: '2000000000', // +1 SOL received
          },
        ],
        id: 'sig1abc',
        feePayer: USER_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User paid the fee (outflow exists), so it should be deducted
    // Fees are stored in SOL (decimal-adjusted units)
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('does NOT deduct fee when user receives SOL (incoming transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '2000005000',
            postBalance: '1000000000', // -1.000005 SOL (1 sent + fee paid)
          },
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '2000000000', // +1 SOL received
          },
        ],
        id: 'sig2def',
        slot: 100001,
        feePayer: EXTERNAL_ADDRESS, // External sender paid the fee
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT pay the fee (sender did), so fee should be 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee for self-transfers (user is both sender and recipient)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000',
            postBalance: '995000', // -0.000005 SOL (fee only)
          },
        ],
        id: 'sig3ghi',
        slot: 100002,
        feePayer: USER_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    if (!result.isOk()) {
      throw new Error(`Expected Ok result but got Err: ${String(result.error)}`);
    }
    expect(result.isOk()).toBe(true);

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated the self-transfer, so they paid the fee
    // (The balance change from fee creates an outflow, triggering fee deduction)
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
  });

  test('deducts fee for account creation/program interactions (user initiates)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000',
            postBalance: '995000', // -0.000005 SOL (fee only)
          },
        ],
        feePayer: USER_ADDRESS, // User initiates interaction
        id: 'sig4jkl',
        instructions: [
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
          },
        ],
        slot: 100003,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated program interaction, so they paid the fee
    // (Outflow from fee deduction triggers fee logic)
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
  });

  test('does NOT deduct fee for incoming token transfers (airdrop/mint scenario)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '1000000000', // No SOL change for user
          },
        ],
        feePayer: CONTRACT_ADDRESS, // Contract/minter paid fee
        id: 'sig5mno',
        slot: 100004,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            preAmount: '0',
            postAmount: '1000000', // +1 USDC received
            symbol: 'USDC',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT pay the fee (contract/minter did), so fee should be 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee for failed transactions when user was sender', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '999995000', // Only fee deducted (transaction failed, so no transfer)
          },
        ],
        feePayer: USER_ADDRESS, // User initiated transaction
        id: 'sig6pqr',
        slot: 100005,
        status: 'failed',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated failed transaction, so they still paid the gas fee
    // (No outflows due to failure, but feePayer === userAddress triggers fee deduction)
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
    expect(transaction.status).toBe('failed');
  });

  test('deducts fee for swaps (user initiates)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '500000000', // -0.5 SOL
          },
        ],
        feePayer: USER_ADDRESS, // User initiates swap
        id: 'sigSwap1',
        instructions: [
          {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
          },
        ],
        slot: 100006,
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
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated swap, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
    expect(transaction.operation.type).toBe('swap');
    expect(transaction.movements.outflows).toHaveLength(1); // SOL out
    expect(transaction.movements.inflows).toHaveLength(1); // USDC in
  });

  test('handles case-insensitive address comparison for fee logic', async () => {
    const processor = createProcessor();

    const mixedCaseUser = 'UsEr1111111111111111111111111111111111111111';

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1500005000',
            postBalance: '500000000',
          },
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '1000000000',
            postBalance: '2000000000',
          },
        ],
        feePayer: mixedCaseUser.toUpperCase(), // Different case but same address
        id: 'sig7stu',
        slot: 100007,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should correctly identify user as sender despite case difference
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
  });

  test('does NOT deduct fee when receiving staking rewards', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '1000100000', // +0.0001 SOL reward
          },
        ],
        feeAmount: '0', // No fee for rewards (validator pays)
        feePayer: CONTRACT_ADDRESS, // Validator/staking program
        id: 'sigReward1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111111',
          },
        ],
        slot: 100008,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User received reward, validator paid fee (if any), so fee should be 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('reward');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee when staking (user sends SOL to stake)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000005000',
            postBalance: '500000000', // -0.500005 SOL (0.5 staked + 0.000005 fee)
          },
        ],
        feePayer: USER_ADDRESS, // User initiates staking
        id: 'sigStake1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111111',
          },
        ],
        slot: 100009,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated staking, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
    expect(transaction.operation.type).toBe('stake');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('handles multi-wallet scenarios with derivedAddresses (incoming transfer)', async () => {
    const processor = createProcessor();

    const derivedAddress1 = 'derived11111111111111111111111111111111111111';
    const derivedAddress2 = 'derived22222222222222222222222222222222222222';

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '2000005000',
            postBalance: '1000000000', // -1.000005 SOL (sent + fee)
          },
          {
            account: derivedAddress1,
            preBalance: '1000000000',
            postBalance: '2000000000', // +1 SOL to derived wallet
          },
        ],
        feePayer: EXTERNAL_ADDRESS, // External sender paid fee
        id: 'sig8vwx',
        slot: 100010,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [derivedAddress1, derivedAddress2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User received funds at derived wallet, external sender paid fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles multi-wallet scenarios with derivedAddresses (outgoing transfer)', async () => {
    const processor = createProcessor();

    const derivedAddress1 = 'derived11111111111111111111111111111111111111';
    const derivedAddress2 = 'derived22222222222222222222222222222222222222';

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: derivedAddress1,
            preBalance: '1500005000',
            postBalance: '500000000', // -1.000005 SOL from derived wallet
          },
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '1000000000',
            postBalance: '2000000000', // +1 SOL
          },
        ],
        feePayer: derivedAddress1, // Derived wallet sends and pays fee
        id: 'sig9xyz',
        slot: 100011,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [derivedAddress1, derivedAddress2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User (via derived wallet) initiated transaction, so they paid fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('handles complex DeFi operations (liquidity provision with multiple assets)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '500000000', // -0.5 SOL
          },
        ],
        feePayer: USER_ADDRESS, // User initiates liquidity provision
        id: 'sigDefi1',
        slot: 100012,
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
            decimals: 9,
            mint: 'LPTokenMint111111111111111111111111111111111',
            owner: USER_ADDRESS,
            preAmount: '0',
            postAmount: '5000000000', // +5 LP tokens received
            symbol: 'LP-SOL-USDC',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated DeFi operation (has outflows), so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.000005');
    expect(transaction.movements.outflows?.length).toBeGreaterThan(0);
  });

  test('does NOT deduct fee when receiving NFT mint/airdrop', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '1000000000', // No SOL change
          },
        ],
        feePayer: CONTRACT_ADDRESS, // Candy machine/minter paid fee
        id: 'sigNFT1',
        slot: 100013,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 0,
            mint: 'NFTMint1111111111111111111111111111111111111',
            owner: USER_ADDRESS,
            preAmount: '0',
            postAmount: '1', // +1 NFT
            symbol: 'NFT',
          },
        ],
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User received NFT, minter paid fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });
});
