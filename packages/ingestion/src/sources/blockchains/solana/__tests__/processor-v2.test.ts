import { getSolanaChainConfig, type SolanaTransaction } from '@exitbook/blockchain-providers/solana';
import type { Currency, Result } from '@exitbook/foundation';
import type { AccountingPostingDraft } from '@exitbook/ledger';
import { describe, expect, test } from 'vitest';

import type { SolanaLedgerDraft } from '../journal-assembler.js';
import { SolanaProcessorV2 } from '../processor-v2.js';

const ACCOUNT_ID = 42;
const ACCOUNT_FINGERPRINT = 'account:fingerprint:solana-user';
const USER_ADDRESS = 'user1111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'external222222222222222222222222222222222222';
const CONTRACT_ADDRESS = 'contract333333333333333333333333333333333333';
const STAKE_ACCOUNT = 'stake555555555555555555555555555555555555555';
const TOKEN_ACCOUNT = 'token4444444444444444444444444444444444444444';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const ACCOUNT_CONTEXT = {
  account: {
    fingerprint: ACCOUNT_FINGERPRINT,
    id: ACCOUNT_ID,
  },
  primaryAddress: USER_ADDRESS,
  userAddresses: [USER_ADDRESS],
};

function expectOk<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw result.error;
  }
  return result.value;
}

function createProcessor(): SolanaProcessorV2 {
  const chainConfig = getSolanaChainConfig('solana');
  if (!chainConfig) {
    throw new Error('Solana chain config not found');
  }

  return new SolanaProcessorV2(chainConfig);
}

