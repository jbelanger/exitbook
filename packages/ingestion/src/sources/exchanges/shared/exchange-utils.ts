import { parseDecimal } from '@exitbook/core';

export function getDirectionHint(amount: string): 'credit' | 'debit' | 'unknown' {
  const value = parseDecimal(amount);

  if (value.isNegative()) {
    return 'debit';
  }

  if (value.isPositive()) {
    return 'credit';
  }

  return 'unknown';
}
