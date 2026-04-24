import {
  buildBalanceV2FromPostings,
  reconcileBalanceV2Shadow,
  type BalanceV2PostingInput,
} from '@exitbook/accounting/balance-v2';
import { getBitcoinChainConfig, type BitcoinTransaction } from '@exitbook/blockchain-providers/bitcoin';
import { assertOk } from '@exitbook/foundation/test-utils';
import {
  computeAccountingJournalFingerprint,
  computeAccountingPostingFingerprint,
  type AccountingJournalDraft,
} from '@exitbook/ledger';
import { describe, expect, test } from 'vitest';

import { type BitcoinLedgerDraft } from '../journal-assembler.js';
import { BitcoinProcessorV2 } from '../processor-v2.js';
import { BitcoinProcessor } from '../processor.js';

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

function getTestChainConfig() {
  const chainConfig = getBitcoinChainConfig('bitcoin');
  if (!chainConfig) {
    throw new Error('Bitcoin chain config not found');
  }

  return chainConfig;
}

function createLegacyProcessor() {
  return new BitcoinProcessor(getTestChainConfig());
}

function createLedgerProcessor() {
  return new BitcoinProcessorV2(getTestChainConfig());
}

async function reconcileLegacyBalanceScenario(normalizedData: BitcoinTransaction[]) {
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
  normalizedData: BitcoinTransaction[],
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

async function buildLedgerBalanceSummary(normalizedData: BitcoinTransaction[], walletAddresses: string[]) {
  const ledgerPostings = await buildLedgerPostings(normalizedData, walletAddresses);
  const balanceResult = assertOk(buildBalanceV2FromPostings(ledgerPostings));

  return balanceResult.balances.map((balance) => ({
    accountId: balance.accountId,
    assetId: balance.assetId,
    assetSymbol: balance.assetSymbol,
    quantity: balance.quantity.toFixed(),
  }));
}

function toBalanceV2PostingInputs(draft: BitcoinLedgerDraft): BalanceV2PostingInput[] {
  return draft.journals.flatMap((journal) => toJournalBalanceV2PostingInputs(draft, journal));
}

function toJournalBalanceV2PostingInputs(
  draft: BitcoinLedgerDraft,
  journal: AccountingJournalDraft
): BalanceV2PostingInput[] {
  const journalFingerprint = assertOk(computeAccountingJournalFingerprint(journal));

  return journal.postings.map((posting) => ({
    accountId: draft.sourceActivity.ownerAccountId,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    quantity: posting.quantity,
    journalFingerprint,
    postingFingerprint: assertOk(computeAccountingPostingFingerprint(journalFingerprint, posting)),
    sourceActivityFingerprint: draft.sourceActivity.sourceActivityFingerprint,
  }));
}

function createMultiSourceExternalSendTransaction(): BitcoinTransaction {
  return createTransaction({
    id: 'tx-multi-source-external-send-1',
    inputs: [
      createInput(USER_ADDRESS, '100000000', { txid: 'prev-source-a' }),
      createInput(SIBLING_USER_ADDRESS, '200000000', {
        txid: 'prev-source-b',
        vout: 1,
      }),
      createInput(THIRD_USER_ADDRESS, '300010000', {
        txid: 'prev-source-c',
        vout: 2,
      }),
    ],
    outputs: [createOutput(EXTERNAL_ADDRESS, '600000000')],
  });
}

describe('BitcoinProcessorV2 balance shadow reconciliation', () => {
  test('matches balance v1 for incoming transfers', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        id: 'tx-incoming-1',
        inputs: [createInput(EXTERNAL_ADDRESS, '200010000', { txid: 'prev-incoming-1' })],
        outputs: [createOutput(USER_ADDRESS, '200000000')],
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('documents that balance v1 double-counts change outputs on sends', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        id: 'tx-change-1',
        inputs: [createInput(USER_ADDRESS, '100010000', { txid: 'prev-change-1' })],
        outputs: [createOutput(EXTERNAL_ADDRESS, '30000000'), createOutput(USER_ADDRESS, '70000000', { index: 1 })],
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(
      reconciliationResult.value.diffs.map((diff) => ({
        delta: diff.delta.toFixed(),
        ledgerQuantity: diff.ledgerQuantity.toFixed(),
        legacyQuantity: diff.legacyQuantity.toFixed(),
      }))
    ).toEqual([
      {
        delta: '-0.7',
        ledgerQuantity: '-0.3001',
        legacyQuantity: '0.3999',
      },
    ]);
  });

  test('documents that balance v1 double-counts self-change on fee-only effects', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        id: 'tx-fee-only-1',
        inputs: [createInput(USER_ADDRESS, '50010000', { txid: 'prev-fee-only-1' })],
        outputs: [createOutput(USER_ADDRESS, '50000000')],
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(
      reconciliationResult.value.diffs.map((diff) => ({
        delta: diff.delta.toFixed(),
        ledgerQuantity: diff.ledgerQuantity.toFixed(),
        legacyQuantity: diff.legacyQuantity.toFixed(),
      }))
    ).toEqual([
      {
        delta: '-0.5',
        ledgerQuantity: '-0.0001',
        legacyQuantity: '0.4999',
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
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        quantity: '-6.0001',
      },
    ]);
  });
});
