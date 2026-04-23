import { describe, expect, test } from 'vitest';

import { CardanoProcessorV2 } from '../processor-v2.js';

import {
  ACCOUNT_FINGERPRINT,
  ACCOUNT_ID,
  EXTERNAL_ADDRESS,
  SIBLING_USER_ADDRESS,
  USER_ADDRESS,
  createInput,
  createOutput,
  createTransaction,
} from './test-utils.js';

function createProcessor() {
  return new CardanoProcessorV2();
}

describe('CardanoProcessorV2', () => {
  test('builds a transfer journal for incoming ADA', async () => {
    const processor = createProcessor();

    const result = await processor.process(
      [
        createTransaction({
          id: 'tx-incoming-1',
          inputs: [createInput(EXTERNAL_ADDRESS, '2170000', 'lovelace', { txHash: 'prev-incoming-1' })],
          outputs: [createOutput(USER_ADDRESS, '2000000')],
        }),
      ],
      {
        account: {
          id: ACCOUNT_ID,
          fingerprint: ACCOUNT_FINGERPRINT,
        },
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals).toHaveLength(1);
    expect(draft?.journals[0]?.journalKind).toBe('transfer');
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('2');
  });

  test('nets change out of principal transfer amount and emits fee separately', async () => {
    const processor = createProcessor();

    const result = await processor.process(
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
      {
        account: {
          id: ACCOUNT_ID,
          fingerprint: ACCOUNT_FINGERPRINT,
        },
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer', 'expense_only']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-3');
    expect(draft?.journals[1]?.postings[0]?.quantity.toFixed()).toBe('-0.17');
  });

  test('preserves distinct UTXO input component refs for same-asset spends', async () => {
    const processor = createProcessor();

    const result = await processor.process(
      [
        createTransaction({
          id: 'tx-multi-input-1',
          inputs: [
            createInput(USER_ADDRESS, '6000000', 'lovelace', { txHash: 'prev-input-a' }),
            createInput(USER_ADDRESS, '4170000', 'lovelace', { outputIndex: 1, txHash: 'prev-input-b' }),
          ],
          outputs: [createOutput(EXTERNAL_ADDRESS, '10000000')],
        }),
      ],
      {
        account: {
          id: ACCOUNT_ID,
          fingerprint: ACCOUNT_FINGERPRINT,
        },
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const transferPosting = result.value[0]?.journals.find((journal) => journal.journalKind === 'transfer')
      ?.postings[0];
    expect(transferPosting?.quantity.toFixed()).toBe('-10');
    expect(
      transferPosting?.sourceComponentRefs.map((ref) => ({
        componentId: ref.component.componentId,
        componentKind: ref.component.componentKind,
        quantity: ref.quantity.toFixed(),
      }))
    ).toEqual([
      {
        componentId: 'utxo:prev-input-a:0',
        componentKind: 'utxo_input',
        quantity: '6',
      },
      {
        componentId: 'utxo:prev-input-b:1',
        componentKind: 'utxo_input',
        quantity: '4.17',
      },
    ]);
  });

  test('preserves distinct UTXO output component refs for same-asset receipts', async () => {
    const processor = createProcessor();

    const result = await processor.process(
      [
        createTransaction({
          id: 'tx-multi-output-1',
          inputs: [createInput(EXTERNAL_ADDRESS, '5170000', 'lovelace', { txHash: 'prev-incoming' })],
          outputs: [
            createOutput(USER_ADDRESS, '2000000'),
            createOutput(EXTERNAL_ADDRESS, '170000', 'lovelace', { outputIndex: 1 }),
            createOutput(USER_ADDRESS, '3000000', 'lovelace', { outputIndex: 2 }),
          ],
        }),
      ],
      {
        account: {
          id: ACCOUNT_ID,
          fingerprint: ACCOUNT_FINGERPRINT,
        },
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const transferPosting = result.value[0]?.journals.find((journal) => journal.journalKind === 'transfer')
      ?.postings[0];
    expect(transferPosting?.quantity.toFixed()).toBe('5');
    expect(
      transferPosting?.sourceComponentRefs.map((ref) => ({
        componentId: ref.component.componentId,
        componentKind: ref.component.componentKind,
        quantity: ref.quantity.toFixed(),
      }))
    ).toEqual([
      {
        componentId: 'utxo:tx-multi-output-1:0',
        componentKind: 'utxo_output',
        quantity: '2',
      },
      {
        componentId: 'utxo:tx-multi-output-1:2',
        componentKind: 'utxo_output',
        quantity: '3',
      },
    ]);
  });

  test('splits attributable staking withdrawal into transfer, reward, and fee journals', async () => {
    const processor = createProcessor();

    const result = await processor.process(
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
      {
        account: {
          id: ACCOUNT_ID,
          fingerprint: ACCOUNT_FINGERPRINT,
        },
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual([
      'transfer',
      'staking_reward',
      'expense_only',
    ]);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-9.83');
    expect(draft?.journals[1]?.postings[0]?.quantity.toFixed()).toBe('1');
    expect(draft?.journals[2]?.postings[0]?.quantity.toFixed()).toBe('-0.17');
  });

  test('does not materialize a staking reward journal for unattributed sibling-input withdrawals', async () => {
    const processor = createProcessor();

    const result = await processor.process(
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
      {
        account: {
          id: ACCOUNT_ID,
          fingerprint: ACCOUNT_FINGERPRINT,
        },
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS, SIBLING_USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer', 'expense_only']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-5.898');
    expect(draft?.journals[1]?.postings[0]?.quantity.toFixed()).toBe('-0.102');
  });
});
