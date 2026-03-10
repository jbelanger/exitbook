import type { KrakenLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import type { RawExchangeProcessorInput } from '../../shared/index.js';
import { buildKrakenCorrelationGroups } from '../build-correlation-groups.js';
import { interpretKrakenGroup } from '../interpret-group.js';
import { normalizeKrakenProviderEvent } from '../normalize-provider-event.js';
import { KrakenProcessor } from '../processor.js';

import cleanDeposit from './fixtures/clean-deposit.json' with { type: 'json' };
import cleanWithdrawal from './fixtures/clean-withdrawal.json' with { type: 'json' };
import netZeroTransferReversalPair from './fixtures/net-zero-transfer-reversal-pair.json' with { type: 'json' };

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
});
