import type { Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import {
  getUnattributedStakingRewardComponents,
  hasAnyDiagnosticCode,
  hasDiagnosticCode,
  isTransactionMarkedSpam,
  sumUniqueUnattributedStakingRewardComponents,
  transactionHasAnyDiagnosticCode,
  transactionHasDiagnosticCode,
  UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
} from '../transaction-diagnostic-utils.js';
import type { Transaction, TransactionDiagnostic } from '../transaction.js';

function createDiagnostics(codes: string[]): TransactionDiagnostic[] {
  return codes.map((code) => ({
    code,
    message: `${code} message`,
    severity: 'warning',
  }));
}

function createTransaction(
  overrides: Partial<Pick<Transaction, 'diagnostics'>> = {}
): Pick<Transaction, 'diagnostics'> {
  return {
    diagnostics: overrides.diagnostics,
  };
}

describe('transaction diagnostic utils', () => {
  it('detects exact diagnostic codes in a diagnostic array', () => {
    const diagnostics = createDiagnostics(['SCAM_TOKEN', 'classification_uncertain']);

    expect(hasDiagnosticCode(diagnostics, 'SCAM_TOKEN')).toBe(true);
    expect(hasDiagnosticCode(diagnostics, 'SUSPICIOUS_AIRDROP')).toBe(false);
  });

  it('detects any matching diagnostic code from a set', () => {
    const diagnostics = createDiagnostics(['classification_failed', 'allocation_uncertain']);

    expect(hasAnyDiagnosticCode(diagnostics, new Set(['allocation_uncertain', 'SCAM_TOKEN']))).toBe(true);
    expect(hasAnyDiagnosticCode(diagnostics, new Set(['SCAM_TOKEN', 'SUSPICIOUS_AIRDROP']))).toBe(false);
  });

  it('checks transaction diagnostics through the same helpers', () => {
    const transaction = createTransaction({
      diagnostics: createDiagnostics(['SUSPICIOUS_AIRDROP']),
    });

    expect(transactionHasDiagnosticCode(transaction, 'SUSPICIOUS_AIRDROP')).toBe(true);
    expect(transactionHasAnyDiagnosticCode(transaction, new Set(['classification_failed', 'SUSPICIOUS_AIRDROP']))).toBe(
      true
    );
  });

  it('treats SCAM_TOKEN as a spam-marked transaction', () => {
    expect(isTransactionMarkedSpam(createTransaction({ diagnostics: createDiagnostics(['SCAM_TOKEN']) }))).toBe(true);
    expect(isTransactionMarkedSpam(createTransaction({ diagnostics: createDiagnostics(['SUSPICIOUS_AIRDROP']) }))).toBe(
      false
    );
  });

  it('extracts typed unattributed staking reward components from diagnostics metadata', () => {
    const diagnostics: TransactionDiagnostic[] = [
      {
        code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
        message: 'wallet-scoped reward',
        severity: 'info',
        metadata: {
          amount: '10.524451',
          assetSymbol: 'ADA',
          movementRole: 'staking_reward',
        },
      },
      {
        code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
        message: 'ignored wrong role',
        severity: 'info',
        metadata: {
          amount: '1',
          assetSymbol: 'ADA',
          movementRole: 'principal',
        },
      },
    ];

    const components = getUnattributedStakingRewardComponents(diagnostics, 'ADA' as Currency);

    expect(components).toHaveLength(1);
    expect(components[0]?.amount.toFixed()).toBe('10.524451');
    expect(components[0]?.assetSymbol).toBe('ADA');
    expect(components[0]?.movementRole).toBe('staking_reward');
  });

  it('deduplicates repeated unattributed staking reward components across sibling diagnostics', () => {
    const diagnostics: TransactionDiagnostic[] = [
      {
        code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
        message: 'wallet-scoped reward',
        severity: 'info',
        metadata: {
          amount: '10.524451',
          assetSymbol: 'ADA',
          movementRole: 'staking_reward',
        },
      },
    ];

    const total = sumUniqueUnattributedStakingRewardComponents([diagnostics, diagnostics], 'ADA' as Currency);

    expect(total.toFixed()).toBe('10.524451');
  });
});
