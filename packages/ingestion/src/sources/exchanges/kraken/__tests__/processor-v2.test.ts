import {
  reconcileBalanceV2Shadow,
  type BalanceV2LegacyTransactionInput,
  type BalanceV2PostingInput,
} from '@exitbook/accounting/balance-v2';
import type { TransactionDraft } from '@exitbook/core';
import type { KrakenLedgerEntry } from '@exitbook/exchange-providers/kraken';
import { describe, expect, test } from 'vitest';

import type { AccountingLedgerDraft, BlockchainLedgerProcessorContext } from '../../../../shared/types/processors.js';
import type { RawExchangeProcessorInput } from '../../shared/index.js';
import { KrakenProcessorV2 } from '../processor-v2.js';
import { KrakenProcessor } from '../processor.js';

import cleanDeposit from './fixtures/clean-deposit.json' with { type: 'json' };
import cleanWithdrawal from './fixtures/clean-withdrawal.json' with { type: 'json' };
import netZeroTransferReversalPair from './fixtures/net-zero-transfer-reversal-pair.json' with { type: 'json' };

const dustSweepingRows: KrakenLedgerEntry[] = [
  {
    id: 'LI54ES-YRZMF-F2MYUQ',
    refid: 'TSDEF5I-HNFS4-PZQ2KE',
    time: 1701143946.764,
    type: 'receive',
    subtype: 'dustsweeping',
    aclass: 'currency',
    asset: 'ZCAD',
    amount: '0.2768',
    fee: '0.0080',
    balance: '0.2768',
  },
  {
    id: 'L2BSPZ-23EEJ-YO53ED',
    refid: 'TSDEF5I-HNFS4-PZQ2KE',
    time: 1701143946.764,
    type: 'spend',
    subtype: 'dustsweeping',
    aclass: 'currency',
    asset: 'XXBT',
    amount: '-0.0000055100',
    fee: '0.0000',
    balance: '0.0000',
  },
  {
    id: 'LSCF2I-ZNTRC-KOAGGB',
    refid: 'TSDEF5I-HNFS4-PZQ2KE',
    time: 1701143946.764,
    type: 'spend',
    subtype: 'dustsweeping',
    aclass: 'currency',
    asset: 'ADA',
    amount: '-0.00000004',
    fee: '0.0000',
    balance: '0.0000',
  },
];

const oneSidedTradeResidualRows: KrakenLedgerEntry[] = [
  {
    id: 'LWIIMJ-TWQFF-UHERBZ',
    refid: 'TQD4TY-AIRGW-GLNGLX',
    time: 1724424470.402445,
    type: 'trade',
    subtype: 'tradespot',
    aclass: 'currency',
    asset: 'FET',
    amount: '0.0000048800',
    fee: '0.0000000000',
    balance: '136.6244648800',
  },
];

const oneSidedTradeDebitRows: KrakenLedgerEntry[] = [
  {
    id: 'LWIIMJ-TWQFF-DEBIT',
    refid: 'TQD4TY-AIRGW-DEBIT',
    time: 1724424470.402445,
    type: 'trade',
    subtype: 'tradespot',
    aclass: 'currency',
    asset: 'FET',
    amount: '-0.0000048800',
    fee: '0.0000000000',
    balance: '136.6244600000',
  },
];

const processorContext: BlockchainLedgerProcessorContext = {
  account: {
    fingerprint: 'acct-fingerprint-kraken',
    id: 42,
  },
  primaryAddress: 'kraken',
  userAddresses: [],
  walletAddresses: [],
};

function toInputs(rows: KrakenLedgerEntry[]): RawExchangeProcessorInput<KrakenLedgerEntry>[] {
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
    txFingerprint: `legacy-kraken-${transactionIndex + 1}`,
    movements: {
      inflows: (transaction.movements.inflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy-kraken-${transactionIndex + 1}:in:${movementIndex + 1}`,
      })),
      outflows: (transaction.movements.outflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy-kraken-${transactionIndex + 1}:out:${movementIndex + 1}`,
      })),
    },
    fees: transaction.fees.map((fee, feeIndex) => ({
      ...fee,
      movementFingerprint: `legacy-kraken-${transactionIndex + 1}:fee:${feeIndex + 1}`,
    })),
  }));
}

