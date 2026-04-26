import { z } from 'zod';

import type { LedgerEnumDocumentation } from '../internal/enum-documentation.js';

export const AccountingBalanceCategoryValues = ['liquid', 'staked', 'unbonding', 'reward_receivable'] as const;

export const AccountingBalanceCategorySchema = z.enum(AccountingBalanceCategoryValues);

export type AccountingBalanceCategory = z.infer<typeof AccountingBalanceCategorySchema>;

export const AccountingBalanceCategoryDocs = {
  liquid: {
    consumerEffects: 'Included in normal spendable balance aggregation and cost-basis lot availability.',
    emitWhen: 'A posting affects assets that are spendable by the owner account after the source activity.',
    meaning: 'Spendable account balance.',
    notConfusedWith: 'staked or unbonding positions that remain owned but are not spendable.',
  },
  staked: {
    consumerEffects: 'Included in portfolio and balance with a staking category; not spendable until unstaked.',
    emitWhen: 'Provider state or processor evidence shows an owned delegated/staked position.',
    meaning: 'Delegated or staked owned position.',
    notConfusedWith: 'liquid claimed rewards or unbonding positions.',
  },
  unbonding: {
    consumerEffects: 'Included in balance with unbonding timing metadata where available; not liquid until completion.',
    emitWhen: 'Provider state or processor evidence shows an owned staking position in the unbonding period.',
    meaning: 'Owned staking position waiting through the chain unbonding period.',
    notConfusedWith: 'staked active delegation or liquid balance after unbond completion.',
  },
  reward_receivable: {
    consumerEffects:
      'Included as receivable balance; tax recognition timing is jurisdiction-specific and must be handled explicitly.',
    emitWhen: 'Provider state exposes earned staking rewards that have not been claimed into liquid balance.',
    meaning: 'Earned staking reward visible in state but not yet claimed.',
    notConfusedWith: 'staking_reward postings that record claimed/recognized reward transactions.',
  },
} satisfies Record<AccountingBalanceCategory, LedgerEnumDocumentation>;
