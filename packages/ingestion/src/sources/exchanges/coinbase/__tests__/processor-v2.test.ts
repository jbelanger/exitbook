import {
  reconcileBalanceV2Shadow,
  type BalanceV2LegacyTransactionInput,
  type BalanceV2PostingInput,
} from '@exitbook/accounting/balance-v2';
import type { TransactionDraft } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers/coinbase';
import { describe, expect, test } from 'vitest';

import type { DeepPartial } from '../../../../shared/test-utils/index.js';
import type { AccountingLedgerDraft, AccountingLedgerProcessorContext } from '../../../../shared/types/processors.js';
import type { RawExchangeProcessorInput } from '../../shared/index.js';
import { CoinbaseProcessorV2 } from '../processor-v2.js';
import { CoinbaseProcessor } from '../processor.js';

import ambiguousSameAssetOpposingPair from './fixtures/ambiguous-same-asset-opposing-pair.json' with { type: 'json' };
import cleanDepositFixture from './fixtures/clean-deposit.json' with { type: 'json' };
import cleanSwapFixture from './fixtures/clean-swap.json' with { type: 'json' };
import cleanWithdrawalFixture from './fixtures/clean-withdrawal.json' with { type: 'json' };

const CREATED_AT = '2026-01-01T14:36:55.000Z';

const processorContext: AccountingLedgerProcessorContext = {
  account: {
    fingerprint: 'acct-fingerprint-coinbase',
    id: 77,
  },
  primaryAddress: 'coinbase',
  userAddresses: [],
  walletAddresses: [],
};

function buildEntry(
  overrides?: DeepPartial<RawCoinbaseLedgerEntry>
): RawExchangeProcessorInput<RawCoinbaseLedgerEntry> {
  const base: RawCoinbaseLedgerEntry = {
    id: 'entry-1',
    type: 'advanced_trade_fill',
    created_at: CREATED_AT,
    status: 'ok',
    amount: { amount: '100.00', currency: 'USDC' },
  };

  const raw = {
    ...base,
    ...(overrides || {}),
    amount: {
      ...base.amount,
      ...(overrides?.amount || {}),
    },
  } as RawCoinbaseLedgerEntry;

  return { raw, eventId: raw.id };
}

function toInputs(rows: RawCoinbaseLedgerEntry[]): RawExchangeProcessorInput<RawCoinbaseLedgerEntry>[] {
  return rows.map((row) => ({
    raw: row,
    eventId: row.id,
  }));
}

function ledgerDraftsToBalancePostings(drafts: readonly AccountingLedgerDraft[]): BalanceV2PostingInput[] {
  return drafts.flatMap((draft) =>
    draft.journals.flatMap((journal) =>
      journal.postings.map((posting) => ({
        accountId: draft.sourceActivity.ownerAccountId,
        assetId: posting.assetId,
        assetSymbol: posting.assetSymbol,
        balanceCategory: posting.balanceCategory,
        quantity: posting.quantity,
        sourceActivityFingerprint: journal.sourceActivityFingerprint,
      }))
    )
  );
}

function legacyDraftsToBalanceInputs(transactions: readonly TransactionDraft[]): BalanceV2LegacyTransactionInput[] {
  return transactions.map((transaction, transactionIndex) => ({
    accountId: processorContext.account.id,
    txFingerprint: `legacy-coinbase-${transactionIndex + 1}`,
    movements: {
      inflows: (transaction.movements.inflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy-coinbase-${transactionIndex + 1}:in:${movementIndex + 1}`,
      })),
      outflows: (transaction.movements.outflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy-coinbase-${transactionIndex + 1}:out:${movementIndex + 1}`,
      })),
    },
    fees: transaction.fees.map((fee, feeIndex) => ({
      ...fee,
      movementFingerprint: `legacy-coinbase-${transactionIndex + 1}:fee:${feeIndex + 1}`,
    })),
  }));
}

