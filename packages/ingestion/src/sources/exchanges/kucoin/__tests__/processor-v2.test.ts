import {
  reconcileBalanceV2Shadow,
  type BalanceV2LegacyTransactionInput,
  type BalanceV2PostingInput,
} from '@exitbook/accounting/balance-v2';
import type { TransactionDraft } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import type { AccountingLedgerDraft, AccountingLedgerProcessorContext } from '../../../../shared/types/processors.js';
import type { RawExchangeProcessorInput } from '../../shared/index.js';
import { KuCoinProcessorV2 } from '../processor-v2.js';
import { KuCoinCsvProcessor } from '../processor.js';
import type { CsvDepositWithdrawalRow, CsvSpotOrderRow, KuCoinCsvRow } from '../types.js';

import convertMarketFixture from './fixtures/csv-convert-market.json' with { type: 'json' };
import depositFixture from './fixtures/csv-deposit.json' with { type: 'json' };
import withdrawalFixture from './fixtures/csv-withdrawal.json' with { type: 'json' };
import unsupportedAccountHistoryFixture from './fixtures/unsupported-account-history-transfer.json' with { type: 'json' };

const processorContext: AccountingLedgerProcessorContext = {
  account: {
    fingerprint: 'acct-fingerprint-kucoin',
    id: 88,
  },
  primaryAddress: 'kucoin',
  userAddresses: [],
  walletAddresses: [],
};

const spotOrderRow: CsvSpotOrderRow & { _rowType: 'spot_order' } = {
  _rowType: 'spot_order',
  UID: 'kucoin-user-spot',
  'Account Type': 'Trading Account',
  'Order ID': 'KUCOIN_ORDER_001',
  'Order Time(UTC)': '2024-01-01 16:00:00',
  Symbol: 'BTC-USDT',
  Side: 'buy',
  'Order Type': 'limit',
  'Order Price': '42000.00',
  'Order Amount': '0.1',
  'Avg. Filled Price': '42000.00',
  'Filled Amount': '0.1',
  'Filled Volume': '4200.00',
  'Filled Volume (USDT)': '4200.00',
  'Filled Time(UTC)': '2024-01-01 16:01:00',
  Fee: '0.42',
  'Fee Currency': 'USDT',
  Status: 'deal',
};

const zeroFeeWithdrawalRow: CsvDepositWithdrawalRow & { _rowType: 'withdrawal' } = {
  _rowType: 'withdrawal',
  UID: 'kucoin-user-zero-fee',
  'Account Type': 'Funding Account',
  Coin: 'USDT',
  Amount: '0.05476105',
  Fee: '0',
  'Time(UTC)': '2024-01-02 09:00:00',
  'Transfer Network': 'KCC',
  Status: 'success',
  Hash: 'KUCOIN_ZERO_FEE_WITHDRAWAL_HASH_001',
  'Withdrawal Address/Account': '0xkucoinzerofee0001',
  Remarks: 'fixture zero fee withdrawal',
};

function buildEventId(row: KuCoinCsvRow, index: number): string {
  if ('Hash' in row && row.Hash.trim().length > 0) {
    return row.Hash.trim();
  }

  if ('Order ID' in row) {
    return `${row['Order ID']}-${index}`;
  }

  return `KUCOIN_EVT_${index}`;
}

