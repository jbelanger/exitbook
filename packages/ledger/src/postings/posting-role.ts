import type { Decimal } from 'decimal.js';
import { z } from 'zod';

import type { LedgerEnumDocumentation } from '../internal/enum-documentation.js';

export const AccountingPostingRoleValues = [
  'principal',
  'fee',
  'staking_reward',
  'protocol_deposit',
  'protocol_refund',
  'protocol_overhead',
  'refund_rebate',
  'opening_position',
] as const;

export const AccountingPostingRoleSchema = z.enum(AccountingPostingRoleValues);

export type AccountingPostingRole = z.infer<typeof AccountingPostingRoleSchema>;

export const AccountingPostingRoleDocs = {
  principal: {
    consumerEffects: 'Creates or disposes lots according to journal kind, transfer relationships, and matching rules.',
    emitWhen: 'A posting represents the main asset effect of a transfer, trade leg, or account delta.',
    meaning: 'Main asset movement.',
    notConfusedWith: 'fee or protocol_overhead, which represent costs rather than principal asset flow.',
  },
  fee: {
    consumerEffects: 'Expense/disposal treatment is jurisdiction-specific; settlement is required.',
    emitWhen: 'The account pays a network, venue, or protocol fee.',
    meaning: 'Fee paid by the account.',
    notConfusedWith: 'expense_only, which is a journal kind for fee-only activities.',
  },
  staking_reward: {
    consumerEffects: 'Creates income lots; semantic staking facts must not duplicate it.',
    emitWhen: 'Processor-owned chain data identifies a staking reward asset amount.',
    meaning: 'Earned staking reward amount.',
    notConfusedWith: 'principal inflows or reward_receivable balance category.',
  },
  protocol_deposit: {
    consumerEffects:
      'Usually reduces liquid availability or changes custody state; not a disposal unless relationship/cost-basis rules say so.',
    emitWhen: 'Assets move into protocol custody, staking, escrow, wrapping, or a similar non-liquid state.',
    meaning: 'Asset deposited into protocol-controlled state.',
    notConfusedWith: 'fee or protocol_overhead, which consume value rather than preserve a protocol position.',
  },
  protocol_refund: {
    consumerEffects:
      'Restores a previous protocol position or creates a lot depending on relationship/cost-basis rules.',
    emitWhen: 'Assets return from protocol custody or a failed/partial protocol action.',
    meaning: 'Asset returned from protocol-controlled state.',
    notConfusedWith: 'refund_rebate, which is a venue/protocol return of value not paired to custody return.',
  },
  protocol_overhead: {
    consumerEffects: 'Consumes affected asset value; unresolved treatment blocks only the affected asset path.',
    emitWhen: 'A protocol mechanic consumes value outside ordinary fee representation.',
    meaning: 'Non-fee protocol cost or burn.',
    notConfusedWith: 'fee, which has explicit fee settlement, or protocol_deposit, which preserves a position.',
  },
  refund_rebate: {
    consumerEffects: 'Creates refund/rebate treatment according to jurisdiction rules.',
    emitWhen: 'Returned value is known to be a refund or rebate rather than trade proceeds or staking reward.',
    meaning: 'Refund or rebate amount.',
    notConfusedWith: 'staking_reward or protocol_refund.',
  },
  opening_position: {
    consumerEffects:
      'Creates an opening lot; unknown basis blocks only calculations that consume this lot, not unrelated assets or known lots.',
    emitWhen: 'A balance snapshot or manual entry establishes a position at a cutoff date.',
    meaning: 'Position introduced because earlier history is incomplete.',
    notConfusedWith: 'principal, which comes from an actual provider transaction.',
  },
} satisfies Record<AccountingPostingRole, LedgerEnumDocumentation>;

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
    case 'opening_position':
      return quantity.gt(0);
    case 'principal':
    case 'protocol_overhead':
      return true;
  }
}
