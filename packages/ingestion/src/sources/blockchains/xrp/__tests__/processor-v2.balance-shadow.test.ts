import {
  buildBalanceV2FromPostings,
  reconcileBalanceV2Shadow,
  type BalanceV2LegacyTransactionInput,
  type BalanceV2PostingInput,
} from '@exitbook/accounting/balance-v2';
import { getXrpChainConfig, type XrpTransaction } from '@exitbook/blockchain-providers/xrp';
import type { TransactionDraft } from '@exitbook/core';
import { assertOk } from '@exitbook/foundation/test-utils';
import {
  computeAccountingJournalFingerprint,
  computeAccountingPostingFingerprint,
  type AccountingJournalDraft,
} from '@exitbook/ledger';
import { describe, expect, test } from 'vitest';

import type { XrpLedgerDraft } from '../journal-assembler.js';
import { XrpProcessorV2 } from '../processor-v2.js';
import { XrpProcessor } from '../processor.js';

const ACCOUNT_ID = 42;
const ACCOUNT_FINGERPRINT = 'account:fingerprint:xrp-user';
const USER_ADDRESS = 'rN7n7otQDd6FczFgLdhmKRAWNZDy7g4EAZ';
const EXTERNAL_ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';

function getTestChainConfig() {
  const chainConfig = getXrpChainConfig('xrp');
  if (!chainConfig) {
    throw new Error('XRP chain config not found');
  }

  return chainConfig;
}

function createLegacyProcessor(): XrpProcessor {
  return new XrpProcessor(getTestChainConfig());
}

function createLedgerProcessor(): XrpProcessorV2 {
  return new XrpProcessorV2(getTestChainConfig());
}

function createTransaction(overrides: Partial<XrpTransaction> = {}): XrpTransaction {
  const id = overrides.id ?? 'xrp-default-hash';

  return {
    account: EXTERNAL_ADDRESS,
    currency: 'XRP',
    eventId: `${id}:event`,
    feeAmount: '0.000012',
    feeCurrency: 'XRP',
    id,
    ledgerIndex: 12_345_678,
    providerName: 'xrpl-rpc',
    sequence: 1,
    status: 'success',
    timestamp: 1_700_000_000_000,
    transactionType: 'Payment',
    ...overrides,
  };
}

async function reconcileLegacyBalanceScenario(normalizedData: XrpTransaction[]) {
  const legacyResult = await createLegacyProcessor().process(normalizedData, {
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

async function buildLedgerPostings(normalizedData: XrpTransaction[]): Promise<BalanceV2PostingInput[]> {
  const ledgerResult = await createLedgerProcessor().process(normalizedData, {
    account: {
      fingerprint: ACCOUNT_FINGERPRINT,
      id: ACCOUNT_ID,
    },
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
    walletAddresses: [USER_ADDRESS],
  });
  if (ledgerResult.isErr()) {
    throw ledgerResult.error;
  }

  return ledgerResult.value.flatMap(toBalanceV2PostingInputs);
}

async function buildLedgerBalanceSummary(normalizedData: XrpTransaction[]) {
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

function toBalanceV2PostingInputs(draft: XrpLedgerDraft): BalanceV2PostingInput[] {
  return draft.journals.flatMap((journal) => toJournalBalanceV2PostingInputs(draft, journal));
}

function toJournalBalanceV2PostingInputs(
  draft: XrpLedgerDraft,
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
      movementFingerprint: `legacy:xrp:${transactionIndex + 1}:fee:${feeIndex + 1}`,
    })),
    movements: {
      inflows: (draft.movements.inflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy:xrp:${transactionIndex + 1}:in:${movementIndex + 1}`,
      })),
      outflows: (draft.movements.outflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy:xrp:${transactionIndex + 1}:out:${movementIndex + 1}`,
      })),
    },
    txFingerprint: `legacy:xrp:${transactionIndex + 1}`,
  }));
}

describe('XrpProcessorV2 balance shadow reconciliation', () => {
  test('matches balance v1 for incoming XRP transfers', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '102',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
        destination: USER_ADDRESS,
        id: 'xrp-incoming',
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for outgoing XRP transfers and user-paid fees', async () => {
    const reconciliationResult = await reconcileLegacyBalanceScenario([
      createTransaction({
        account: USER_ADDRESS,
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '98',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
        destination: EXTERNAL_ADDRESS,
        id: 'xrp-outgoing',
      }),
    ]);

    expect(reconciliationResult.isOk()).toBe(true);
    if (reconciliationResult.isErr()) return;

    expect(reconciliationResult.value.diffs).toEqual([]);
  });

  test('matches balance v1 for failed fee-only XRP transactions', async () => {
    const balances = await buildLedgerBalanceSummary([
      createTransaction({
        account: USER_ADDRESS,
        balanceChanges: [
          {
            account: USER_ADDRESS,
            balance: '99.999988',
            currency: 'XRP',
            previousBalance: '100',
          },
        ],
        destination: EXTERNAL_ADDRESS,
        id: 'xrp-fee-only',
        status: 'failed',
      }),
    ]);

    expect(balances).toEqual([
      {
        accountId: ACCOUNT_ID,
        assetId: 'blockchain:xrp:native',
        assetSymbol: 'XRP',
        balanceCategory: 'liquid',
        quantity: '-0.000012',
      },
    ]);
  });
});