describe('CoinbaseProcessorV2', () => {
  test('emits a transfer journal for clean deposits with blockchain identity', async () => {
    const processor = new CoinbaseProcessorV2();

    const result = await processor.process(toInputs(cleanDepositFixture as RawCoinbaseLedgerEntry[]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toHaveLength(1);
    const [draft] = result.value;
    expect(draft?.sourceEventIds).toEqual(['CB_DEP_EVT_001']);
    expect(draft?.sourceActivity).toEqual(
      expect.objectContaining({
        ownerAccountId: 77,
        platformKind: 'exchange',
        platformKey: 'coinbase',
        sourceActivityOrigin: 'provider_event',
        sourceActivityStableKey: 'provider-event-group:CB_DEP_EVT_001',
        blockchainName: 'ethereum',
        blockchainTransactionHash: '0xcoinbasefixturedeposit0001',
        blockchainIsConfirmed: true,
      })
    );
    expect(draft?.journals).toHaveLength(1);
    expect(draft?.journals[0]?.journalKind).toBe('transfer');

    const [posting] = draft?.journals[0]?.postings ?? [];
    expect(posting).toEqual(
      expect.objectContaining({
        assetId: 'exchange:coinbase:eth',
        assetSymbol: 'ETH',
        balanceCategory: 'liquid',
        postingStableKey: 'movement:in:exchange:coinbase:eth:1',
        role: 'principal',
      })
    );
    expect(posting?.quantity.toFixed()).toBe('0.26');
    expect(posting?.sourceComponentRefs).toHaveLength(1);
    expect(posting?.sourceComponentRefs[0]?.component).toEqual({
      sourceActivityFingerprint: draft?.sourceActivity.sourceActivityFingerprint,
      componentKind: 'raw_event',
      componentId: 'CB_DEP_EVT_001',
      assetId: 'exchange:coinbase:eth',
    });
    expect(posting?.sourceComponentRefs[0]?.quantity.toFixed()).toBe('0.26');
  });

  test('emits withdrawal principal postings without double-counting embedded on-chain fees', async () => {
    const processor = new CoinbaseProcessorV2();

    const result = await processor.process(
      toInputs(cleanWithdrawalFixture as RawCoinbaseLedgerEntry[]),
      processorContext
    );

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const draft = result.value[0];
    expect(draft?.sourceActivity.toAddress).toBe('CB_SOL_DESTINATION_001');
    expect(draft?.sourceActivity.blockchainTransactionHash).toBe('CB_WITHDRAWAL_HASH_001');

    const postings = draft?.journals[0]?.postings ?? [];
    expect(postings).toHaveLength(1);

    const principal = postings.find((posting) => posting.role === 'principal');
    expect(principal?.assetId).toBe('exchange:coinbase:hnt');
    expect(principal?.quantity.toFixed()).toBe('-63.63644811');
    expect(principal?.sourceComponentRefs[0]?.component.componentKind).toBe('raw_event');
    expect(postings.some((posting) => posting.role === 'fee')).toBe(false);
  });

  test('emits trade postings and balance-settled fees for clean swaps', async () => {
    const processor = new CoinbaseProcessorV2();

    const result = await processor.process(toInputs(cleanSwapFixture as RawCoinbaseLedgerEntry[]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const journal = result.value[0]?.journals[0];
    expect(journal?.journalKind).toBe('trade');

    const postings = journal?.postings ?? [];
    expect(postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])).toEqual([
      ['ONDO', 'principal', '26.77'],
      ['USDC', 'principal', '-24.6843493'],
      ['USDC', 'fee', '-0.2962121916'],
    ]);
    expect(
      postings
        .filter((posting) => posting.role === 'principal')
        .map((posting) => posting.sourceComponentRefs[0]?.component.componentKind)
    ).toEqual(['exchange_fill', 'exchange_fill']);

    const fee = postings.find((posting) => posting.role === 'fee');
    expect(fee?.settlement).toBe('balance');
    expect(fee?.sourceComponentRefs[0]?.component).toEqual({
      sourceActivityFingerprint: result.value[0]?.sourceActivity.sourceActivityFingerprint,
      componentKind: 'exchange_fee',
      componentId: 'CB_SWAP_OUT_001',
      assetId: 'exchange:coinbase:usdc',
    });
  });

  test('emits staking reward journals for interest entries', async () => {
    const processor = new CoinbaseProcessorV2();
    const interestEntry = buildEntry({
      id: 'interest-1',
      type: 'interest',
      amount: { amount: '0.000798', currency: 'USDC' },
    });

    const result = await processor.process([interestEntry], processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const journal = result.value[0]?.journals[0];
    expect(journal?.journalKind).toBe('staking_reward');
    expect(journal?.postings[0]).toEqual(
      expect.objectContaining({
        assetId: 'exchange:coinbase:usdc',
        assetSymbol: 'USDC',
        balanceCategory: 'liquid',
        role: 'staking_reward',
      })
    );
    expect(journal?.postings[0]?.quantity.toFixed()).toBe('0.000798');
  });

  test('fails closed on ambiguous same-asset fixture pairs', async () => {
    const processor = new CoinbaseProcessorV2();

    const result = await processor.process(
      toInputs(ambiguousSameAssetOpposingPair as RawCoinbaseLedgerEntry[]),
      processorContext
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('ambiguous_same_asset_opposing_pair');
    }
  });

  test('matches legacy liquid balance impact for representative Coinbase groups', async () => {
    const inputs = [
      ...toInputs(cleanDepositFixture as RawCoinbaseLedgerEntry[]),
      ...toInputs(cleanWithdrawalFixture as RawCoinbaseLedgerEntry[]),
      ...toInputs(cleanSwapFixture as RawCoinbaseLedgerEntry[]),
      buildEntry({
        id: 'interest-1',
        type: 'interest',
        amount: { amount: '0.000798', currency: 'USDC' },
      }),
      buildEntry({
        id: 'subscription-1',
        type: 'subscription',
        amount: { amount: '-14.99', currency: 'CAD' },
      }),
      buildEntry({
        id: 'dust-conversion-1',
        type: 'retail_simple_dust',
        amount: { amount: '-0.005213665', currency: 'RLC' },
      }),
      buildEntry({
        id: 'fiat-withdrawal-1',
        type: 'fiat_withdrawal',
        amount: { amount: '-50', currency: 'USD' },
      }),
    ];
    const legacyProcessor = new CoinbaseProcessor();
    const ledgerProcessor = new CoinbaseProcessorV2();

    const legacyResult = await legacyProcessor.process(inputs);
    const ledgerResult = await ledgerProcessor.process(inputs, processorContext);

    expect(legacyResult.isOk(), legacyResult.isErr() ? legacyResult.error.message : '').toBe(true);
    expect(ledgerResult.isOk(), ledgerResult.isErr() ? ledgerResult.error.message : '').toBe(true);
    if (legacyResult.isErr() || ledgerResult.isErr()) {
      return;
    }

    const reconciliation = reconcileBalanceV2Shadow({
      legacyTransactions: legacyDraftsToBalanceInputs(legacyResult.value),
      ledgerPostings: ledgerDraftsToBalancePostings(ledgerResult.value),
    });

    expect(reconciliation.isOk(), reconciliation.isErr() ? reconciliation.error.message : '').toBe(true);
    if (reconciliation.isErr()) {
      return;
    }

    expect(reconciliation.value.diffs).toEqual([]);
  });
});
