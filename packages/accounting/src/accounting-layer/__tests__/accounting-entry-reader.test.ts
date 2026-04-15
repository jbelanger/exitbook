import { ok, parseDecimal } from '@exitbook/foundation';
import type { Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { buildTransaction } from '../../__tests__/test-utils.js';
import type { IAccountingEntrySourceReader } from '../../ports/accounting-entry-reader.js';
import { computeAccountingEntryFingerprint } from '../accounting-entry-fingerprint.js';
import { buildAccountingEntryReader } from '../accounting-entry-reader.js';
import type { AccountingEntryDraft } from '../accounting-entry-types.js';
import { buildAccountingEntriesFromTransactions } from '../build-accounting-entries-from-transactions.js';

const noopLogger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
};

describe('computeAccountingEntryFingerprint', () => {
  it('stays stable regardless of provenance binding order', () => {
    const draft: AccountingEntryDraft = {
      kind: 'asset_inflow',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      quantity: parseDecimal('10.5'),
      role: 'staking_reward',
      provenanceBindings: [
        {
          txFingerprint: 'tx-b',
          movementFingerprint: 'movement:b',
          quantity: parseDecimal('4.5'),
        },
        {
          txFingerprint: 'tx-a',
          movementFingerprint: 'movement:a',
          quantity: parseDecimal('6'),
        },
      ],
    };

    const reordered: AccountingEntryDraft = {
      ...draft,
      provenanceBindings: [...draft.provenanceBindings].reverse(),
    };

    expect(assertOk(computeAccountingEntryFingerprint(draft))).toBe(
      assertOk(computeAccountingEntryFingerprint(reordered))
    );
  });
});

describe('buildAccountingEntriesFromTransactions', () => {
  it('uses effective net quantity for asset entries and keeps fee entries separate', () => {
    const transaction = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      platformKind: 'blockchain',
      platformKey: 'bitcoin',
      category: 'transfer',
      type: 'withdrawal',
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1.01',
          netAmount: '1',
        },
      ],
      fees: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.01'),
          scope: 'network',
          settlement: 'on-chain',
        },
      ],
    });

    const entries = assertOk(buildAccountingEntriesFromTransactions([transaction], noopLogger));

    expect(entries).toHaveLength(2);

    expect(entries[0]).toMatchObject({
      kind: 'asset_outflow',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('1'),
      role: 'principal',
    });
    expect(entries[0]!.provenanceBindings).toEqual([
      {
        txFingerprint: transaction.txFingerprint,
        movementFingerprint: transaction.movements.outflows?.[0]!.movementFingerprint,
        quantity: parseDecimal('1'),
      },
    ]);

    expect(entries[1]).toMatchObject({
      kind: 'fee',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('0.01'),
      feeScope: 'network',
      feeSettlement: 'on-chain',
    });
    expect(entries[1]!.provenanceBindings).toEqual([
      {
        txFingerprint: transaction.txFingerprint,
        movementFingerprint: transaction.fees[0]!.movementFingerprint,
        quantity: parseDecimal('0.01'),
      },
    ]);
  });
});

describe('buildAccountingEntryReader', () => {
  it('loads processed transactions from the source reader and materializes accounting entries', async () => {
    const transaction = buildTransaction({
      id: 5,
      datetime: '2024-03-01T00:00:00Z',
      inflows: [{ assetSymbol: 'ETH', assetId: 'blockchain:ethereum:native', amount: '2' }],
    });

    const loadAccountingEntrySource = vi.fn().mockResolvedValue(ok({ transactions: [transaction] }));
    const sourceReader: IAccountingEntrySourceReader = {
      loadAccountingEntrySource,
    };

    const reader = buildAccountingEntryReader({ sourceReader, logger: noopLogger });
    const entries = assertOk(await reader.loadAccountingEntries());

    expect(loadAccountingEntrySource).toHaveBeenCalledOnce();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'asset_inflow',
      assetId: 'blockchain:ethereum:native',
      quantity: parseDecimal('2'),
      role: 'principal',
    });
  });
});
