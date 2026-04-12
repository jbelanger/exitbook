import { parseDecimal, type Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { MovementRole } from './movement.js';
import type { Transaction, TransactionDiagnostic } from './transaction.js';

export const UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE = 'unattributed_staking_reward_component';

export interface UnattributedStakingRewardComponent {
  amount: Decimal;
  assetSymbol: Currency;
  componentKey: string;
  movementRole: Extract<MovementRole, 'staking_reward'>;
}

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

export function getUnattributedStakingRewardComponents(
  diagnostics: readonly TransactionDiagnostic[] | undefined,
  assetSymbol?: Currency  
): UnattributedStakingRewardComponent[] {
  const components: UnattributedStakingRewardComponent[] = [];

  for (const diagnostic of diagnostics ?? []) {
    if (diagnostic.code !== UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE) {
      continue;
    }

    const metadata = diagnostic.metadata;
    const amountRaw = typeof metadata?.['amount'] === 'string' ? metadata['amount'] : undefined;
    const assetSymbolRaw = typeof metadata?.['assetSymbol'] === 'string' ? metadata['assetSymbol'] : undefined;
    const movementRole = metadata?.['movementRole'];

    if (!amountRaw || !assetSymbolRaw || movementRole !== 'staking_reward') {
      continue;
    }

    if (assetSymbol && assetSymbolRaw !== assetSymbol) {
      continue;
    }

    components.push({
      amount: parseDecimal(amountRaw),
      assetSymbol: assetSymbolRaw as Currency,
      componentKey: `${diagnostic.code}:${assetSymbolRaw}:${amountRaw}`,
      movementRole: 'staking_reward',
    });
  }

  return components;
}

export function sumUniqueUnattributedStakingRewardComponents(
  diagnosticsCollections: readonly (readonly TransactionDiagnostic[] | undefined)[],
  assetSymbol?: Currency  
): Decimal {
  const uniqueAmounts = new Map<string, Decimal>();

  for (const diagnostics of diagnosticsCollections) {
    for (const component of getUnattributedStakingRewardComponents(diagnostics, assetSymbol)) {
      if (!uniqueAmounts.has(component.componentKey)) {
        uniqueAmounts.set(component.componentKey, component.amount);
      }
    }
  }

  return [...uniqueAmounts.values()].reduce((sum, amount) => sum.plus(amount), parseDecimal('0'));
}
