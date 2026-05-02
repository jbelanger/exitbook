import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type {
  LedgerCostBasisInputEvent,
  LedgerCostBasisJournalContext,
} from '../ledger-cost-basis-event-projection.js';
import { classifyLedgerCostBasisFeeAttachment } from '../ledger-cost-basis-fee-attachment.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('classifyLedgerCostBasisFeeAttachment', () => {
  it('classifies expense-only fees without relationships as standalone', () => {
    const attachment = classifyLedgerCostBasisFeeAttachment(
      makeEvent({ kind: 'fee' }),
      makeJournalContext({ journalKind: 'expense_only', relationshipStableKeys: [] })
    );

    expect(attachment).toEqual({ kind: 'standalone', rule: 'expense_only_without_relationships' });
  });

  it('returns unknown when a fee journal has relationship context', () => {
    const attachment = classifyLedgerCostBasisFeeAttachment(
      makeEvent({ kind: 'fee' }),
      makeJournalContext({ journalKind: 'transfer', relationshipStableKeys: ['relationship:bridge'] })
    );

    expect(attachment).toEqual({ kind: 'unknown', reason: 'unclassified_fee_context' });
  });

  it('returns unknown for non-fee events and mismatched journal context', () => {
    expect(
      classifyLedgerCostBasisFeeAttachment(
        makeEvent({ kind: 'disposal' }),
        makeJournalContext({ journalKind: 'expense_only', relationshipStableKeys: [] })
      )
    ).toEqual({ kind: 'unknown', reason: 'not_fee_event' });

    expect(
      classifyLedgerCostBasisFeeAttachment(
        makeEvent({ journalFingerprint: 'journal:fee', kind: 'fee' }),
        makeJournalContext({
          journalFingerprint: 'journal:other',
          journalKind: 'expense_only',
          relationshipStableKeys: [],
        })
      )
    ).toEqual({ kind: 'unknown', reason: 'journal_context_mismatch' });
  });
});

function makeEvent(overrides: Partial<LedgerCostBasisInputEvent> = {}): LedgerCostBasisInputEvent {
  return {
    eventId: 'ledger-cost-basis:fee:posting:fee:posting',
    kind: 'fee',
    sourceActivityFingerprint: 'activity:fee',
    ownerAccountId: 1,
    journalFingerprint: 'journal:fee',
    journalKind: 'expense_only',
    postingFingerprint: 'posting:fee',
    postingRole: 'fee',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    assetId: 'blockchain:ethereum:native',
    assetSymbol: ETH,
    quantity: parseDecimal('0.01'),
    settlement: 'on-chain',
    ...overrides,
  };
}

function makeJournalContext(overrides: Partial<LedgerCostBasisJournalContext> = {}): LedgerCostBasisJournalContext {
  return {
    journalFingerprint: 'journal:fee',
    journalKind: 'expense_only',
    postings: [
      {
        postingFingerprint: 'posting:fee',
        postingRole: 'fee',
        assetId: 'blockchain:ethereum:native',
        assetSymbol: ETH,
        postingQuantity: parseDecimal('-0.01'),
      },
    ],
    relationshipStableKeys: [],
    ...overrides,
  };
}