function createTransaction(overrides: Partial<SolanaTransaction> = {}): SolanaTransaction {
  const id = overrides.id ?? 'solana-default-signature';

  return {
    accountChanges: [
      {
        account: USER_ADDRESS,
        preBalance: '1000000',
        postBalance: '995000',
      },
    ],
    eventId: `${id}:event`,
    feeAmount: '0.000005',
    feeCurrency: 'SOL' as Currency,
    feePayer: USER_ADDRESS,
    id,
    providerName: 'helius',
    slot: 100000,
    status: 'success',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

async function processTransactions(transactions: SolanaTransaction[]): Promise<SolanaLedgerDraft[]> {
  const processor = createProcessor();
  return expectOk(await processor.process(transactions, ACCOUNT_CONTEXT));
}

async function processOne(transaction: SolanaTransaction): Promise<SolanaLedgerDraft> {
  const drafts = await processTransactions([transaction]);
  expect(drafts).toHaveLength(1);
  return drafts[0]!;
}

function postingsByRole(draft: SolanaLedgerDraft, role: AccountingPostingDraft['role']): AccountingPostingDraft[] {
  return draft.journals.flatMap((journal) => journal.postings).filter((posting) => posting.role === role);
}

describe('SolanaProcessorV2', () => {
  test('emits incoming SOL as transfer principal without charging sender fees to the wallet', async () => {
    const draft = await processOne(
      createTransaction({
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
        id: 'sig-incoming-sol',
      })
    );

    expect(draft.sourceActivity).toMatchObject({
      blockchainName: 'solana',
      blockchainTransactionHash: 'sig-incoming-sol',
      ownerAccountId: ACCOUNT_ID,
      sourceActivityStableKey: 'sig-incoming-sol',
    });
    expect(draft.journals).toHaveLength(1);
    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer', journalStableKey: 'transfer' });
    expect(draft.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['principal', '1'],
    ]);
    expect(draft.journals[0]?.postings[0]?.assetId).toBe('blockchain:solana:native');
  });

  test('emits outgoing SOL principal plus network fee', async () => {
    const draft = await processOne(
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '2500005000',
            postBalance: '500000000',
          },
          {
            account: EXTERNAL_ADDRESS,
            preBalance: '1000000000',
            postBalance: '3000000000',
          },
        ],
        feePayer: USER_ADDRESS,
        id: 'sig-outgoing-sol',
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer' });
    expect(draft.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['principal', '-2'],
      ['fee', '-0.000005'],
    ]);
    expect(postingsByRole(draft, 'fee')[0]?.sourceComponentRefs[0]?.component.componentKind).toBe('network_fee');
  });

  test('models SOL to SPL-token swaps as trade postings plus network fee', async () => {
    const draft = await processOne(
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000005000',
            postBalance: '500000000',
          },
        ],
        id: 'sig-swap-sol-usdc',
        instructions: [
          {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
          },
        ],
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: USDC_MINT,
            owner: USER_ADDRESS,
            preAmount: '0',
            postAmount: '1000000000',
            symbol: 'USDC',
          },
        ],
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'trade', journalStableKey: 'trade' });
    expect(
      draft.journals[0]?.postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])
    ).toEqual([
      ['SOL', 'principal', '-0.5'],
      ['USDC', 'principal', '1000'],
      ['SOL', 'fee', '-0.000005'],
    ]);
  });

  test('preserves ATA rent as protocol overhead on token sends with recipient account creation', async () => {
    const draft = await processOne(
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '23281532',
            postBalance: '21233610',
          },
          {
            account: 'recipientAtaAccount',
            preBalance: '0',
            postBalance: '2039280',
          },
        ],
        eventId: 'sig-ata-rent:event',
        feeAmount: '0.000008642',
        feePayer: USER_ADDRESS,
        id: 'sig-ata-rent',
        instructions: [
          {
            programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
          },
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          },
        ],
        tokenChanges: [
          {
            account: TOKEN_ACCOUNT,
            decimals: 6,
            mint: USDC_MINT,
            owner: USER_ADDRESS,
            preAmount: '200000000',
            postAmount: '50000000',
            symbol: 'USDC',
          },
          {
            account: 'recipientAtaAccount',
            decimals: 6,
            mint: USDC_MINT,
            owner: EXTERNAL_ADDRESS,
            preAmount: '0',
            postAmount: '150000000',
            symbol: 'USDC',
          },
        ],
      })
    );

    const principal = postingsByRole(draft, 'principal')[0];
    const overhead = postingsByRole(draft, 'protocol_overhead')[0];
    const fee = postingsByRole(draft, 'fee')[0];

    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer' });
    expect(principal?.assetSymbol).toBe('USDC');
    expect(principal?.quantity.toFixed()).toBe('-150');
    expect(overhead?.assetSymbol).toBe('SOL');
    expect(overhead?.quantity.toFixed()).toBe('-0.00203928');
    expect(fee?.quantity.toFixed()).toBe('-0.000008642');
  });

  test('emits fee-only Solana activities as expense-only journals', async () => {
    const draft = await processOne(
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000',
            postBalance: '995000',
          },
        ],
        feePayer: USER_ADDRESS,
        id: 'sig-fee-only',
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'expense_only', journalStableKey: 'network_fee' });
    expect(draft.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['fee', '-0.000005'],
    ]);
  });

  test('emits staking reward inflows as staking_reward postings', async () => {
    const draft = await processOne(
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000000000',
            postBalance: '1000100000',
          },
        ],
        feeAmount: '0',
        feePayer: CONTRACT_ADDRESS,
        id: 'sig-staking-reward',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111111',
          },
        ],
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'staking_reward', journalStableKey: 'staking_reward' });
    expect(draft.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['staking_reward', '0.0001'],
    ]);
    expect(draft.journals[0]?.postings[0]?.sourceComponentRefs[0]?.component.componentKind).toBe('staking_reward');
  });

  test('models simple staking deposits as liquid to staked custody movements', async () => {
    const draft = await processOne(
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '1000005000',
            postBalance: '500000000',
          },
        ],
        feePayer: USER_ADDRESS,
        id: 'sig-stake-sol',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111111',
          },
        ],
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event', journalStableKey: 'protocol_event' });
    expect(
      draft.journals[0]?.postings.map((posting) => [posting.role, posting.balanceCategory, posting.quantity.toFixed()])
    ).toEqual([
      ['protocol_deposit', 'liquid', '-0.5'],
      ['principal', 'staked', '0.5'],
      ['fee', 'liquid', '-0.000005'],
    ]);
  });

  test('uses stake-account import source balance changes as staked custody evidence', async () => {
    const draft = await processOne(
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '4000005000',
            postBalance: '1500000000',
          },
          {
            account: STAKE_ACCOUNT,
            preBalance: '0',
            postBalance: '2500000000',
          },
        ],
        feePayer: USER_ADDRESS,
        id: 'sig-stake-account-source',
        importSourceAddress: STAKE_ACCOUNT,
        importSourceKind: 'stake_account',
        instructions: [
          {
            programId: 'Stake11111111111111111111111111111111111111',
          },
        ],
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event', journalStableKey: 'protocol_event' });
    expect(
      draft.journals[0]?.postings.map((posting) => [posting.role, posting.balanceCategory, posting.quantity.toFixed()])
    ).toEqual([
      ['protocol_deposit', 'liquid', '-2.5'],
      ['principal', 'staked', '2.5'],
      ['fee', 'liquid', '-0.000005'],
    ]);
  });

  test('splits stake-account close rewards from staked principal', async () => {
    const drafts = await processTransactions([
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '99270171',
            postBalance: '4925684212',
          },
          {
            account: STAKE_ACCOUNT,
            preBalance: '4826419041',
            postBalance: '0',
          },
        ],
        feePayer: USER_ADDRESS,
        id: 'sig-close-stake-account',
        instructions: [
          {
            accounts: [STAKE_ACCOUNT, USER_ADDRESS, USER_ADDRESS],
            programId: 'Stake11111111111111111111111111111111111111',
          },
        ],
        timestamp: 1_734_297_044_000,
      }),
      createTransaction({
        accountChanges: [
          {
            account: USER_ADDRESS,
            preBalance: '5000000000',
            postBalance: '497712120',
          },
          {
            account: STAKE_ACCOUNT,
            preBalance: '0',
            postBalance: '4502282880',
          },
        ],
        feePayer: USER_ADDRESS,
        id: 'sig-create-stake-account',
        instructions: [
          {
            accounts: [USER_ADDRESS, STAKE_ACCOUNT],
            programId: '11111111111111111111111111111111',
          },
          {
            accounts: [STAKE_ACCOUNT, USER_ADDRESS],
            programId: 'Stake11111111111111111111111111111111111111',
          },
        ],
        timestamp: 1_704_753_508_000,
      }),
    ]);

    const closeDraft = drafts.find(
      (draft) => draft.sourceActivity.blockchainTransactionHash === 'sig-close-stake-account'
    );
    expect(closeDraft?.journals[0]).toMatchObject({ journalKind: 'protocol_event' });
    expect(
      closeDraft?.journals[0]?.postings.map((posting) => [
        posting.role,
        posting.balanceCategory,
        posting.quantity.toFixed(),
      ])
    ).toEqual([
      ['principal', 'staked', '-4.50228288'],
      ['protocol_refund', 'liquid', '4.50228288'],
      ['staking_reward', 'liquid', '0.324131161'],
    ]);
  });
});
