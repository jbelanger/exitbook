import { z } from 'zod';

import type { LedgerEnumDocumentation } from '../internal/enum-documentation.js';

export const AccountingSourceComponentKindValues = [
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
  'balance_snapshot',
] as const;

export const AccountingSourceComponentKindSchema = z.enum(AccountingSourceComponentKindValues);

export type AccountingSourceComponentKind = z.infer<typeof AccountingSourceComponentKindSchema>;

export const AccountingSourceComponentKindDocs = {
  raw_event: {
    consumerEffects: 'Preserves provenance when a provider exposes only whole-event evidence.',
    emitWhen: 'No more specific provider-native component identity exists.',
    meaning: 'Whole source event component.',
    notConfusedWith: 'balance_snapshot, which is not provider event history.',
  },
  exchange_fill: {
    consumerEffects: 'Supports fill-level lot matching, fee attribution, and trade grouping.',
    emitWhen: 'An exchange provider exposes an individual fill or execution row.',
    meaning: 'Exchange fill component.',
    notConfusedWith: 'exchange_fee.',
  },
  exchange_fee: {
    consumerEffects: 'Supports fee provenance separate from trade principal fills.',
    emitWhen: 'An exchange provider exposes a fee component separately from the fill principal.',
    meaning: 'Exchange fee component.',
    notConfusedWith: 'network_fee.',
  },
  utxo_input: {
    consumerEffects: 'Supports UTXO cost-basis lot consumption and same-hash reduction.',
    emitWhen: 'A UTXO chain processor maps a posting to an input owned by the wallet scope.',
    meaning: 'Provider-native UTXO input.',
    notConfusedWith: 'utxo_output.',
  },
  utxo_output: {
    consumerEffects: 'Supports UTXO acquisition/change attribution and same-hash reduction.',
    emitWhen: 'A UTXO chain processor maps a posting to an output owned by the wallet scope.',
    meaning: 'Provider-native UTXO output.',
    notConfusedWith: 'utxo_input.',
  },
  cardano_collateral_input: {
    consumerEffects: 'Separates Cardano collateral loss/carryover from ordinary UTXO inputs.',
    emitWhen: 'A Cardano transaction uses a collateral input relevant to wallet accounting.',
    meaning: 'Cardano collateral input.',
    notConfusedWith: 'utxo_input.',
  },
  cardano_collateral_return: {
    consumerEffects: 'Separates Cardano collateral return from ordinary UTXO outputs.',
    emitWhen: 'A Cardano transaction returns collateral to the wallet.',
    meaning: 'Cardano collateral return output.',
    notConfusedWith: 'utxo_output.',
  },
  cardano_stake_certificate: {
    consumerEffects: 'Supports Cardano stake key deposit/refund accounting.',
    emitWhen: 'A Cardano stake registration/deregistration certificate affects accounting.',
    meaning: 'Cardano stake certificate component.',
    notConfusedWith: 'cardano_delegation_certificate.',
  },
  cardano_delegation_certificate: {
    consumerEffects: 'Preserves delegation evidence for staking state and diagnostics.',
    emitWhen: 'A Cardano delegation certificate is accounting-relevant evidence.',
    meaning: 'Cardano delegation certificate component.',
    notConfusedWith: 'cardano_stake_certificate.',
  },
  cardano_mir_certificate: {
    consumerEffects: 'Preserves MIR reward evidence distinct from ordinary withdrawals.',
    emitWhen: 'A Cardano MIR certificate contributes to a posting.',
    meaning: 'Cardano MIR certificate component.',
    notConfusedWith: 'staking_reward withdrawal components.',
  },
  account_delta: {
    consumerEffects: 'Supports account-based chain balance deltas where event/log components are the stable source.',
    emitWhen: 'An account-based chain processor maps a posting to a provider account delta.',
    meaning: 'Account-based balance delta component.',
    notConfusedWith: 'message, which identifies a Cosmos SDK message.',
  },
  staking_reward: {
    consumerEffects: 'Supports reward-income provenance at component level.',
    emitWhen: 'Processor-owned chain data identifies a staking reward component.',
    meaning: 'Staking reward component.',
    notConfusedWith: 'staking_reward posting role or journal kind; this is provenance only.',
  },
  message: {
    consumerEffects: 'Supports message-indexed chains such as Cosmos SDK without losing per-message provenance.',
    emitWhen: 'A processor maps a posting to a provider message or message index.',
    meaning: 'Provider message component.',
    notConfusedWith: 'account_delta.',
  },
  network_fee: {
    consumerEffects: 'Supports network-fee provenance and settlement checks.',
    emitWhen: 'A processor maps a fee posting to a provider network-fee component.',
    meaning: 'Network fee component.',
    notConfusedWith: 'exchange_fee.',
  },
  balance_snapshot: {
    consumerEffects:
      'Supports auditable opening balances without pretending they came from provider transaction history.',
    emitWhen: 'A balance snapshot or manual accounting input creates an opening position.',
    meaning: 'Balance snapshot component.',
    notConfusedWith: 'raw_event or any provider-native transaction component.',
  },
} satisfies Record<AccountingSourceComponentKind, LedgerEnumDocumentation>;
