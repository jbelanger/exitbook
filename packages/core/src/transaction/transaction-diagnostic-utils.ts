import type { Transaction, TransactionDiagnostic } from './transaction.js';

export function hasDiagnosticCode(
  diagnostics: readonly Pick<TransactionDiagnostic, 'code'>[] | undefined,
  code: string
): boolean {
  return diagnostics?.some((diagnostic) => diagnostic.code === code) ?? false;
}

export function hasAnyDiagnosticCode(
  diagnostics: readonly Pick<TransactionDiagnostic, 'code'>[] | undefined,
  codes: ReadonlySet<string>
): boolean {
  return diagnostics?.some((diagnostic) => codes.has(diagnostic.code)) ?? false;
}

export function transactionHasDiagnosticCode(transaction: Pick<Transaction, 'diagnostics'>, code: string): boolean {
  return hasDiagnosticCode(transaction.diagnostics, code);
}

export function transactionHasAnyDiagnosticCode(
  transaction: Pick<Transaction, 'diagnostics'>,
  codes: ReadonlySet<string>
): boolean {
  return hasAnyDiagnosticCode(transaction.diagnostics, codes);
}

export function isTransactionMarkedSpam(transaction: Pick<Transaction, 'diagnostics'>): boolean {
  return transactionHasDiagnosticCode(transaction, 'SCAM_TOKEN');
}
