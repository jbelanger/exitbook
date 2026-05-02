import type { LedgerCostBasisInputEvent, LedgerCostBasisJournalContext } from './ledger-cost-basis-event-projection.js';

export type LedgerCostBasisFeeAttachment =
  | {
      kind: 'standalone';
      rule: 'expense_only_without_relationships';
    }
  | {
      kind: 'attached_to_posting';
      postingFingerprint: string;
      rule: string;
    }
  | {
      kind: 'unknown';
      reason: LedgerCostBasisFeeAttachmentUnknownReason;
    };

export type LedgerCostBasisFeeAttachmentUnknownReason =
  | 'journal_context_mismatch'
  | 'not_fee_event'
  | 'unclassified_fee_context';

export function classifyLedgerCostBasisFeeAttachment(
  feeEvent: LedgerCostBasisInputEvent,
  journalContext: LedgerCostBasisJournalContext
): LedgerCostBasisFeeAttachment {
  if (feeEvent.kind !== 'fee') {
    return { kind: 'unknown', reason: 'not_fee_event' };
  }

  if (feeEvent.journalFingerprint !== journalContext.journalFingerprint) {
    return { kind: 'unknown', reason: 'journal_context_mismatch' };
  }

  if (journalContext.journalKind === 'expense_only' && journalContext.relationshipStableKeys.length === 0) {
    return { kind: 'standalone', rule: 'expense_only_without_relationships' };
  }

  return { kind: 'unknown', reason: 'unclassified_fee_context' };
}
