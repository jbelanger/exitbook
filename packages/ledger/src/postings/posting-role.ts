import type { Decimal } from 'decimal.js';
import { z } from 'zod';

export const AccountingPostingRoleSchema = z.enum([
  'principal',
  'fee',
  'staking_reward',
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
      return quantity.lt(0);
    case 'staking_reward':
    case 'refund_rebate':
      return quantity.gt(0);
    case 'principal':
    case 'protocol_overhead':
      return true;
  }
}
