import { describe, expect, test } from 'vitest';

import type { RawExchangeProcessorInput } from '../../shared-v2/index.js';
import { buildKucoinCorrelationGroups } from '../build-correlation-groups.js';
import { KucoinCsvProcessor } from '../csv-processor.js';
import { interpretKucoinGroup } from '../interpret-group.js';
import { normalizeKucoinProviderEvent } from '../normalize-provider-event.js';
import type { CsvSpotOrderRow, KucoinCsvRow } from '../types.js';

import convertMarketFixture from './fixtures/csv-convert-market.json' with { type: 'json' };
import depositFixture from './fixtures/csv-deposit.json' with { type: 'json' };
import withdrawalFixture from './fixtures/csv-withdrawal.json' with { type: 'json' };
import unsupportedAccountHistoryFixture from './fixtures/unsupported-account-history-transfer.json' with { type: 'json' };

function buildEventId(row: KucoinCsvRow, index: number): string {
  if ('Hash' in row && row.Hash.trim().length > 0) {
    return row.Hash.trim();
  }

  if ('Order ID' in row) {
    return `${row['Order ID']}-${index}`;
  }

  return `KUCOIN_EVT_${index}`;
}

function toInputs(rows: KucoinCsvRow[]): RawExchangeProcessorInput<KucoinCsvRow>[] {
  return rows.map((row, index) => ({
    raw: row,
    eventId: buildEventId(row, index + 1),
  }));
}

describe('KucoinCsvProcessor', () => {
  test('normalizes spot order rows into provider-native trade events', () => {
    const spotOrder: CsvSpotOrderRow & { _rowType: 'spot_order' } = {
      _rowType: 'spot_order',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Order ID': 'ORDER001',
      'Order Time(UTC)': '2024-01-01 10:00:00',
      Symbol: 'BTC-USDT',
      Side: 'buy',
      'Order Type': 'limit',
      'Order Price': '42000.00',
      'Order Amount': '0.1',
      'Avg. Filled Price': '42000.00',
      'Filled Amount': '0.1',
      'Filled Volume': '4200.00',
      'Filled Volume (USDT)': '4200.00',
      'Filled Time(UTC)': '2024-01-01 10:01:00',
      Fee: '0.42',
      'Fee Currency': 'USDT',
      Status: 'deal',
    };

    const result = normalizeKucoinProviderEvent(spotOrder, 'KUCOIN_SPOT_001');

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value.providerType).toBe('spot_order');
    expect(result.value.providerHints.directionHint).toBe('credit');
    expect(result.value.providerHints.correlationKeys).toEqual(['KUCOIN_SPOT_001']);
    expect(result.value.assetSymbol).toBe('BTC');
    expect(result.value.rawAmount).toBe('0.1');
    expect(result.value.rawFee).toBe('0.42');
    expect(result.value.rawFeeCurrency).toBe('USDT');
  });

  test('interprets convert market account history groups as swaps', () => {
    const normalized = (convertMarketFixture as KucoinCsvRow[]).map((row, index) => {
      const result = normalizeKucoinProviderEvent(row, `KUCOIN_CONVERT_${index + 1}`);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        throw result.error;
      }
      return result.value;
    });

    const [group] = buildKucoinCorrelationGroups(normalized);
    expect(group).toBeDefined();
    if (!group) {
      return;
    }

    const interpretation = interpretKucoinGroup(group);
    expect(interpretation.kind).toBe('confirmed');
    if (interpretation.kind !== 'confirmed') {
      return;
    }

    expect(interpretation.draft.operation.category).toBe('trade');
    expect(interpretation.draft.operation.type).toBe('swap');
    expect(interpretation.draft.movements.outflows[0]?.assetSymbol).toBe('USDT');
    expect(interpretation.draft.movements.outflows[0]?.grossAmount).toBe('4200');
    expect(interpretation.draft.movements.inflows[0]?.assetSymbol).toBe('BTC');
    expect(interpretation.draft.movements.inflows[0]?.grossAmount).toBe('0.1');
  });

  test('processes fixture deposits', async () => {
    const processor = new KucoinCsvProcessor();

    const result = await processor.process(toInputs(depositFixture as KucoinCsvRow[]));

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
    expect(transaction.movements.inflows?.[0]?.assetSymbol).toBe('BTC');
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('1');
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.0005');
    expect(transaction.to).toBe('bc1qkucoinfixture0001');
  });

  test('processes fixture withdrawals', async () => {
    const processor = new KucoinCsvProcessor();

    const result = await processor.process(toInputs(withdrawalFixture as KucoinCsvRow[]));

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
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows?.[0]?.assetSymbol).toBe('ETH');
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('2');
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.01');
    expect(transaction.to).toBe('0xkucoinfixture0001');
  });

  test('processes fixture convert market pairs', async () => {
    const processor = new KucoinCsvProcessor();

    const result = await processor.process(toInputs(convertMarketFixture as KucoinCsvRow[]));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) {
      return;
    }

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');
    expect(transaction.movements.outflows?.[0]?.assetSymbol).toBe('USDT');
    expect(transaction.movements.outflows?.[0]?.grossAmount.toFixed()).toBe('4200');
    expect(transaction.movements.inflows?.[0]?.assetSymbol).toBe('BTC');
    expect(transaction.movements.inflows?.[0]?.grossAmount.toFixed()).toBe('0.1');
  });

  test('skips unsupported account history transfer rows without failing the batch', async () => {
    const processor = new KucoinCsvProcessor();

    const result = await processor.process(toInputs(unsupportedAccountHistoryFixture as KucoinCsvRow[]));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value).toHaveLength(0);
  });

  test('fails malformed rows instead of inventing transactions', async () => {
    const processor = new KucoinCsvProcessor();
    const malformedRow = {
      _rowType: 'spot_order',
      Symbol: 'BTC-USDT',
    } as unknown as KucoinCsvRow;

    const result = await processor.process([{ raw: malformedRow, eventId: 'MALFORMED_001' }]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.message).toContain('Missing KuCoin timestamp');
  });

  test('fails unknown row types explicitly', async () => {
    const processor = new KucoinCsvProcessor();
    const unknownRow = {
      _rowType: 'unknown_type',
      data: 'test',
    } as unknown as KucoinCsvRow;

    const result = await processor.process([{ raw: unknownRow, eventId: 'UNKNOWN_001' }]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.message).toContain('Unknown KuCoin row type');
  });

  test('processes mixed deposit and trade rows in one batch', async () => {
    const processor = new KucoinCsvProcessor();
    const spotOrder: CsvSpotOrderRow & { _rowType: 'spot_order' } = {
      _rowType: 'spot_order',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Order ID': 'ORDER004',
      'Order Time(UTC)': '2024-01-01 16:00:00',
      Symbol: 'BTC-USDT',
      Side: 'buy',
      'Order Type': 'limit',
      'Order Price': '40000.00',
      'Order Amount': '0.1',
      'Avg. Filled Price': '40000.00',
      'Filled Amount': '0.1',
      'Filled Volume': '4000.00',
      'Filled Volume (USDT)': '4000.00',
      'Filled Time(UTC)': '2024-01-01 16:01:00',
      Fee: '0.4',
      'Fee Currency': 'USDT',
      Status: 'deal',
    };

    const rows: KucoinCsvRow[] = [...(depositFixture as KucoinCsvRow[]), spotOrder];

    const result = await processor.process(toInputs(rows));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.operation.type).toBe('deposit');
    expect(result.value[1]?.operation.type).toBe('buy');
  });
});
