import type { KrakenLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import type { RawExchangeProcessorInput } from '../../shared-v2/index.js';
import { buildKrakenCorrelationGroups } from '../build-correlation-groups.js';
import { interpretKrakenGroup } from '../interpret-group.js';
import { normalizeKrakenProviderEvent } from '../normalize-provider-event.js';
import { KrakenProcessor } from '../processor.js';

import ambiguousSameAssetOpposingPair from './fixtures/ambiguous-same-asset-opposing-pair.json' with { type: 'json' };
import cleanDeposit from './fixtures/clean-deposit.json' with { type: 'json' };
import cleanWithdrawal from './fixtures/clean-withdrawal.json' with { type: 'json' };

function toInputs(rows: KrakenLedgerEntry[]): RawExchangeProcessorInput<KrakenLedgerEntry>[] {
  return rows.map((row) => ({
    raw: row,
    eventId: row.id,
  }));
}

describe('KrakenProcessor', () => {
  test('returns an explicit ambiguity diagnostic for same-asset opposing pairs', () => {
    const normalized = (ambiguousSameAssetOpposingPair as KrakenLedgerEntry[]).map((row) => {
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
    expect(interpretation.kind).toBe('ambiguous');
    if (interpretation.kind !== 'ambiguous') {
      return;
    }

    expect(interpretation.diagnostic.code).toBe('ambiguous_same_asset_opposing_pair');
    expect(interpretation.diagnostic.providerEventIds).toEqual(['KRKN_EVT_AKT_OUT', 'KRKN_EVT_AKT_IN']);
  });

  test('fails closed for ambiguous same-asset opposing pairs', async () => {
    const processor = new KrakenProcessor();

    const result = await processor.process(toInputs(ambiguousSameAssetOpposingPair as KrakenLedgerEntry[]));

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('ambiguous_same_asset_opposing_pair');
    expect(result.error.message).toContain('KRKN_REF_AMBIG_AKT');
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
