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

describe('SolanaTransactionProcessor - Fee Accounting (Issue #78)', () => {
  test('deducts fee when user sends SOL (outgoing transfer)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // -1.5 SOL (1 sent + 0.000005 fee)
            preBalance: '1500005000',
          },
        ],
        amount: '1000000000', // 1 SOL sent
        currency: 'SOL',
        feeAmount: '5000', // 0.000005 SOL fee
        feeCurrency: 'SOL',
        from: USER_ADDRESS,
        id: 'sig1abc',
        providerId: 'helius',
        slot: 100000,
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

    // User paid the fee (outflow exists), so it should be deducted
    // Fees are stored in lamports (raw units), not SOL
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('does NOT deduct fee when user receives SOL (incoming transfer)', async () => {
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
        amount: '1000000000', // 1 SOL received
        currency: 'SOL',
        feeAmount: '5000', // 0.000005 SOL fee (paid by sender)
        feeCurrency: 'SOL',
        from: EXTERNAL_ADDRESS, // External sender (not user)
        id: 'sig2def',
        providerId: 'helius',
        slot: 100001,
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

    // User did NOT pay the fee (sender did), so fee should be 0
    expect(transaction.fees.network?.amount.toString()).toBe('0');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee for self-transfers (user is both sender and recipient)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '995000', // -0.000005 SOL (fee only)
            preBalance: '1000000',
          },
        ],
        amount: '0', // Self-transfer (net zero)
        currency: 'SOL',
        feeAmount: '5000', // 0.000005 SOL fee
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

    // User initiated the self-transfer, so they paid the fee
    // (The balance change from fee creates an outflow, triggering fee deduction)
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
  });

  test('deducts fee for account creation/program interactions (user initiates)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '995000', // -0.000005 SOL (fee only)
            preBalance: '1000000',
          },
        ],
        amount: '0', // No transfer, just program interaction
        currency: 'SOL',
        feeAmount: '5000', // 0.000005 SOL fee
        feeCurrency: 'SOL',
        from: USER_ADDRESS, // User initiates interaction
        id: 'sig4jkl',
        instructions: [
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
          },
        ],
        providerId: 'helius',
        slot: 100003,
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

    // User initiated program interaction, so they paid the fee
    // (Outflow from fee deduction triggers fee logic)
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
  });

  test('does NOT deduct fee for incoming token transfers (airdrop/mint scenario)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        amount: '1000000', // 1 USDC received
        currency: 'USDC',
        feeAmount: '5000', // 0.000005 SOL fee (paid by minter/airdropper)
        feeCurrency: 'SOL',
        from: CONTRACT_ADDRESS, // Contract/minter is sender
        id: 'sig5mno',
        providerId: 'helius',
        slot: 100004,
        status: 'success',
        timestamp: Date.now(),
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
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT pay the fee (contract/minter did), so fee should be 0
    expect(transaction.fees.network?.amount.toString()).toBe('0');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee for failed transactions when user was sender', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [], // Failed transaction may have no balance changes
        amount: '2000000000', // 2 SOL (failed send)
        currency: 'SOL',
        feeAmount: '5000', // 0.000005 SOL fee (still consumed on failure)
        feeCurrency: 'SOL',
        from: USER_ADDRESS, // User initiated transaction
        id: 'sig6pqr',
        providerId: 'helius',
        slot: 100005,
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

    // User initiated failed transaction, so they still paid the gas fee
    // (No outflows due to failure, but from === userAddress triggers fee deduction)
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
    expect(transaction.status).toBe('failed');
  });

  test('deducts fee for swaps (user initiates)', async () => {
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
        amount: '500000000', // 0.5 SOL sent
        currency: 'SOL',
        feeAmount: '5000', // 0.000005 SOL fee
        feeCurrency: 'SOL',
        from: USER_ADDRESS, // User initiates swap
        id: 'sigSwap1',
        instructions: [
          {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
          },
        ],
        providerId: 'helius',
        slot: 100006,
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

    // User initiated swap, so they paid the fee
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
    expect(transaction.operation.type).toBe('swap');
    expect(transaction.movements.outflows).toHaveLength(1); // SOL out
    expect(transaction.movements.inflows).toHaveLength(1); // USDC in
  });

  test('handles case-insensitive address comparison for fee logic', async () => {
    const processor = createProcessor();

    const mixedCaseUser = 'UsEr1111111111111111111111111111111111111111';

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000',
            preBalance: '1500005000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: mixedCaseUser.toUpperCase(), // Different case but same address
        id: 'sig7stu',
        providerId: 'helius',
        slot: 100007,
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

    // Should correctly identify user as sender despite case difference
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
  });

  test('does NOT deduct fee when receiving staking rewards', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '1000100000', // +0.0001 SOL reward
            preBalance: '1000000000',
          },
        ],
        amount: '100000', // 0.0001 SOL reward
        currency: 'SOL',
        feeAmount: '0', // No fee for rewards (validator pays)
        feeCurrency: 'SOL',
        from: CONTRACT_ADDRESS, // Validator/staking program
        id: 'sigReward1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111112',
          },
        ],
        providerId: 'helius',
        slot: 100008,
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

    // User received reward, validator paid fee (if any), so fee should be 0
    expect(transaction.fees.network?.amount.toString()).toBe('0');
    expect(transaction.operation.type).toBe('reward');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee when staking (user sends SOL to stake)', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: USER_ADDRESS,
            postBalance: '500000000', // -0.5 SOL staked
            preBalance: '1000005000',
          },
        ],
        amount: '500000000', // 0.5 SOL staked
        currency: 'SOL',
        feeAmount: '5000', // 0.000005 SOL fee
        feeCurrency: 'SOL',
        from: USER_ADDRESS, // User initiates staking
        id: 'sigStake1',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111112',
          },
        ],
        providerId: 'helius',
        slot: 100009,
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

    // User initiated staking, so they paid the fee
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
    expect(transaction.operation.type).toBe('stake');
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('handles multi-wallet scenarios with derivedAddresses (incoming transfer)', async () => {
    const processor = createProcessor();

    const derivedAddress1 = 'derived11111111111111111111111111111111111111';
    const derivedAddress2 = 'derived22222222222222222222222222222222222222';

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: derivedAddress1,
            postBalance: '2000000000', // +1 SOL to derived wallet
            preBalance: '1000000000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: EXTERNAL_ADDRESS, // Someone else sends to derived wallet
        id: 'sig8vwx',
        providerId: 'helius',
        slot: 100010,
        status: 'success',
        timestamp: Date.now(),
        to: derivedAddress1,
      },
    ];

    const result = await processor.process(normalizedData, {
      address: USER_ADDRESS,
      derivedAddresses: [derivedAddress1, derivedAddress2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User received funds at derived wallet, external sender paid fee
    expect(transaction.fees.network?.amount.toString()).toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles multi-wallet scenarios with derivedAddresses (outgoing transfer)', async () => {
    const processor = createProcessor();

    const derivedAddress1 = 'derived11111111111111111111111111111111111111';
    const derivedAddress2 = 'derived22222222222222222222222222222222222222';

    const normalizedData: SolanaTransaction[] = [
      {
        accountChanges: [
          {
            account: derivedAddress1,
            postBalance: '500000000', // -1 SOL from derived wallet
            preBalance: '1500005000',
          },
        ],
        amount: '1000000000',
        currency: 'SOL',
        feeAmount: '5000',
        feeCurrency: 'SOL',
        from: derivedAddress1, // Derived wallet sends
        id: 'sig9xyz',
        providerId: 'helius',
        slot: 100011,
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, {
      address: USER_ADDRESS,
      derivedAddresses: [derivedAddress1, derivedAddress2],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User (via derived wallet) initiated transaction, so they paid fee
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('handles complex DeFi operations (liquidity provision with multiple assets)', async () => {
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
        feeAmount: '5000', // 0.000005 SOL fee
        feeCurrency: 'SOL',
        from: USER_ADDRESS, // User initiates liquidity provision
        id: 'sigDefi1',
        providerId: 'helius',
        slot: 100012,
        status: 'success',
        timestamp: Date.now(),
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
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated DeFi operation (has outflows), so they paid the fee
    expect(transaction.fees.network?.amount.toString()).toBe('5000');
    expect(transaction.movements.outflows?.length).toBeGreaterThan(0);
  });

  test('does NOT deduct fee when receiving NFT mint/airdrop', async () => {
    const processor = createProcessor();

    const normalizedData: SolanaTransaction[] = [
      {
        amount: '1', // 1 NFT
        currency: 'NFT',
        feeAmount: '5000', // Fee paid by minter
        feeCurrency: 'SOL',
        from: CONTRACT_ADDRESS, // Candy machine/minter
        id: 'sigNFT1',
        providerId: 'helius',
        slot: 100013,
        status: 'success',
        timestamp: Date.now(),
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
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User received NFT, minter paid fee
    expect(transaction.fees.network?.amount.toString()).toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });
});
