import { reconcileBalanceV2Shadow, type BalanceV2PostingInput } from '@exitbook/accounting/balance-v2';
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
  ACCOUNT_ID,
  EXTERNAL_ADDRESS,
  SIBLING_USER_ADDRESS,
  THIRD_USER_ADDRESS,
  USER_ADDRESS,
  buildCardanoAccountFingerprint,
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

async function reconcileBalanceScenario(normalizedData: CardanoTransaction[], userAddresses: string[]) {
  return reconcileBalanceScenarios([
    {
      accountId: ACCOUNT_ID,
      normalizedData,
      primaryAddress: USER_ADDRESS,
      userAddresses,
    },
  ]);
}

async function reconcileBalanceScenarios(
  scenarios: {
    accountId: number;
    normalizedData: CardanoTransaction[];
    primaryAddress: string;
    userAddresses: string[];
  }[]
) {
  const legacyTransactions = [];
  const ledgerPostings: BalanceV2PostingInput[] = [];
  let nextTransactionId = 1;

  for (const scenario of scenarios) {
    const legacyProcessor = createLegacyProcessor();
    const legacyResult = await legacyProcessor.process(scenario.normalizedData, {
      primaryAddress: scenario.primaryAddress,
      userAddresses: scenario.userAddresses,
    });
    if (legacyResult.isErr()) {
      throw legacyResult.error;
    }

    legacyTransactions.push(
      ...legacyResult.value.map((draft) =>
        materializeProcessedTransaction(draft, nextTransactionId++, scenario.accountId)
      )
    );

    const ledgerProcessor = createLedgerProcessor();
    const ledgerResult = await ledgerProcessor.process(scenario.normalizedData, {
      account: {
        id: scenario.accountId,
        fingerprint: buildCardanoAccountFingerprint(scenario.accountId),
      },
      primaryAddress: scenario.primaryAddress,
      userAddresses: scenario.userAddresses,
    });
    if (ledgerResult.isErr()) {
      throw ledgerResult.error;
    }

    ledgerPostings.push(...ledgerResult.value.flatMap(toBalanceV2PostingInputs));
  }

  return reconcileBalanceV2Shadow({
    legacyTransactions,
    ledgerPostings,
  });
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
    const reconciliationResult = await reconcileBalanceScenario(
      [
        createTransaction({
          id: 'tx-incoming-1',
          inputs: [createInput(EXTERNAL_ADDRESS, '2170000', 'lovelace', { txHash: 'prev-incoming-1' })],
          outputs: [createOutput(USER_ADDRESS, '2000000')],
        }),
      ],
      [USER_ADDRESS]
    );

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for transfers with change', async () => {
    const reconciliationResult = await reconcileBalanceScenario(
      [
        createTransaction({
          id: 'tx-change-1',
          inputs: [createInput(USER_ADDRESS, '10170000', 'lovelace', { txHash: 'prev-change-1' })],
          outputs: [
            createOutput(EXTERNAL_ADDRESS, '3000000'),
            createOutput(USER_ADDRESS, '7000000', 'lovelace', { outputIndex: 1 }),
          ],
        }),
      ],
      [USER_ADDRESS]
    );

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for attributable staking withdrawals', async () => {
    const reconciliationResult = await reconcileBalanceScenario(
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

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for unattributed sibling-input withdrawals', async () => {
    const reconciliationResult = await reconcileBalanceScenario(
      [
        createTransaction({
          id: 'tx-withdrawal-2',
          feeAmount: '0.17',
          inputs: [
            createInput(USER_ADDRESS, '6000000', 'lovelace', { txHash: 'prev-a' }),
            createInput(SIBLING_USER_ADDRESS, '4000000', 'lovelace', { txHash: 'prev-b', outputIndex: 1 }),
          ],
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
      [USER_ADDRESS, SIBLING_USER_ADDRESS]
    );

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for reward-only claim fees', async () => {
    const reconciliationResult = await reconcileBalanceScenario(
      [
        createTransaction({
          id: 'tx-reward-only-fee-1',
          feeAmount: '0.17',
          inputs: [createInput(USER_ADDRESS, '170000', 'lovelace', { txHash: 'prev-reward-only-fee-1' })],
          outputs: [createOutput(EXTERNAL_ADDRESS, '1000000')],
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

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for fee-only effects', async () => {
    const reconciliationResult = await reconcileBalanceScenario(
      [
        createTransaction({
          id: 'tx-fee-only-1',
          feeAmount: '0.17',
          inputs: [createInput(USER_ADDRESS, '1000000', 'lovelace', { txHash: 'prev-fee-only-1' })],
          outputs: [createOutput(USER_ADDRESS, '830000')],
        }),
      ],
      [USER_ADDRESS]
    );

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for same-hash multi-source external sends with wallet-scope withdrawals', async () => {
    const sharedTransaction = createMultiSourceExternalSendTransaction();
    const userAddresses = [USER_ADDRESS, SIBLING_USER_ADDRESS, THIRD_USER_ADDRESS];

    const reconciliationResult = await reconcileBalanceScenarios([
      {
        accountId: 87,
        normalizedData: [sharedTransaction],
        primaryAddress: USER_ADDRESS,
        userAddresses,
      },
      {
        accountId: 89,
        normalizedData: [sharedTransaction],
        primaryAddress: SIBLING_USER_ADDRESS,
        userAddresses,
      },
      {
        accountId: 91,
        normalizedData: [sharedTransaction],
        primaryAddress: THIRD_USER_ADDRESS,
        userAddresses,
      },
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });
});
