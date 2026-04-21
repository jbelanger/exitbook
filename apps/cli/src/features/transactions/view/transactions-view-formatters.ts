import { getTransactionScamAssessment } from '@exitbook/core';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';

import { formatTransactionFingerprintRef } from '../transaction-selector.js';
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

function formatAnnotationProtocolRef(ref: NonNullable<TransactionAnnotation['protocolRef']>): string {
  return ref.version === undefined ? ref.id : `${ref.id}@${ref.version}`;
}

function formatAnnotationKind(kind: TransactionAnnotation['kind']): string {
  switch (kind) {
    case 'bridge_participant':
      return 'bridge';
    case 'asset_migration_participant':
      return 'asset migration';
    case 'wrap':
      return 'wrap';
    case 'unwrap':
      return 'unwrap';
    case 'protocol_deposit':
      return 'protocol deposit';
    case 'protocol_withdrawal':
      return 'protocol withdrawal';
    case 'airdrop_claim':
      return 'airdrop claim';
  }

  const exhaustiveCheck: never = kind;
  return exhaustiveCheck;
}

function buildAnnotationMetadataParts(annotation: TransactionAnnotation): string[] {
  const metadata = annotation.metadata;
  if (metadata === undefined) {
    return [];
  }

  const parts: string[] = [];
  const sourceChain = typeof metadata['sourceChain'] === 'string' ? metadata['sourceChain'] : undefined;
  const destinationChain = typeof metadata['destinationChain'] === 'string' ? metadata['destinationChain'] : undefined;
  const counterpartTxFingerprint =
    typeof metadata['counterpartTxFingerprint'] === 'string' ? metadata['counterpartTxFingerprint'] : undefined;

  if (sourceChain !== undefined || destinationChain !== undefined) {
    parts.push(`${sourceChain ?? '?'} -> ${destinationChain ?? '?'}`);
  }

  if (counterpartTxFingerprint !== undefined) {
    parts.push(`counterpart ${formatTransactionFingerprintRef(counterpartTxFingerprint)}`);
  }

  return parts;
}

export function formatTransactionAnnotation(annotation: TransactionAnnotation): string {
  const baseParts: string[] = [formatAnnotationKind(annotation.kind)];
  if (annotation.role !== undefined) {
    baseParts.push(annotation.role);
  }

  const details: string[] = [annotation.tier];
  if (annotation.protocolRef !== undefined) {
    details.push(`via ${formatAnnotationProtocolRef(annotation.protocolRef)}`);
  }
  details.push(...buildAnnotationMetadataParts(annotation));

  return `${baseParts.join(' ')} [${details.join(' · ')}]`;
}

export function summarizeTransactionAnnotations(annotations: readonly TransactionAnnotation[]): string {
  if (annotations.length === 0) {
    return '—';
  }

  const rendered = annotations.map((annotation) => formatTransactionAnnotation(annotation));
  if (rendered.length <= 2) {
    return rendered.join(' · ');
  }

  return `${rendered.slice(0, 2).join(' · ')} · +${rendered.length - 2} more`;
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
