import {
  buildBalanceV2FromPostings,
  reconcileBalanceV2Shadow,
  type BalanceV2LegacyTransactionInput,
  type BalanceV2PostingInput,
} from '@exitbook/accounting/balance-v2';
import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { getSolanaChainConfig, type SolanaTransaction } from '@exitbook/blockchain-providers/solana';
import type { TransactionDraft } from '@exitbook/core';
import { ok, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import {
  computeAccountingJournalFingerprint,
  computeAccountingPostingFingerprint,
  type AccountingJournalDraft,
} from '@exitbook/ledger';
import { describe, expect, test, vi } from 'vitest';

import { type SolanaLedgerDraft } from '../journal-assembler.js';
import { SolanaProcessorV2 } from '../processor-v2.js';
import { SolanaProcessor } from '../processor.js';

const ACCOUNT_ID = 42;
const ACCOUNT_FINGERPRINT = 'account:fingerprint:solana-user';
const USER_ADDRESS = 'user1111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'external222222222222222222222222222222222222';
const TOKEN_ACCOUNT = 'token4444444444444444444444444444444444444444';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function createMockProviderRuntime(): IBlockchainProviderRuntime {
  return {
    getTokenMetadata: vi.fn().mockResolvedValue(ok(new Map())),
  } as unknown as IBlockchainProviderRuntime;
}

function getTestChainConfig() {
  const chainConfig = getSolanaChainConfig('solana');
  if (!chainConfig) {
    throw new Error('Solana chain config not found');
  }

  return chainConfig;
}

function createLegacyProcessor() {
  return new SolanaProcessor(createMockProviderRuntime());
}

function createLedgerProcessor() {
  return new SolanaProcessorV2(getTestChainConfig());
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

async function reconcileLegacyBalanceScenario(normalizedData: SolanaTransaction[]) {
  const legacyProcessor = createLegacyProcessor();
  const legacyResult = await legacyProcessor.process(normalizedData, {
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
  });
  if (legacyResult.isErr()) {
    throw legacyResult.error;
  }

  const legacyTransactions = legacyDraftsToBalanceInputs(legacyResult.value);
  const ledgerPostings = await buildLedgerPostings(normalizedData);

  return reconcileBalanceV2Shadow({
    legacyTransactions,
    ledgerPostings,
  });
}

async function buildLedgerPostings(normalizedData: SolanaTransaction[]): Promise<BalanceV2PostingInput[]> {
  const ledgerProcessor = createLedgerProcessor();
  const ledgerResult = await ledgerProcessor.process(normalizedData, {
    account: {
      id: ACCOUNT_ID,
      fingerprint: ACCOUNT_FINGERPRINT,
    },
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
  });
  if (ledgerResult.isErr()) {
    throw ledgerResult.error;
  }

  return ledgerResult.value.flatMap(toBalanceV2PostingInputs);
}

async function buildLedgerBalanceSummary(normalizedData: SolanaTransaction[]) {
  const ledgerPostings = await buildLedgerPostings(normalizedData);
  const balanceResult = assertOk(buildBalanceV2FromPostings(ledgerPostings));

  return balanceResult.balances.map((balance) => ({
    accountId: balance.accountId,
    assetId: balance.assetId,
    assetSymbol: balance.assetSymbol,
    balanceCategory: balance.balanceCategory,
    quantity: balance.quantity.toFixed(),
  }));
}

function toBalanceV2PostingInputs(draft: SolanaLedgerDraft): BalanceV2PostingInput[] {
  return draft.journals.flatMap((journal) => toJournalBalanceV2PostingInputs(draft, journal));
}

function toJournalBalanceV2PostingInputs(
  draft: SolanaLedgerDraft,
  journal: AccountingJournalDraft
): BalanceV2PostingInput[] {
  const journalFingerprint = assertOk(computeAccountingJournalFingerprint(journal));

  return journal.postings.map((posting) => ({
    accountId: draft.sourceActivity.ownerAccountId,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    balanceCategory: posting.balanceCategory,
    quantity: posting.quantity,
    journalFingerprint,
    postingFingerprint: assertOk(computeAccountingPostingFingerprint(journalFingerprint, posting)),
    sourceActivityFingerprint: draft.sourceActivity.sourceActivityFingerprint,
  }));
}

function legacyDraftsToBalanceInputs(drafts: readonly TransactionDraft[]): BalanceV2LegacyTransactionInput[] {
  return drafts.map((draft, transactionIndex) => ({
    accountId: ACCOUNT_ID,
    fees: draft.fees.map((fee, feeIndex) => ({
      ...fee,
      movementFingerprint: `legacy:solana:${transactionIndex + 1}:fee:${feeIndex + 1}`,
    })),
    movements: {
      inflows: (draft.movements.inflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy:solana:${transactionIndex + 1}:in:${movementIndex + 1}`,
      })),
      outflows: (draft.movements.outflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy:solana:${transactionIndex + 1}:out:${movementIndex + 1}`,
      })),
    },
    txFingerprint: `legacy:solana:${transactionIndex + 1}`,
  }));
}

describe('SolanaProcessorV2 balance shadow reconciliation', () => {
  test('matches balance v1 for incoming SOL transfers', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
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
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for outgoing SOL transfers and user-paid fees', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
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
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for SOL to SPL-token swaps', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
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
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for associated token account rent overhead', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
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
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('surfaces staking custody as the expected ledger-v2 balance category expansion', async () => {
    const balances = await buildLedgerBalanceSummary([
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
      }),
    ]);

    expect(balances).toEqual([
      {
        accountId: ACCOUNT_ID,
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'liquid',
        quantity: '-0.500005',
      },
      {
        accountId: ACCOUNT_ID,
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'staked',
        quantity: '0.5',
      },
    ]);
  });
});
