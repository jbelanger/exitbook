import type { Transaction } from '@exitbook/core';

import type { AnnotationKind, AnnotationTier, TransactionAnnotation } from '../annotations/annotation-types.js';

export type DerivedOperationGroup = 'other' | 'staking' | 'trade' | 'transfer';

export interface DerivedOperationLabel {
  group: DerivedOperationGroup;
  label: string;
  source: 'annotation' | 'operation';
}

const ANNOTATION_KIND_PRIORITY: readonly AnnotationKind[] = [
  'wrap',
  'unwrap',
  'protocol_deposit',
  'protocol_withdrawal',
  'bridge_participant',
  'asset_migration_participant',
  'airdrop_claim',
];

function mapOperationCategoryToGroup(category: Transaction['operation']['category']): DerivedOperationGroup {
  switch (category) {
    case 'trade':
      return 'trade';
    case 'transfer':
      return 'transfer';
    case 'staking':
      return 'staking';
    default:
      return 'other';
  }
}

function getAnnotationTierRank(tier: AnnotationTier): number {
  return tier === 'asserted' ? 2 : 1;
}

function getAnnotationKindRank(kind: AnnotationKind): number {
  const rank = ANNOTATION_KIND_PRIORITY.indexOf(kind);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function chooseOperationLabelAnnotation(
  annotations: readonly TransactionAnnotation[]
): TransactionAnnotation | undefined {
  let selected: TransactionAnnotation | undefined;

  for (const annotation of annotations) {
    if (selected === undefined) {
      selected = annotation;
      continue;
    }

    const tierRank = getAnnotationTierRank(annotation.tier);
    const selectedTierRank = getAnnotationTierRank(selected.tier);
    if (tierRank > selectedTierRank) {
      selected = annotation;
      continue;
    }

    if (tierRank < selectedTierRank) {
      continue;
    }

    const kindRank = getAnnotationKindRank(annotation.kind);
    const selectedKindRank = getAnnotationKindRank(selected.kind);
    if (kindRank < selectedKindRank) {
      selected = annotation;
    }
  }

  return selected;
}

function buildRoleLabel(annotation: TransactionAnnotation, sendLabel: string, receiveLabel: string): string {
  if (annotation.role === 'source' || annotation.role === 'withdrawal') {
    return sendLabel;
  }

  if (annotation.role === 'target' || annotation.role === 'deposit' || annotation.role === 'claim') {
    return receiveLabel;
  }

  return sendLabel;
}

function buildAnnotationOperationLabel(annotation: TransactionAnnotation): DerivedOperationLabel {
  switch (annotation.kind) {
    case 'bridge_participant':
      return {
        group: 'transfer',
        label: buildRoleLabel(annotation, 'bridge/send', 'bridge/receive'),
        source: 'annotation',
      };
    case 'asset_migration_participant':
      return {
        group: 'transfer',
        label: buildRoleLabel(annotation, 'asset migration/send', 'asset migration/receive'),
        source: 'annotation',
      };
    case 'wrap':
      return { group: 'transfer', label: 'wrap', source: 'annotation' };
    case 'unwrap':
      return { group: 'transfer', label: 'unwrap', source: 'annotation' };
    case 'protocol_deposit':
      return { group: 'transfer', label: 'protocol/deposit', source: 'annotation' };
    case 'protocol_withdrawal':
      return { group: 'transfer', label: 'protocol/withdrawal', source: 'annotation' };
    case 'airdrop_claim':
      return { group: 'other', label: 'airdrop/claim', source: 'annotation' };
  }
}

export function deriveOperationLabel(
  transaction: Pick<Transaction, 'operation'>,
  annotations: readonly TransactionAnnotation[] = []
): DerivedOperationLabel {
  const annotation = chooseOperationLabelAnnotation(annotations);
  if (annotation !== undefined) {
    return buildAnnotationOperationLabel(annotation);
  }

  return {
    group: mapOperationCategoryToGroup(transaction.operation.category),
    label: `${transaction.operation.category}/${transaction.operation.type}`,
    source: 'operation',
  };
}
