import type { CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
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

async function processTransactions(transactions: CardanoTransaction[], walletAddresses: string[] = [USER_ADDRESS]) {
  const processor = createProcessor();

  return processor.process(transactions, {
    account: {
      id: ACCOUNT_ID,
      fingerprint: ACCOUNT_FINGERPRINT,
    },
    walletAddresses,
  });
}

describe('CardanoProcessorV2', () => {
  test('builds a transfer journal for incoming ADA', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-incoming-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '2170000', 'lovelace', { txHash: 'prev-incoming-1' })],
        outputs: [createOutput(USER_ADDRESS, '2000000')],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.sourceActivity.fromAddress).toBe(EXTERNAL_ADDRESS);
    expect(draft?.sourceActivity.toAddress).toBe(USER_ADDRESS);
    expect(draft?.journals).toHaveLength(1);
    expect(draft?.journals[0]?.journalKind).toBe('transfer');
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('2');
  });

  test('nets change out of principal transfer amount and emits the fee inside the transfer journal', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-change-1',
        inputs: [createInput(USER_ADDRESS, '10170000', 'lovelace', { txHash: 'prev-change-1' })],
        outputs: [
          createOutput(EXTERNAL_ADDRESS, '3000000'),
          createOutput(USER_ADDRESS, '7000000', 'lovelace', { outputIndex: 1 }),
        ],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.sourceActivity.fromAddress).toBe(USER_ADDRESS);
    expect(draft?.sourceActivity.toAddress).toBe(EXTERNAL_ADDRESS);
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-3');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.17');
    expect(draft?.journals[0]?.postings[1]?.role).toBe('fee');
  });

  test('preserves distinct UTXO input component refs for same-asset spends', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-multi-input-1',
        inputs: [
          createInput(USER_ADDRESS, '6000000', 'lovelace', { txHash: 'prev-input-a' }),
          createInput(USER_ADDRESS, '4170000', 'lovelace', { outputIndex: 1, txHash: 'prev-input-b' }),
        ],
        outputs: [createOutput(EXTERNAL_ADDRESS, '10000000')],
      }),
    ]);

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
    const result = await processTransactions([
      createTransaction({
        id: 'tx-multi-output-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '5170000', 'lovelace', { txHash: 'prev-incoming' })],
        outputs: [
          createOutput(USER_ADDRESS, '2000000'),
          createOutput(EXTERNAL_ADDRESS, '170000', 'lovelace', { outputIndex: 1 }),
          createOutput(USER_ADDRESS, '3000000', 'lovelace', { outputIndex: 2 }),
        ],
      }),
    ]);

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

  test('splits attributable staking withdrawal into transfer and reward journals with transfer fee posting', async () => {
    const result = await processTransactions([
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

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer', 'staking_reward']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-10.83');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.17');
    expect(draft?.journals[0]?.postings[1]?.role).toBe('fee');
    expect(draft?.journals[1]?.postings[0]?.quantity.toFixed()).toBe('1');
  });

  test('materializes wallet-scoped staking rewards across sibling-input withdrawals', async () => {
    const result = await processTransactions(
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

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer', 'staking_reward']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-10.83');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.17');
    expect(draft?.journals[0]?.postings[1]?.role).toBe('fee');
    expect(draft?.journals[1]?.postings[0]?.quantity.toFixed()).toBe('1');
    expect(draft?.journals[1]?.postings[0]?.role).toBe('staking_reward');
    expect(
      draft?.journals[0]?.postings[0]?.sourceComponentRefs.map((ref) => ({
        componentId: ref.component.componentId,
        componentKind: ref.component.componentKind,
        quantity: ref.quantity.toFixed(),
      }))
    ).toEqual([
      {
        componentId: 'utxo:prev-a:0',
        componentKind: 'utxo_input',
        quantity: '6',
      },
      {
        componentId: 'utxo:prev-b:1',
        componentKind: 'utxo_input',
        quantity: '4',
      },
    ]);
    expect(
      draft?.journals[1]?.postings[0]?.sourceComponentRefs.map((ref) => ({
        componentId: ref.component.componentId,
        componentKind: ref.component.componentKind,
        quantity: ref.quantity.toFixed(),
      }))
    ).toEqual([
      {
        componentId: 'withdrawal:stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
        componentKind: 'staking_reward',
        quantity: '1',
      },
    ]);
  });

  test('deduplicates repeated raw rows for the same wallet transaction', async () => {
    const sharedTransaction = createTransaction({
      id: 'tx-duplicate-wallet-row-1',
      inputs: [createInput(EXTERNAL_ADDRESS, '2170000', 'lovelace', { txHash: 'prev-duplicate-wallet-row-1' })],
      outputs: [createOutput(USER_ADDRESS, '2000000')],
    });
    const result = await processTransactions([sharedTransaction, sharedTransaction]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('2');
  });

  test('emits reward-funded external sends as transfer plus staking reward journals', async () => {
    const result = await processTransactions([
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
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer', 'staking_reward']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-1');
    expect(draft?.journals[0]?.postings[0]?.role).toBe('principal');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.17');
    expect(draft?.journals[0]?.postings[1]?.role).toBe('fee');
    expect(draft?.journals[1]?.postings[0]?.quantity.toFixed()).toBe('1');
    expect(draft?.journals[1]?.postings[0]?.role).toBe('staking_reward');
  });

  test('keeps claim-to-self fees inside the staking reward journal', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-reward-claim-to-self-1',
        feeAmount: '0.17',
        inputs: [createInput(USER_ADDRESS, '170000', 'lovelace', { txHash: 'prev-reward-claim-to-self-1' })],
        outputs: [createOutput(USER_ADDRESS, '1000000')],
        withdrawals: [
          {
            address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
            amount: '1',
            currency: 'ADA',
          },
        ],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['staking_reward']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('1');
    expect(draft?.journals[0]?.postings[0]?.role).toBe('staking_reward');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.17');
    expect(draft?.journals[0]?.postings[1]?.role).toBe('fee');
  });

  test('uses expense_only only when the fee is the entire account effect', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-fee-only-1',
        feeAmount: '0.17',
        inputs: [createInput(USER_ADDRESS, '1000000', 'lovelace', { txHash: 'prev-fee-only-1' })],
        outputs: [createOutput(USER_ADDRESS, '830000')],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.sourceActivity.fromAddress).toBe(USER_ADDRESS);
    expect(draft?.sourceActivity.toAddress).toBe(USER_ADDRESS);
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['expense_only']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-0.17');
    expect(draft?.journals[0]?.postings[0]?.role).toBe('fee');
  });

  test('rejects wallet-paid fee postings when provider data omits the fee currency', async () => {
    const transaction = createTransaction({
      id: 'tx-missing-fee-currency-1',
      feeAmount: '0.17',
      inputs: [createInput(USER_ADDRESS, '1000000', 'lovelace', { txHash: 'prev-missing-fee-currency-1' })],
      outputs: [createOutput(USER_ADDRESS, '830000')],
    });
    delete transaction.feeCurrency;

    const result = await processTransactions([transaction]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('missing fee currency');
  });

  test('rejects transactions outside the wallet address scope', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-outside-wallet-scope-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '1170000', 'lovelace', { txHash: 'prev-outside-wallet-scope-1' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '1000000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('has no effect for the wallet address scope');
  });

  test('rejects negative input amounts before accounting math', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-negative-input-1',
        inputs: [createInput(USER_ADDRESS, '-1000000', 'lovelace', { txHash: 'prev-negative-input-1' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '830000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('input amount must not be negative');
  });

  test('rejects negative output amounts before accounting math', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-negative-output-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '1170000', 'lovelace', { txHash: 'prev-negative-output-1' })],
        outputs: [createOutput(USER_ADDRESS, '-1000000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('output amount must not be negative');
  });

  test('rejects negative fee amounts before accounting math', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-negative-fee-1',
        feeAmount: '-0.17',
        inputs: [createInput(USER_ADDRESS, '1000000', 'lovelace', { txHash: 'prev-negative-fee-1' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '830000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('fee amount must not be negative');
  });

  test('rejects negative withdrawal amounts before accounting math', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-negative-withdrawal-1',
        feeAmount: '0.17',
        inputs: [createInput(USER_ADDRESS, '1000000', 'lovelace', { txHash: 'prev-negative-withdrawal-1' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '830000')],
        withdrawals: [
          {
            address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
            amount: '-1',
            currency: 'ADA',
          },
        ],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('withdrawal amount must not be negative');
  });

  test('rejects fractional token decimals before accounting math', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-fractional-decimals-1',
        inputs: [
          createInput(USER_ADDRESS, [
            {
              decimals: 1.5,
              quantity: '1000',
              unit: 'token-with-fractional-decimals',
            },
          ]),
        ],
        outputs: [createOutput(EXTERNAL_ADDRESS, '830000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('decimals must be a non-negative integer');
  });
});
