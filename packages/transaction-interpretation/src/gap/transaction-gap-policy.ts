import {
  getMovementRole,
  getTransactionScamAssessment,
  hasAnyDiagnosticCode,
  type MovementRole,
  type Transaction,
} from '@exitbook/core';

import type { TransactionAnnotation } from '../annotations/annotation-types.js';

const LIKELY_DUST_DIAGNOSTIC_CODES = new Set(['unsolicited_dust_fanout']);
const GAP_SUPPRESSION_DIAGNOSTIC_CODES = new Set(['off_platform_cash_movement']);
const GAP_DIAGNOSTIC_PRIORITY = [
  'staking_withdrawal',
  'unsolicited_dust_fanout',
  'allocation_uncertain',
  'classification_uncertain',
  'classification_failed',
  'batch_operation',
  'proxy_operation',
  'multisig_operation',
  'exchange_deposit_address_credit',
] as const;
const GAP_MOVEMENT_ROLE_CONTEXT_PRIORITY: readonly Exclude<MovementRole, 'principal'>[] = [
  'staking_reward',
  'protocol_overhead',
  'refund_rebate',
];

export interface TransactionGapContextHint {
  kind: 'annotation' | 'diagnostic' | 'movement_role';
  code: string;
  label: string;
  message: string;
}

function getStakingRewardAnnotation(
  annotations: readonly TransactionAnnotation[] | undefined
): TransactionAnnotation | undefined {
  return annotations?.find((annotation) => annotation.kind === 'staking_reward' && annotation.tier === 'asserted');
}

function deriveGapMovementRoleContextHint(tx: Pick<Transaction, 'movements'>): TransactionGapContextHint | undefined {
  const movementRoles = new Set<Exclude<MovementRole, 'principal'>>();
  const movements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];

  for (const movement of movements) {
    const movementRole = getMovementRole(movement);
    if (movementRole === 'principal') {
      continue;
    }

    movementRoles.add(movementRole);
  }

  for (const movementRole of GAP_MOVEMENT_ROLE_CONTEXT_PRIORITY) {
    if (!movementRoles.has(movementRole)) {
      continue;
    }

    return {
      kind: 'movement_role',
      code: movementRole,
      label: formatGapMovementRoleContextLabel(movementRole),
      message: buildGapMovementRoleContextMessage(movementRole),
    };
  }

  return undefined;
}

function formatGapDiagnosticContextLabel(code: string, message: string): string {
  if (code === 'staking_withdrawal') {
    return 'staking withdrawal in same tx';
  }

  if (code === 'unsolicited_dust_fanout') {
    return 'unsolicited dust fan-out';
  }

  if (code === 'allocation_uncertain') {
    return 'allocation uncertainty';
  }

  if (code === 'classification_uncertain') {
    if (message.toLowerCase().includes('staking withdrawal')) {
      return 'staking withdrawal in same tx';
    }

    return 'classification uncertainty';
  }

  if (code === 'classification_failed') {
    return 'classification failed';
  }

  if (code === 'batch_operation') {
    return 'batch operation';
  }

  if (code === 'proxy_operation') {
    return 'proxy operation';
  }

  if (code === 'multisig_operation') {
    return 'multisig operation';
  }

  if (code === 'exchange_deposit_address_credit') {
    return 'credit into exchange deposit address';
  }

  return code.replace(/_/g, ' ');
}

function formatGapMovementRoleContextLabel(movementRole: Exclude<MovementRole, 'principal'>): string {
  switch (movementRole) {
    case 'staking_reward':
      return 'staking reward in same tx';
    case 'protocol_overhead':
      return 'protocol overhead in same tx';
    case 'refund_rebate':
      return 'refund or rebate in same tx';
  }
}

function buildGapMovementRoleContextMessage(movementRole: Exclude<MovementRole, 'principal'>): string {
  switch (movementRole) {
    case 'staking_reward':
      return 'Transaction includes a staking reward movement that is excluded from transfer matching.';
    case 'protocol_overhead':
      return 'Transaction includes a protocol-overhead movement that is excluded from transfer matching.';
    case 'refund_rebate':
      return 'Transaction includes a refund or rebate movement that is excluded from transfer matching.';
  }
}

export function deriveTransactionGapContextHint(
  transaction: Pick<Transaction, 'diagnostics' | 'movements'>,
  annotations: readonly TransactionAnnotation[] | undefined
): TransactionGapContextHint | undefined {
  for (const code of GAP_DIAGNOSTIC_PRIORITY) {
    const diagnostic = transaction.diagnostics?.find((entry) => entry.code === code);
    if (!diagnostic) {
      continue;
    }

    return {
      kind: 'diagnostic',
      code: diagnostic.code,
      label: formatGapDiagnosticContextLabel(diagnostic.code, diagnostic.message),
      message: diagnostic.message,
    };
  }

  const stakingRewardAnnotation = getStakingRewardAnnotation(annotations);
  if (stakingRewardAnnotation !== undefined) {
    return {
      kind: 'annotation',
      code: stakingRewardAnnotation.kind,
      label: 'staking reward in same tx',
      message: 'Transaction carries asserted staking reward interpretation that is excluded from transfer matching.',
    };
  }

  return deriveGapMovementRoleContextHint(transaction);
}

export function hasLikelyDustSignal(transaction: Pick<Transaction, 'diagnostics'>): boolean {
  return hasAnyDiagnosticCode(transaction.diagnostics, LIKELY_DUST_DIAGNOSTIC_CODES);
}

export function shouldSuppressTransactionGapIssue(
  transaction: Pick<Transaction, 'diagnostics' | 'excludedFromAccounting'>
): boolean {
  if (transaction.excludedFromAccounting === true) {
    return true;
  }

  if (hasAnyDiagnosticCode(transaction.diagnostics, GAP_SUPPRESSION_DIAGNOSTIC_CODES)) {
    return true;
  }

  return getTransactionScamAssessment(transaction) !== undefined;
}
