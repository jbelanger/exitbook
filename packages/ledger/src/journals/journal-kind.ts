import { z } from 'zod';

import type { LedgerEnumDocumentation } from '../internal/enum-documentation.js';

export const AccountingJournalKindValues = [
  'transfer',
  'trade',
  'staking_reward',
  'protocol_event',
  'refund_rebate',
  'internal_transfer',
  'expense_only',
  'opening_balance',
  'unknown',
] as const;

export const AccountingJournalKindSchema = z.enum(AccountingJournalKindValues);

export type AccountingJournalKind = z.infer<typeof AccountingJournalKindSchema>;

export const AccountingJournalKindDocs = {
  transfer: {
    consumerEffects:
      'Can create acquisition lots for inbound transfers or disposal/proceeds candidates for outbound transfers unless linked as an internal transfer.',
    emitWhen:
      'A processor sees value entering or leaving an owned account without a trade, reward, refund, or protocol-specific journal shape.',
    meaning: 'External movement into or out of the account.',
    notConfusedWith:
      'internal_transfer, which requires owned-account relationship evidence; protocol_event, which covers protocol custody or mechanics.',
  },
  trade: {
    consumerEffects: 'Consumes outgoing lots and creates incoming lots under jurisdiction-specific trade rules.',
    emitWhen: 'A processor can identify an exchange, swap, or equivalent asset-for-asset transaction.',
    meaning: 'Exchange of one asset for another.',
    notConfusedWith: 'transfer, which has no asset-for-asset exchange, or refund_rebate, which is a return of value.',
  },
  staking_reward: {
    consumerEffects: 'Creates income lots; semantics must not duplicate this reward truth.',
    emitWhen: 'Processor-owned chain data identifies an earned staking reward component.',
    meaning: 'Reward income known by the processor.',
    notConfusedWith: 'protocol_event staking operations, where principal/custody changes without reward income.',
  },
  protocol_event: {
    consumerEffects: 'Depends on posting roles such as protocol_deposit, protocol_refund, or protocol_overhead.',
    emitWhen:
      'A protocol interaction affects accounting but is not directly a transfer, trade, reward, rebate, or fee-only event.',
    meaning: 'Accounting-relevant protocol interaction.',
    notConfusedWith:
      'semantic facts; if postings, roles, transfer eligibility, or cost basis change, the truth belongs here.',
  },
  refund_rebate: {
    consumerEffects: 'Creates refund/rebate treatment according to jurisdiction rules.',
    emitWhen:
      'A processor sees returned value from a venue/protocol that is not normal trade proceeds or staking reward income.',
    meaning: 'Return of value from a venue or protocol.',
    notConfusedWith: 'staking_reward or protocol_refund.',
  },
  internal_transfer: {
    consumerEffects: 'Must not create gains/losses once linked; relationship/linking owns transfer eligibility.',
    emitWhen: 'A processor or linker has owned-account evidence for both sides of a movement.',
    meaning: 'Movement between owned accounts or addresses.',
    notConfusedWith: 'transfer, which is external until linked or otherwise proven internal.',
  },
  expense_only: {
    consumerEffects: 'Consumes fee/expense lots only; no principal asset acquisition/disposal.',
    emitWhen: 'The source activity has no principal asset effect and only spends a fee or protocol overhead.',
    meaning: 'Accounting event that is only an expense.',
    notConfusedWith: 'fee, which is a posting role inside a journal, not a journal kind.',
  },
  opening_balance: {
    consumerEffects:
      'Creates opening lots with known or unknown basis; unknown basis blocks only affected lot consumption, not unrelated assets.',
    emitWhen: 'A balance snapshot or manual entry establishes a cutoff position because earlier history is incomplete.',
    meaning: 'Explicit cutoff position used when prior history cannot be fully backfilled.',
    notConfusedWith: 'transfer or trade; it is not a historical provider transaction.',
  },
  unknown: {
    consumerEffects: 'Blocks only assets/postings touched by the unknown journal until classified or excluded.',
    emitWhen: 'The processor cannot safely classify an accounting event from available source data.',
    meaning: 'Unclassified accounting event.',
    notConfusedWith: 'diagnostics, which explain uncertainty but do not carry accounting meaning.',
  },
} satisfies Record<AccountingJournalKind, LedgerEnumDocumentation>;
