import { z } from 'zod';

export const AccountingSourceComponentKindSchema = z.enum([
  'raw_event',
  'exchange_fill',
  'exchange_fee',
  'utxo_input',
  'utxo_output',
  'account_delta',
  'staking_reward',
  'message',
  'network_fee',
]);

export type AccountingSourceComponentKind = z.infer<typeof AccountingSourceComponentKindSchema>;
