import { getTransactionScamAssessment } from '@exitbook/core';

import type { CategoryCounts, TransactionViewItem } from '../transactions-view-model.js';
export { TRANSACTION_FINGERPRINT_REF_LENGTH, formatTransactionFingerprintRef } from '../transaction-selector.js';

export type TransactionsStatusColor = 'green' | 'yellow' | 'red' | 'dim';

export interface TransactionPriceStatusDisplay {
  icon: string;
  iconColor: TransactionsStatusColor;
  label: string;
}

export function buildCategoryParts(counts: CategoryCounts): { count: number; label: string }[] {
  const parts: { count: number; label: string }[] = [];
  if (counts.trade > 0) parts.push({ label: 'trade', count: counts.trade });
  if (counts.transfer > 0) parts.push({ label: 'transfer', count: counts.transfer });
  if (counts.staking > 0) parts.push({ label: 'staking', count: counts.staking });
  if (counts.other > 0) parts.push({ label: 'other', count: counts.other });
  return parts;
}

export function formatTransactionOperation(category: string, type: string): string {
  return `${category}/${type}`;
}

export function formatTransactionBalanceSummary(summary: string | undefined): string {
  return summary ?? '—';
}

export function formatTransactionAmount(amount: string, width: number): string {
  const num = Number.parseFloat(amount);
  if (Number.isNaN(num)) {
    return amount.padStart(width);
  }

  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).padStart(width);
}

export function formatTransactionTimestamp(isoString: string): string {
  return isoString.replace('T', ' ').replace('Z', '').substring(0, 19);
}

export function formatTransactionDirection(direction: TransactionViewItem['primaryMovementDirection']): string {
  if (direction === 'in') return 'IN';
  if (direction === 'out') return 'OUT';
  return '—';
}

export function formatTransactionFlags(
  transaction: Pick<TransactionViewItem, 'excludedFromAccounting' | 'diagnostics'>
): string {
  const flags: string[] = [];
  if (transaction.excludedFromAccounting) flags.push('excluded');
  switch (getTransactionScamAssessment(transaction)) {
    case 'confirmed':
      flags.push('spam');
      break;
    case 'suspected':
      flags.push('suspicious');
      break;
  }
  return flags.length > 0 ? flags.join(',') : '—';
}

export function getTransactionPriceStatusDisplay(
  status: TransactionViewItem['priceStatus']
): TransactionPriceStatusDisplay {
  switch (status) {
    case 'all':
      return { icon: '✓', iconColor: 'green', label: 'priced' };
    case 'partial':
      return { icon: '⚠', iconColor: 'yellow', label: 'partial' };
    case 'none':
      return { icon: '✗', iconColor: 'red', label: 'missing' };
    case 'not-needed':
      return { icon: '·', iconColor: 'dim', label: 'not needed' };
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}
