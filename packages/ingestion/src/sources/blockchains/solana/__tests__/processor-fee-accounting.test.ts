import type { SolanaTransaction } from '@exitbook/blockchain-providers';
import { ok } from 'neverthrow';
import { describe, expect, test, vi } from 'vitest';

import type { ITokenMetadataService } from '../../../../features/token-metadata/token-metadata-service.interface.js';
import { SolanaTransactionProcessor } from '../processor.js';

const USER_ADDRESS = 'user1111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'external222222222222222222222222222222222222';
const CONTRACT_ADDRESS = 'contract333333333333333333333333333333333333';
const TOKEN_ACCOUNT = 'token4444444444444444444444444444444444444444';

function createProcessor() {
  // Create minimal mock for token metadata service
  const mockTokenMetadataService = {
    enrichBatch: vi.fn().mockResolvedValue(ok()),
    getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as ITokenMetadataService;

  return new SolanaTransactionProcessor(mockTokenMetadataService);
}

function createTransaction(overrides: Partial<SolanaTransaction>): SolanaTransaction {
  return {
    id: 'default-sig',
    eventId: 'default-event',
    providerName: 'helius',
    status: 'success',
    timestamp: Date.now(),
    slot: 100000,
    from: EXTERNAL_ADDRESS,
    to: USER_ADDRESS,
    amount: '0',
    currency: 'SOL',
    feeAmount: '0.000005',
    feeCurrency: 'SOL',
    accountChanges: [],
    ...overrides,
  };
}

describe('SolanaTransactionProcessor - Fee Accounting (Issue #78)', () => {
  test('deducts fee when user sends SOL (outgoing transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // -1.5 SOL (1 sent + 0.000005 fee)
            preBalance: '1500005000',
          },
        ],
        amount: '1000000000', // 1 SOL sent
        from: USER_ADDRESS,
        id: 'sig1abc',
        to: EXTERNAL_ADDRESS,
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
    // Fees are stored in lamports (raw units), not SOL
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
            account: USER_ADDRESS,
            postBalance: '2000000000', // +1 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000', // 1 SOL received
        from: EXTERNAL_ADDRESS, // External sender (not user)
        id: 'sig2def',
        slot: 100001,
        to: USER_ADDRESS,
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
            postBalance: '995000', // -0.000005 SOL (fee only)
            preBalance: '1000000',
          },
        ],
        from: USER_ADDRESS,
        id: 'sig3ghi',
        slot: 100002,
        to: USER_ADDRESS,
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
            postBalance: '995000', // -0.000005 SOL (fee only)
            preBalance: '1000000',
          },
        ],
        from: USER_ADDRESS, // User initiates interaction
        id: 'sig4jkl',
        instructions: [
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
          },
        ],
        slot: 100003,
        to: CONTRACT_ADDRESS,
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
        amount: '1000000', // 1 USDC received
        currency: 'USDC',
        from: CONTRACT_ADDRESS, // Contract/minter is sender
        id: 'sig5mno',
        slot: 100004,
        to: USER_ADDRESS, // User receives tokens
        tokenAccount: TOKEN_ACCOUNT,
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '1000000',
            preAmount: '0',
            symbol: 'USDC',
          },
        ],
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
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
        amount: '2000000000', // 2 SOL (failed send)
        from: USER_ADDRESS, // User initiated transaction
        id: 'sig6pqr',
        slot: 100005,
        status: 'failed',
        to: EXTERNAL_ADDRESS,
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
    // (No outflows due to failure, but from === userAddress triggers fee deduction)
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
            postBalance: '500000000', // -0.5 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '500000000', // 0.5 SOL sent
        from: USER_ADDRESS, // User initiates swap
        id: 'sigSwap1',
        instructions: [
          {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
          },
        ],
        slot: 100006,
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
            postBalance: '500000000',
            preBalance: '1500005000',
          },
        ],
        amount: '1000000000',
        from: mixedCaseUser.toUpperCase(), // Different case but same address
        id: 'sig7stu',
        slot: 100007,
        to: EXTERNAL_ADDRESS,
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
            postBalance: '1000100000', // +0.0001 SOL reward
            preBalance: '1000000000',
          },
        ],
        amount: '100000', // 0.0001 SOL reward
        feeAmount: '0', // No fee for rewards (validator pays)
        from: CONTRACT_ADDRESS, // Validator/staking program
        id: 'sigReward1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111112',
          },
        ],
        slot: 100008,
        to: USER_ADDRESS,
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
            postBalance: '500000000', // -0.5 SOL staked
            preBalance: '1000005000',
          },
        ],
        amount: '500000000', // 0.5 SOL staked
        from: USER_ADDRESS, // User initiates staking
        id: 'sigStake1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111112',
          },
        ],
        slot: 100009,
        to: CONTRACT_ADDRESS,
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
            account: derivedAddress1,
            postBalance: '2000000000', // +1 SOL to derived wallet
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        from: EXTERNAL_ADDRESS, // Someone else sends to derived wallet
        id: 'sig8vwx',
        slot: 100010,
        to: derivedAddress1,
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
            postBalance: '500000000', // -1 SOL from derived wallet
            preBalance: '1500005000',
          },
        ],
        amount: '1000000000',
        from: derivedAddress1, // Derived wallet sends
        id: 'sig9xyz',
        slot: 100011,
        to: EXTERNAL_ADDRESS,
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
            postBalance: '500000000', // -0.5 SOL
            preBalance: '1000000000',
          },
        ],
        amount: '500000000',
        from: USER_ADDRESS, // User initiates liquidity provision
        id: 'sigDefi1',
        slot: 100012,
        to: CONTRACT_ADDRESS,
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: USER_ADDRESS,
            postAmount: '0', // -1000 USDC
            preAmount: '1000000000',
            symbol: 'USDC',
          },
          {
            account: TOKEN_ACCOUNT + '2',
            decimals: 9,
            mint: 'LPTokenMint111111111111111111111111111111111',
            owner: USER_ADDRESS,
            postAmount: '5000000000', // +5 LP tokens received
            preAmount: '0',
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
        amount: '1', // 1 NFT
        currency: 'NFT',
        from: CONTRACT_ADDRESS, // Candy machine/minter
        id: 'sigNFT1',
        slot: 100013,
        to: USER_ADDRESS,
        tokenAccount: TOKEN_ACCOUNT,
        tokenAddress: 'NFTMint1111111111111111111111111111111111111',
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 0,
            mint: 'NFTMint1111111111111111111111111111111111111',
            owner: USER_ADDRESS,
            postAmount: '1',
            preAmount: '0',
            symbol: 'NFT',
          },
        ],
        tokenDecimals: 0,
        tokenSymbol: 'NFT',
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