describe('KrakenProcessorV2', () => {
  test('emits a transfer journal for clean deposits without blockchain identity', async () => {
    const processor = new KrakenProcessorV2();

    const result = await processor.process(toInputs(cleanDeposit as KrakenLedgerEntry[]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toHaveLength(1);
    const [draft] = result.value;
    expect(draft?.sourceEventIds).toEqual(['KRKN_EVT_DEPOSIT_SOL']);
    expect(draft?.sourceActivity).toEqual(
      expect.objectContaining({
        ownerAccountId: 42,
        platformKind: 'exchange',
        platformKey: 'kraken',
        sourceActivityOrigin: 'provider_event',
        sourceActivityStableKey: 'provider-event-group:KRKN_REF_DEPOSIT_SOL',
      })
    );
    expect(draft?.sourceActivity.blockchainTransactionHash).toBeUndefined();
    expect(draft?.journals).toHaveLength(1);
    expect(draft?.journals[0]?.journalKind).toBe('transfer');
    expect(draft?.journals[0]?.journalStableKey).toBe('primary');

    const [posting] = draft?.journals[0]?.postings ?? [];
    expect(posting).toEqual(
      expect.objectContaining({
        assetId: 'exchange:kraken:sol',
        assetSymbol: 'SOL',
        balanceCategory: 'liquid',
        postingStableKey: 'movement:in:exchange:kraken:sol:1',
        role: 'principal',
      })
    );
    expect(posting?.quantity.toFixed()).toBe('1.25');
    expect(posting?.sourceComponentRefs).toHaveLength(1);
    expect(posting?.sourceComponentRefs[0]?.component).toEqual({
      sourceActivityFingerprint: draft?.sourceActivity.sourceActivityFingerprint,
      componentKind: 'raw_event',
      componentId: 'KRKN_EVT_DEPOSIT_SOL',
      assetId: 'exchange:kraken:sol',
    });
    expect(posting?.sourceComponentRefs[0]?.quantity.toFixed()).toBe('1.25');
  });

  test('emits withdrawal principal and balance-settled fee postings', async () => {
    const processor = new KrakenProcessorV2();

    const result = await processor.process(toInputs(cleanWithdrawal as KrakenLedgerEntry[]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const postings = result.value[0]?.journals[0]?.postings ?? [];
    expect(postings).toHaveLength(2);

    const principal = postings.find((posting) => posting.role === 'principal');
    expect(principal?.assetId).toBe('exchange:kraken:ondo');
    expect(principal?.quantity.toFixed()).toBe('-634.3359');
    expect(principal?.sourceComponentRefs[0]?.component.componentKind).toBe('raw_event');

    const fee = postings.find((posting) => posting.role === 'fee');
    expect(fee?.assetId).toBe('exchange:kraken:ondo');
    expect(fee?.quantity.toFixed()).toBe('-2.668');
    expect(fee?.settlement).toBe('balance');
    expect(fee?.sourceComponentRefs[0]?.component.componentKind).toBe('exchange_fee');
    expect(fee?.sourceComponentRefs[0]?.component.componentId).toBe('KRKN_EVT_WITHDRAW_ONDO');
    expect(fee?.sourceComponentRefs[0]?.quantity.toFixed()).toBe('2.668');
  });

  test('emits trade postings and allocation diagnostics for dust sweeping', async () => {
    const processor = new KrakenProcessorV2();

    const result = await processor.process(toInputs(dustSweepingRows), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const journal = result.value[0]?.journals[0];
    expect(journal?.journalKind).toBe('trade');
    expect(journal?.diagnostics?.[0]?.code).toBe('allocation_uncertain');

    const postings = journal?.postings ?? [];
    expect(postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])).toEqual([
      ['CAD', 'principal', '0.2768'],
      ['BTC', 'principal', '-0.00000551'],
      ['ADA', 'principal', '-0.00000004'],
      ['CAD', 'fee', '-0.008'],
    ]);
    expect(
      postings
        .filter((posting) => posting.role === 'principal')
        .map((posting) => posting.sourceComponentRefs[0]?.component.componentKind)
    ).toEqual(['exchange_fill', 'exchange_fill', 'exchange_fill']);
  });

  test('skips net-zero transfer reversal pairs without ledger materialization', async () => {
    const processor = new KrakenProcessorV2();

    const result = await processor.process(
      toInputs(netZeroTransferReversalPair as KrakenLedgerEntry[]),
      processorContext
    );

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual([]);
  });

  test('represents positive one-sided trade residuals as refund/rebate journals', async () => {
    const processor = new KrakenProcessorV2();

    const result = await processor.process(toInputs(oneSidedTradeResidualRows), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const journal = result.value[0]?.journals[0];
    expect(journal?.journalKind).toBe('refund_rebate');
    expect(journal?.postings[0]?.role).toBe('refund_rebate');
    expect(journal?.postings[0]?.quantity.toFixed()).toBe('0.00000488');
    expect(journal?.postings[0]?.sourceComponentRefs[0]?.component.componentKind).toBe('exchange_fill');
  });

  test('matches legacy liquid balance impact for representative Kraken groups', async () => {
    const inputs = toInputs([
      ...(cleanDeposit as KrakenLedgerEntry[]),
      ...(cleanWithdrawal as KrakenLedgerEntry[]),
      ...dustSweepingRows,
      ...(netZeroTransferReversalPair as KrakenLedgerEntry[]),
      ...oneSidedTradeResidualRows,
    ]);
    const legacyProcessor = new KrakenProcessor();
    const ledgerProcessor = new KrakenProcessorV2();

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

  test('fails closed when a one-sided trade residual is a negative refund/rebate', async () => {
    const processor = new KrakenProcessorV2();

    const result = await processor.process(toInputs(oneSidedTradeDebitRows), processorContext);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('refund_rebate');
      expect(result.error.message).toContain('must be positive');
    }
  });
});
