import { reconcileLegacyAccountingToLedgerDrafts } from '@exitbook/accounting/ledger-shadow';
import type { CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
import type { Logger } from '@exitbook/logger';
import { describe, expect, test, vi } from 'vitest';

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

async function reconcileScenario(normalizedData: CardanoTransaction[], userAddresses: string[]) {
  return reconcileScenarios([
    {
      accountId: ACCOUNT_ID,
      normalizedData,
      primaryAddress: USER_ADDRESS,
      userAddresses,
    },
  ]);
}

async function reconcileScenarios(
  scenarios: {
    accountId: number;
    normalizedData: CardanoTransaction[];
    primaryAddress: string;
    userAddresses: string[];
  }[]
) {
  const legacyTransactions = [];
  const ledgerDrafts = [];
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

    ledgerDrafts.push(...ledgerResult.value);
  }

  return reconcileLegacyAccountingToLedgerDrafts(legacyTransactions, ledgerDrafts, noopLogger);
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
    const reconciliationResult = await reconcileScenario(
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

  test('matches legacy accounting effects for transfers with change', async () => {
    const reconciliationResult = await reconcileScenario(
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

  test('matches legacy accounting effects for attributable staking withdrawals', async () => {
    const reconciliationResult = await reconcileScenario(
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

  test('matches legacy accounting effects for unattributed sibling-input withdrawals', async () => {
    const reconciliationResult = await reconcileScenario(
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

  test('matches legacy accounting effects for same-hash multi-source external sends with wallet-scope withdrawals', async () => {
    const sharedTransaction = createMultiSourceExternalSendTransaction();
    const userAddresses = [USER_ADDRESS, SIBLING_USER_ADDRESS, THIRD_USER_ADDRESS];

    const reconciliationResult = await reconcileScenarios([
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
