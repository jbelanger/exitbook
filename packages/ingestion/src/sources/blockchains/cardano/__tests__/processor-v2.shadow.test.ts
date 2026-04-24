import { reconcileLegacyAccountingToLedgerDrafts } from '@exitbook/accounting/ledger-shadow';
import type { CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
import type { Logger } from '@exitbook/logger';
import { describe, expect, test, vi } from 'vitest';

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

const noopLogger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
};

function createLegacyProcessor() {
  return new CardanoProcessor();
}

function createLedgerProcessor() {
  return new CardanoProcessorV2();
}

async function reconcileSingleAddressScenario(normalizedData: CardanoTransaction[]) {
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

  const ledgerProcessor = createLedgerProcessor();
  const ledgerResult = await ledgerProcessor.process(normalizedData, {
    account: {
      id: ACCOUNT_ID,
      fingerprint: ACCOUNT_FINGERPRINT,
    },
    walletAddresses: [USER_ADDRESS],
  });
  if (ledgerResult.isErr()) {
    throw ledgerResult.error;
  }

  return reconcileLegacyAccountingToLedgerDrafts(legacyTransactions, ledgerResult.value, noopLogger);
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

describe('CardanoProcessorV2 shadow reconciliation', () => {
  test('matches legacy accounting effects for incoming transfers', async () => {
    const reconciliationResult = await reconcileSingleAddressScenario([
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

  test('matches legacy accounting effects for transfers with change', async () => {
    const reconciliationResult = await reconcileSingleAddressScenario([
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

  test('documents the intentional staking withdrawal divergence from legacy address-scope accounting', async () => {
    const reconciliationResult = await reconcileSingleAddressScenario([
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
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(
      reconciliationResult.value.diffs.map((diff) => ({
        delta: diff.delta.toFixed(),
        ledgerQuantity: diff.ledgerQuantity?.toFixed(),
        legacyQuantity: diff.legacyQuantity?.toFixed(),
        role: diff.role,
      }))
    ).toEqual([
      {
        delta: '-1',
        ledgerQuantity: '-10.83',
        legacyQuantity: '-9.83',
        role: 'principal',
      },
    ]);
  });

  test('emits one wallet-scope ledger activity for duplicated same-hash child-address raw rows', async () => {
    const processor = createLedgerProcessor();
    const sharedTransaction = createMultiSourceExternalSendTransaction();
    const result = await processor.process([sharedTransaction, sharedTransaction, sharedTransaction], {
      account: {
        id: ACCOUNT_ID,
        fingerprint: ACCOUNT_FINGERPRINT,
      },
      walletAddresses: [USER_ADDRESS, SIBLING_USER_ADDRESS, THIRD_USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value).toHaveLength(1);
    const [draft] = result.value;
    expect(draft?.sourceActivity.accountId).toBe(ACCOUNT_ID);
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer', 'staking_reward']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-2679.718442');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.191373');
    expect(draft?.journals[1]?.postings[0]?.quantity.toFixed()).toBe('10.524451');
  });
});
