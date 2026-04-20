import type { KrakenLedgerEntry } from '@exitbook/exchange-providers/kraken';
import { describe, expect, test } from 'vitest';

import type { RawExchangeProcessorInput } from '../../shared/index.js';
import { buildKrakenCorrelationGroups } from '../build-correlation-groups.js';
import { interpretKrakenGroup } from '../interpret-group.js';
import { normalizeKrakenProviderEvent } from '../normalize-provider-event.js';
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

const spotFromFuturesRows: KrakenLedgerEntry[] = [
  {
    id: 'L25WNO-RENDER-CREDIT',
    refid: 'FTdKhdH-enbSfxp0lc676Z4aLTJnDB',
    time: 1722931200,
    type: 'transfer',
    subtype: 'spotfromfutures',
    aclass: 'currency',
    asset: 'RENDER',
    amount: '64.987572',
    fee: '0.0000000000',
    balance: '64.987572',
  },
  {
    id: 'L7VTO3-NOLKA-FYOGLE',
    refid: 'FTdKhdH-enbSfxp0lc676Z4aLTJnDB',
    time: 1723743994.970638,
    type: 'transfer',
    subtype: 'spotfromfutures',
    aclass: 'currency',
    asset: 'RNDR',
    amount: '-64.9875728700',
    fee: '0.0000000000',
    balance: '0.0000000000',
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

function toInputs(rows: KrakenLedgerEntry[]): RawExchangeProcessorInput<KrakenLedgerEntry>[] {
  return rows.map((row) => ({
    raw: row,
    eventId: row.id,
  }));
}

describe('KrakenProcessor', () => {
  test('returns a warning diagnostic for net-zero transfer reversal pairs', () => {
    const normalized = (netZeroTransferReversalPair as KrakenLedgerEntry[]).map((row) => {
      const result = normalizeKrakenProviderEvent(row, row.id);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        throw result.error;
      }
      return result.value;
    });

    const [group] = buildKrakenCorrelationGroups(normalized);
    expect(group).toBeDefined();
    if (!group) {
      return;
    }

    const interpretation = interpretKrakenGroup(group);
    expect(interpretation.kind).toBe('unsupported');
    if (interpretation.kind !== 'unsupported') {
      return;
    }

    expect(interpretation.diagnostic.code).toBe('provider_reversal_pair');
    expect(interpretation.diagnostic.severity).toBe('warning');
    expect(interpretation.diagnostic.evidence['nettedToZero']).toBe(true);
    expect(interpretation.diagnostic.providerEventIds).toEqual(['KRKN_EVT_AKT_OUT', 'KRKN_EVT_AKT_IN']);
  });

  test('skips net-zero transfer reversal pairs without failing the batch', async () => {
    const processor = new KrakenProcessor();

    const result = await processor.process(toInputs(netZeroTransferReversalPair as KrakenLedgerEntry[]));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value).toEqual([]);
  });

  test('processes clean deposits', async () => {
    const processor = new KrakenProcessor();

    const result = await processor.process(toInputs(cleanDeposit as KrakenLedgerEntry[]));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) {
      return;
    }

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.movements.inflows?.[0]?.assetSymbol).toBe('SOL');
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('1.25');
  });

  test('processes clean withdrawals with fees', async () => {
    const processor = new KrakenProcessor();

    const result = await processor.process(toInputs(cleanWithdrawal as KrakenLedgerEntry[]));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) {
      return;
    }

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.assetSymbol).toBe('ONDO');
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('634.3359');
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('2.668');
    expect(transaction.fees[0]?.assetSymbol).toBe('ONDO');
  });

  test('classifies dustsweeping as a swap with allocation warning instead of transfer fallback', async () => {
    const processor = new KrakenProcessor();

    const result = await processor.process(toInputs(dustSweepingRows));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) {
      return;
    }

    expect(transaction.operation).toEqual({ category: 'trade', type: 'swap' });
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(2);
    expect(transaction.diagnostics?.[0]?.code).toBe('allocation_uncertain');
    expect(transaction.diagnostics?.[0]?.message).toContain('dust conversion');
    expect(transaction.diagnostics?.[0]?.message).toContain('exact per-asset proceeds allocation');
    expect(transaction.fees[0]?.assetSymbol).toBe('CAD');
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.008');
  });

  test('correlates spotfromfutures rows by event id while keeping shared migration evidence', () => {
    const normalized = spotFromFuturesRows.map((row) => {
      const result = normalizeKrakenProviderEvent(row, row.id);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        throw result.error;
      }
      return result.value;
    });

    const groups = buildKrakenCorrelationGroups(normalized);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.correlationKey)).toEqual(['L25WNO-RENDER-CREDIT', 'L7VTO3-NOLKA-FYOGLE']);

    for (const group of groups) {
      expect(group.evidence.sharedKeys).toContain('FTdKhdH-enbSfxp0lc676Z4aLTJnDB');

      const interpretation = interpretKrakenGroup(group);
      expect(interpretation.kind).toBe('confirmed');
      if (interpretation.kind !== 'confirmed') {
        continue;
      }

      expect(interpretation.draft.diagnostics?.[0]?.code).toBe('possible_asset_migration');
      expect(interpretation.draft.diagnostics?.[0]?.metadata?.['migrationGroupKey']).toBe(
        'FTdKhdH-enbSfxp0lc676Z4aLTJnDB'
      );
      expect(interpretation.draft.diagnostics?.[0]?.metadata?.['providerSubtype']).toBe('spotfromfutures');
    }
  });

  test('materializes spotfromfutures rows into migration-marked transfer legs', async () => {
    const processor = new KrakenProcessor();

    const result = await processor.process(toInputs(spotFromFuturesRows));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value).toHaveLength(2);

    const renderCredit = result.value.find(
      (transaction) =>
        transaction.movements.inflows?.[0]?.assetSymbol === 'RENDER' &&
        (transaction.movements.outflows?.length ?? 0) === 0
    );
    const rndrDebit = result.value.find(
      (transaction) =>
        transaction.movements.outflows?.[0]?.assetSymbol === 'RNDR' &&
        (transaction.movements.inflows?.length ?? 0) === 0
    );

    expect(renderCredit?.diagnostics?.[0]?.code).toBe('possible_asset_migration');
    expect(renderCredit?.operation).toEqual({ category: 'transfer', type: 'deposit' });
    expect(renderCredit?.diagnostics?.[0]?.metadata?.['migrationGroupKey']).toBe('FTdKhdH-enbSfxp0lc676Z4aLTJnDB');

    expect(rndrDebit?.diagnostics?.[0]?.code).toBe('possible_asset_migration');
    expect(rndrDebit?.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
    expect(rndrDebit?.diagnostics?.[0]?.metadata?.['migrationGroupKey']).toBe('FTdKhdH-enbSfxp0lc676Z4aLTJnDB');
  });

  test('classifies one-sided trade rows as non-transfer trade residuals with refund/rebate context', async () => {
    const processor = new KrakenProcessor();

    const result = await processor.process(toInputs(oneSidedTradeResidualRows));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) {
      return;
    }

    expect(transaction.operation).toEqual({ category: 'trade', type: 'buy' });
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.movements.inflows?.[0]?.movementRole).toBe('refund_rebate');
    expect(transaction.diagnostics?.[0]?.code).toBe('classification_uncertain');
    expect(transaction.diagnostics?.[0]?.message).toContain('non-transfer trade residual');
    expect(transaction.diagnostics?.[0]?.metadata?.['providerSubtype']).toBe('tradespot');
    expect(transaction.diagnostics?.[0]?.metadata?.['residualRole']).toBe('refund_rebate');
  });
});
