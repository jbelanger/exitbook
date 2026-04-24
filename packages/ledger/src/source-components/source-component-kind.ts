import { z } from 'zod';

export const AccountingSourceComponentKindSchema = z.enum([
  'raw_event',
  'exchange_fill',
  'exchange_fee',
  'utxo_input',
  'utxo_output',
  'cardano_collateral_input',
  'cardano_collateral_return',
  'cardano_stake_certificate',
  'cardano_delegation_certificate',
  'cardano_mir_certificate',
  'account_delta',
  'staking_reward',
  'message',
  'network_fee',
]);

export type AccountingSourceComponentKind = z.infer<typeof AccountingSourceComponentKindSchema>;