function toInputs(rows: KuCoinCsvRow[]): RawExchangeProcessorInput<KuCoinCsvRow>[] {
  return rows.map((row, index) => ({
    raw: row,
    eventId: buildEventId(row, index + 1),
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
    txFingerprint: `legacy-kucoin-${transactionIndex + 1}`,
    movements: {
      inflows: (transaction.movements.inflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy-kucoin-${transactionIndex + 1}:in:${movementIndex + 1}`,
      })),
      outflows: (transaction.movements.outflows ?? []).map((movement, movementIndex) => ({
        ...movement,
        movementFingerprint: `legacy-kucoin-${transactionIndex + 1}:out:${movementIndex + 1}`,
      })),
    },
    fees: transaction.fees.map((fee, feeIndex) => ({
      ...fee,
      movementFingerprint: `legacy-kucoin-${transactionIndex + 1}:fee:${feeIndex + 1}`,
    })),
  }));
}

describe('KuCoinProcessorV2', () => {
  test('emits a transfer journal for CSV deposits with exchange-scoped asset identity', async () => {
    const processor = new KuCoinProcessorV2();

    const result = await processor.process(toInputs(depositFixture as KuCoinCsvRow[]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const draft = result.value[0];
    expect(draft?.sourceActivity).toEqual(
      expect.objectContaining({
        ownerAccountId: 88,
        platformKind: 'exchange',
        platformKey: 'kucoin',
        sourceActivityOrigin: 'provider_event',
        sourceActivityStableKey: 'provider-event-group:KUCOIN_DEPOSIT_HASH_001',
        blockchainName: 'BTC',
        blockchainTransactionHash: 'KUCOIN_DEPOSIT_HASH_001',
        blockchainIsConfirmed: true,
        toAddress: 'bc1qkucoinfixture0001',
      })
    );

    const journal = draft?.journals[0];
    expect(journal?.journalKind).toBe('transfer');
    expect(journal?.diagnostics?.[0]?.code).toBe('exchange_deposit_address_credit');

    const postings = journal?.postings ?? [];
    expect(postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])).toEqual([
      ['BTC', 'principal', '1'],
      ['BTC', 'fee', '-0.0005'],
    ]);
    expect(postings[0]?.sourceComponentRefs[0]?.component).toEqual({
      sourceActivityFingerprint: draft?.sourceActivity.sourceActivityFingerprint,
      componentKind: 'raw_event',
      componentId: 'KUCOIN_DEPOSIT_HASH_001',
      assetId: 'exchange:kucoin:btc',
    });
  });

  test('emits withdrawal principal and fee postings from positive CSV amount rows', async () => {
    const processor = new KuCoinProcessorV2();

    const result = await processor.process(toInputs(withdrawalFixture as KuCoinCsvRow[]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const journal = result.value[0]?.journals[0];
    expect(journal?.journalKind).toBe('transfer');

    const postings = journal?.postings ?? [];
    expect(postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])).toEqual([
      ['ETH', 'principal', '-2'],
      ['ETH', 'fee', '-0.01'],
    ]);
    expect(postings[0]?.sourceComponentRefs[0]?.component).toEqual({
      sourceActivityFingerprint: result.value[0]?.sourceActivity.sourceActivityFingerprint,
      componentKind: 'raw_event',
      componentId: 'KUCOIN_WITHDRAWAL_HASH_001',
      assetId: 'exchange:kucoin:eth',
    });
  });

  test('does not materialize zero-fee CSV withdrawals as fee postings', async () => {
    const processor = new KuCoinProcessorV2();

    const result = await processor.process(toInputs([zeroFeeWithdrawalRow]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const postings = result.value[0]?.journals[0]?.postings ?? [];
    expect(postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])).toEqual([
      ['USDT', 'principal', '-0.05476105'],
    ]);
  });

  test('emits a trade journal for convert market account-history pairs', async () => {
    const processor = new KuCoinProcessorV2();

    const result = await processor.process(toInputs(convertMarketFixture as KuCoinCsvRow[]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const journal = result.value[0]?.journals[0];
    expect(journal?.journalKind).toBe('trade');
    expect(journal?.postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])).toEqual(
      [
        ['BTC', 'principal', '0.1'],
        ['USDT', 'principal', '-4200'],
      ]
    );
    expect(journal?.postings.map((posting) => posting.sourceComponentRefs[0]?.component.componentKind)).toEqual([
      'exchange_fill',
      'exchange_fill',
    ]);
  });

  test('emits trade postings from one-row spot order fills', async () => {
    const processor = new KuCoinProcessorV2();

    const result = await processor.process(toInputs([spotOrderRow]), processorContext);

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    const journal = result.value[0]?.journals[0];
    expect(journal?.journalKind).toBe('trade');

    const postings = journal?.postings ?? [];
    expect(postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])).toEqual([
      ['BTC', 'principal', '0.1'],
      ['USDT', 'principal', '-4200'],
      ['USDT', 'fee', '-0.42'],
    ]);
    expect(postings[0]?.sourceComponentRefs[0]?.quantity.toFixed()).toBe('0.1');
    expect(postings[1]?.sourceComponentRefs[0]?.quantity.toFixed()).toBe('4200');
    expect(postings[0]?.sourceComponentRefs[0]?.component.componentId).toBe('KUCOIN_ORDER_001-1');
    expect(postings[1]?.sourceComponentRefs[0]?.component.componentId).toBe('KUCOIN_ORDER_001-1');
  });

  test('skips internal account-history transfer rows without ledger materialization', async () => {
    const processor = new KuCoinProcessorV2();

    const result = await processor.process(
      toInputs(unsupportedAccountHistoryFixture as KuCoinCsvRow[]),
      processorContext
    );

    expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual([]);
  });

  test('matches legacy liquid balance impact for representative KuCoin groups', async () => {
    const inputs = toInputs([
      ...(depositFixture as KuCoinCsvRow[]),
      ...(withdrawalFixture as KuCoinCsvRow[]),
      ...(convertMarketFixture as KuCoinCsvRow[]),
      spotOrderRow,
      ...(unsupportedAccountHistoryFixture as KuCoinCsvRow[]),
    ]);
    const legacyProcessor = new KuCoinCsvProcessor();
    const ledgerProcessor = new KuCoinProcessorV2();

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

  test('fails malformed rows during v2 input validation', async () => {
    const processor = new KuCoinProcessorV2();
    const malformedRow = {
      _rowType: 'spot_order',
      Symbol: 'BTC-USDT',
    } as unknown as KuCoinCsvRow;

    const result = await processor.process([{ raw: malformedRow, eventId: 'MALFORMED_001' }], processorContext);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Input validation failed for KuCoin ledger-v2');
    }
  });
});
