import { describe, expect, it } from 'vitest';

import {
  hasAnyDiagnosticCode,
  hasDiagnosticCode,
  isTransactionMarkedSpam,
  transactionHasAnyDiagnosticCode,
  transactionHasDiagnosticCode,
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
  overrides: Partial<Pick<Transaction, 'diagnostics' | 'isSpam'>> = {}
): Pick<Transaction, 'diagnostics' | 'isSpam'> {
  return {
    diagnostics: overrides.diagnostics,
    isSpam: overrides.isSpam,
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

  it('treats isSpam or SCAM_TOKEN as a spam-marked transaction', () => {
    expect(isTransactionMarkedSpam(createTransaction({ isSpam: true }))).toBe(true);
    expect(isTransactionMarkedSpam(createTransaction({ diagnostics: createDiagnostics(['SCAM_TOKEN']) }))).toBe(true);
    expect(isTransactionMarkedSpam(createTransaction({ diagnostics: createDiagnostics(['SUSPICIOUS_AIRDROP']) }))).toBe(
      false
    );
  });
});
