import type { Decimal } from 'decimal.js';
import { z } from 'zod';

export const AccountingPostingRoleSchema = z.enum([
  'principal',
  'fee',
  'staking_reward',
  'protocol_deposit',
  'protocol_refund',
  'protocol_overhead',
  'refund_rebate',
]);

export type AccountingPostingRole = z.infer<typeof AccountingPostingRoleSchema>;

export function isAccountingPostingRoleCompatibleWithQuantitySign(
  quantity: Decimal,
  role: AccountingPostingRole
): boolean {
  if (quantity.isZero()) {
    return false;
  }

  switch (role) {
    case 'fee':
    case 'protocol_deposit':
      return quantity.lt(0);
    case 'staking_reward':
    case 'protocol_refund':
    case 'refund_rebate':
      return quantity.gt(0);
    case 'principal':
    case 'protocol_overhead':
      return true;
  }
}
