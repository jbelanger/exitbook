import { getBitcoinChainConfig, type BitcoinTransaction } from '@exitbook/blockchain-providers/bitcoin';
import { describe, expect, test } from 'vitest';

import { BitcoinProcessorV2 } from '../processor-v2.js';

import {
  ACCOUNT_FINGERPRINT,
  ACCOUNT_ID,
  ANOTHER_EXTERNAL_ADDRESS,
  EXTERNAL_ADDRESS,
  SIBLING_USER_ADDRESS,
  USER_ADDRESS,
  createInput,
  createOutput,
  createTransaction,
} from './test-utils.js';

function createProcessor() {
  const chainConfig = getBitcoinChainConfig('bitcoin');
  if (!chainConfig) {
    throw new Error('Bitcoin chain config not found');
  }

  return new BitcoinProcessorV2(chainConfig);
}

async function processTransactions(transactions: BitcoinTransaction[], walletAddresses: string[] = [USER_ADDRESS]) {
  const processor = createProcessor();

  return processor.process(transactions, {
    account: {
      id: ACCOUNT_ID,
      fingerprint: ACCOUNT_FINGERPRINT,
    },
    walletAddresses,
  });
}

describe('BitcoinProcessorV2', () => {
  test('builds a transfer journal for incoming BTC', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-incoming-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '200010000', { txid: 'prev-incoming-1' })],
        outputs: [createOutput(USER_ADDRESS, '200000000')],
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
        inputs: [createInput(USER_ADDRESS, '100010000', { txid: 'prev-change-1' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '30000000'), createOutput(USER_ADDRESS, '70000000', { index: 1 })],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.sourceActivity.fromAddress).toBe(USER_ADDRESS);
    expect(draft?.sourceActivity.toAddress).toBe(EXTERNAL_ADDRESS);
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-0.3');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.0001');
    expect(draft?.journals[0]?.postings[1]?.role).toBe('fee');
  });

  test('preserves distinct UTXO input component refs for same-asset spends', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-multi-input-1',
        inputs: [
          createInput(USER_ADDRESS, '30000000', { txid: 'prev-input-a', vout: 0 }),
          createInput(USER_ADDRESS, '20010000', { txid: 'prev-input-b', vout: 1 }),
        ],
        outputs: [createOutput(EXTERNAL_ADDRESS, '50000000')],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const transferPosting = result.value[0]?.journals.find((journal) => journal.journalKind === 'transfer')
      ?.postings[0];
    expect(transferPosting?.quantity.toFixed()).toBe('-0.5');
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
        quantity: '0.3',
      },
      {
        componentId: 'utxo:prev-input-b:1',
        componentKind: 'utxo_input',
        quantity: '0.2001',
      },
    ]);
  });

  test('preserves distinct UTXO output component refs for same-asset receipts', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-multi-output-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '100010000', { txid: 'prev-incoming' })],
        outputs: [
          createOutput(USER_ADDRESS, '50000000'),
          createOutput(ANOTHER_EXTERNAL_ADDRESS, '10000', { index: 1 }),
          createOutput(USER_ADDRESS, '50000000', { index: 2 }),
        ],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const transferPosting = result.value[0]?.journals.find((journal) => journal.journalKind === 'transfer')
      ?.postings[0];
    expect(transferPosting?.quantity.toFixed()).toBe('1');
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
        quantity: '0.5',
      },
      {
        componentId: 'utxo:tx-multi-output-1:2',
        componentKind: 'utxo_output',
        quantity: '0.5',
      },
    ]);
  });

  test('uses expense_only only when the fee is the entire account effect', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-fee-only-1',
        inputs: [createInput(USER_ADDRESS, '50010000', { txid: 'prev-fee-only-1' })],
        outputs: [createOutput(USER_ADDRESS, '50000000')],
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.sourceActivity.fromAddress).toBe(USER_ADDRESS);
    expect(draft?.sourceActivity.toAddress).toBe(USER_ADDRESS);
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['expense_only']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-0.0001');
    expect(draft?.journals[0]?.postings[0]?.role).toBe('fee');
  });

  test('materializes wallet-scoped spends across sibling inputs', async () => {
    const result = await processTransactions(
      [
        createTransaction({
          id: 'tx-sibling-input-1',
          inputs: [
            createInput(USER_ADDRESS, '30000000', { txid: 'prev-sibling-a' }),
            createInput(SIBLING_USER_ADDRESS, '20010000', { txid: 'prev-sibling-b', vout: 1 }),
          ],
          outputs: [createOutput(EXTERNAL_ADDRESS, '50000000')],
        }),
      ],
      [USER_ADDRESS, SIBLING_USER_ADDRESS]
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('-0.5');
    expect(draft?.journals[0]?.postings[1]?.quantity.toFixed()).toBe('-0.0001');
    expect(
      draft?.journals[0]?.postings[0]?.sourceComponentRefs.map((ref) => ({
        componentId: ref.component.componentId,
        componentKind: ref.component.componentKind,
        quantity: ref.quantity.toFixed(),
      }))
    ).toEqual([
      {
        componentId: 'utxo:prev-sibling-a:0',
        componentKind: 'utxo_input',
        quantity: '0.3',
      },
      {
        componentId: 'utxo:prev-sibling-b:1',
        componentKind: 'utxo_input',
        quantity: '0.2001',
      },
    ]);
  });

  test('deduplicates repeated raw rows for the same wallet transaction', async () => {
    const sharedTransaction = createTransaction({
      id: 'tx-duplicate-wallet-row-1',
      inputs: [createInput(EXTERNAL_ADDRESS, '200010000', { txid: 'prev-duplicate-wallet-row-1' })],
      outputs: [createOutput(USER_ADDRESS, '200000000')],
    });
    const result = await processTransactions([sharedTransaction, sharedTransaction]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('2');
  });

  test('rejects wallet-owned inputs without stable UTXO identity', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-missing-input-identity-1',
        inputs: [createInput(USER_ADDRESS, '100010000', { txid: undefined })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '100000000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('missing previous txid');
  });

  test('rejects transactions outside the wallet address scope', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-outside-wallet-scope-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '100010000', { txid: 'prev-outside-wallet-scope-1' })],
        outputs: [createOutput(ANOTHER_EXTERNAL_ADDRESS, '100000000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('has no effect for the wallet address scope');
  });

  test('rejects negative normalized amounts before accounting math', async () => {
    const result = await processTransactions([
      createTransaction({
        id: 'tx-negative-amount-1',
        inputs: [createInput(USER_ADDRESS, '-100010000', { txid: 'prev-negative-amount-1' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '100000000')],
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('input amount must not be negative');
  });
});
