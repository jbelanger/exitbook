import {
  buildBalanceV2FromPostings,
  reconcileBalanceV2Shadow,
  type BalanceV2PostingInput,
} from '@exitbook/accounting/balance-v2';
import type { CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
import { assertOk } from '@exitbook/foundation/test-utils';
import {
  computeAccountingJournalFingerprint,
  computeAccountingPostingFingerprint,
  type AccountingJournalDraft,
} from '@exitbook/ledger';
import { describe, expect, test } from 'vitest';

import { type CardanoLedgerDraft } from '../journal-assembler.js';
import { CardanoProcessorV2 } from '../processor-v2.js';
import { CardanoProcessor } from '../processor.js';

import {
  ACCOUNT_FINGERPRINT,
  ACCOUNT_ID,
  EXTERNAL_ADDRESS,
  SIBLING_USER_ADDRESS,
  THIRD_USER_ADDRESS,
  USER_ADDRESS,
  createInput,
  createOutput,
  createTransaction,
  materializeProcessedTransaction,
} from './test-utils.js';

function createLegacyProcessor() {
  return new CardanoProcessor();
}

function createLedgerProcessor() {
  return new CardanoProcessorV2();
}

async function reconcileLegacyBalanceScenario(normalizedData: CardanoTransaction[]) {
  const legacyProcessor = createLegacyProcessor();
  const legacyResult = await legacyProcessor.process(normalizedData, {
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
  });
  if (legacyResult.isErr()) {
    throw legacyResult.error;
  }

  const legacyTransactions = legacyResult.value.map((draft, index) =>
    materializeProcessedTransaction(draft, index + 1, ACCOUNT_ID)
  );

  const ledgerPostings = await buildLedgerPostings(normalizedData, [USER_ADDRESS]);

  return reconcileBalanceV2Shadow({
    legacyTransactions,
    ledgerPostings,
  });
}

async function buildLedgerPostings(
  normalizedData: CardanoTransaction[],
  walletAddresses: string[]
): Promise<BalanceV2PostingInput[]> {
  const ledgerProcessor = createLedgerProcessor();
  const ledgerResult = await ledgerProcessor.process(normalizedData, {
    account: {
      id: ACCOUNT_ID,
      fingerprint: ACCOUNT_FINGERPRINT,
    },
    walletAddresses,
  });
  if (ledgerResult.isErr()) {
    throw ledgerResult.error;
  }

  return ledgerResult.value.flatMap(toBalanceV2PostingInputs);
}

async function buildLedgerBalanceSummary(normalizedData: CardanoTransaction[], walletAddresses: string[]) {
  const ledgerPostings = await buildLedgerPostings(normalizedData, walletAddresses);
  const balanceResult = assertOk(buildBalanceV2FromPostings(ledgerPostings));

  return balanceResult.balances.map((balance) => ({
    accountId: balance.accountId,
    assetId: balance.assetId,
    assetSymbol: balance.assetSymbol,
    quantity: balance.quantity.toFixed(),
  }));
}

function toBalanceV2PostingInputs(draft: CardanoLedgerDraft): BalanceV2PostingInput[] {
  return draft.journals.flatMap((journal) => toJournalBalanceV2PostingInputs(draft, journal));
}

function toJournalBalanceV2PostingInputs(
  draft: CardanoLedgerDraft,
  journal: AccountingJournalDraft
): BalanceV2PostingInput[] {
  const journalFingerprint = assertOk(computeAccountingJournalFingerprint(journal));

  return journal.postings.map((posting) => ({
    accountId: draft.sourceActivity.accountId,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    quantity: posting.quantity,
    journalFingerprint,
    postingFingerprint: assertOk(computeAccountingPostingFingerprint(journalFingerprint, posting)),
    sourceActivityFingerprint: draft.sourceActivity.sourceActivityFingerprint,
  }));
}

function createMultiSourceExternalSendTransaction(): CardanoTransaction {
  return createTransaction({
    id: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
    feeAmount: '0.191373',
    inputs: [
      createInput(USER_ADDRESS, '1021402541', 'lovelace', { txHash: 'prev-source-a' }),
      createInput(SIBLING_USER_ADDRESS, '975034581', 'lovelace', {
        outputIndex: 1,
        txHash: 'prev-source-b',
      }),
      createInput(THIRD_USER_ADDRESS, '672948242', 'lovelace', {
        outputIndex: 2,
        txHash: 'prev-source-c',
      }),
    ],
    outputs: [createOutput(EXTERNAL_ADDRESS, '2679718442')],
    withdrawals: [
      {
        address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
        amount: '10.524451',
        currency: 'ADA',
      },
    ],
  });
}

describe('CardanoProcessorV2 balance shadow reconciliation', () => {
  test('matches balance v1 for incoming transfers', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        id: 'tx-incoming-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '2170000', 'lovelace', { txHash: 'prev-incoming-1' })],
        outputs: [createOutput(USER_ADDRESS, '2000000')],
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for transfers with change', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        id: 'tx-change-1',
        inputs: [createInput(USER_ADDRESS, '10170000', 'lovelace', { txHash: 'prev-change-1' })],
        outputs: [
          createOutput(EXTERNAL_ADDRESS, '3000000'),
          createOutput(USER_ADDRESS, '7000000', 'lovelace', { outputIndex: 1 }),
        ],
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for fee-only effects', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        id: 'tx-fee-only-1',
        feeAmount: '0.17',
        inputs: [createInput(USER_ADDRESS, '1000000', 'lovelace', { txHash: 'prev-fee-only-1' })],
        outputs: [createOutput(USER_ADDRESS, '830000')],
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('computes corrected balance for reward-funded external sends', async () => {
    const balances = await buildLedgerBalanceSummary(
      [
        createTransaction({
          id: 'tx-withdrawal-1',
          feeAmount: '0.17',
          inputs: [createInput(USER_ADDRESS, '10000000', 'lovelace', { txHash: 'prev-withdrawal-1' })],
          outputs: [createOutput(EXTERNAL_ADDRESS, '10830000')],
          withdrawals: [
            {
              address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
              amount: '1',
              currency: 'ADA',
            },
          ],
        }),
      ],
      [USER_ADDRESS]
    );

    expect(balances).toEqual([
      {
        accountId: ACCOUNT_ID,
        assetId: 'blockchain:cardano:native',
        assetSymbol: 'ADA',
        quantity: '-10',
      },
    ]);
  });

  test('computes one wallet-scope balance for duplicated same-hash child-address rows', async () => {
    const sharedTransaction = createMultiSourceExternalSendTransaction();
    const balances = await buildLedgerBalanceSummary(
      [sharedTransaction, sharedTransaction, sharedTransaction],
      [USER_ADDRESS, SIBLING_USER_ADDRESS, THIRD_USER_ADDRESS]
    );

    expect(balances).toEqual([
      {
        accountId: ACCOUNT_ID,
        assetId: 'blockchain:cardano:native',
        assetSymbol: 'ADA',
        quantity: '-2669.385364',
      },
    ]);
  });
});
