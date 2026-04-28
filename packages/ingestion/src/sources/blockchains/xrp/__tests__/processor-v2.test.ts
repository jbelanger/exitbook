import { getXrpChainConfig, type XrpTransaction } from '@exitbook/blockchain-providers/xrp';
import type { Result } from '@exitbook/foundation';
import type { AccountingPostingDraft } from '@exitbook/ledger';
import { describe, expect, test } from 'vitest';

import type { XrpLedgerDraft } from '../journal-assembler.js';
import { XrpProcessorV2 } from '../processor-v2.js';

const ACCOUNT_ID = 42;
const ACCOUNT_FINGERPRINT = 'account:fingerprint:xrp-user';
const USER_ADDRESS = 'rN7n7otQDd6FczFgLdhmKRAWNZDy7g4EAZ';
const EXTERNAL_ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';

const PROCESSOR_CONTEXT = {
  account: {
    fingerprint: ACCOUNT_FINGERPRINT,
    id: ACCOUNT_ID,
  },
  primaryAddress: USER_ADDRESS,
  userAddresses: [USER_ADDRESS],
  walletAddresses: [USER_ADDRESS],
};

function expectOk<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw result.error;
  }
  return result.value;
}

function createProcessor(): XrpProcessorV2 {
  const chainConfig = getXrpChainConfig('xrp');
  if (!chainConfig) {
    throw new Error('XRP chain config not found');
  }

  return new XrpProcessorV2(chainConfig);
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

async function processOne(transaction: XrpTransaction): Promise<XrpLedgerDraft> {
  const drafts = expectOk(await createProcessor().process([transaction], PROCESSOR_CONTEXT));
  expect(drafts).toHaveLength(1);
  return drafts[0]!;
}

function postings(draft: XrpLedgerDraft): AccountingPostingDraft[] {
  return draft.journals.flatMap((journal) => journal.postings);
}

describe('XrpProcessorV2', () => {
  test('emits incoming XRP transfers as liquid principal', async () => {
    const draft = await processOne(
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
      })
    );

    expect(draft.sourceActivity).toMatchObject({
      blockchainBlockHeight: 12_345_678,
      blockchainName: 'xrp',
      blockchainTransactionHash: 'xrp-incoming',
      ownerAccountId: ACCOUNT_ID,
      platformKey: 'xrp',
      sourceActivityStableKey: 'xrp-incoming',
    });
    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer', journalStableKey: 'transfer' });
    expect(
      postings(draft).map((posting) => [
        posting.role,
        posting.balanceCategory,
        posting.quantity.toFixed(),
        posting.settlement,
      ])
    ).toEqual([['principal', 'liquid', '2', undefined]]);
    expect(postings(draft)[0]?.assetId).toBe('blockchain:xrp:native');
  });

  test('splits outgoing XRP balance deltas into principal and balance-settled network fee', async () => {
    const draft = await processOne(
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
        feeAmount: '0.000012',
        id: 'xrp-outgoing',
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer', journalStableKey: 'transfer' });
    expect(
      postings(draft).map((posting) => [
        posting.role,
        posting.balanceCategory,
        posting.quantity.toFixed(),
        posting.settlement,
        posting.sourceComponentRefs[0]?.component.componentKind,
      ])
    ).toEqual([
      ['principal', 'liquid', '-1.999988', undefined, 'account_delta'],
      ['fee', 'liquid', '-0.000012', 'balance', 'network_fee'],
    ]);
  });

  test('emits fee-only XRP balance changes as expense-only journals', async () => {
    const draft = await processOne(
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
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'expense_only', journalStableKey: 'network_fee' });
    expect(postings(draft).map((posting) => [posting.role, posting.quantity.toFixed(), posting.settlement])).toEqual([
      ['fee', '-0.000012', 'balance'],
    ]);
  });

  test('skips XRP transactions with no wallet balance effect', async () => {
    const drafts = expectOk(
      await createProcessor().process(
        [
          createTransaction({
            balanceChanges: [
              {
                account: EXTERNAL_ADDRESS,
                balance: '100',
                currency: 'XRP',
                previousBalance: '100.000012',
              },
            ],
            id: 'xrp-external-only',
            transactionType: 'AccountSet',
          }),
        ],
        PROCESSOR_CONTEXT
      )
    );

    expect(drafts).toEqual([]);
  });
});
