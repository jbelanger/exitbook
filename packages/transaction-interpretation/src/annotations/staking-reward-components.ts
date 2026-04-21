import { parseDecimal, type Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { TransactionAnnotation } from './annotation-types.js';

export interface StakingRewardComponent {
  amount: Decimal;
  assetSymbol: Currency;
  componentKey: string;
}

function getStakingRewardComponentMetadata(
  annotation: TransactionAnnotation
): { amount: string; assetSymbol: Currency; componentKey: string } | undefined {
  if (annotation.kind !== 'staking_reward_component' || annotation.tier !== 'asserted') {
    return undefined;
  }

  const amount = typeof annotation.metadata?.['amount'] === 'string' ? annotation.metadata['amount'] : undefined;
  const assetSymbol =
    typeof annotation.metadata?.['assetSymbol'] === 'string'
      ? (annotation.metadata['assetSymbol'] as Currency)
      : undefined;
  if (!amount || !assetSymbol) {
    return undefined;
  }

  const componentKeyRaw =
    typeof annotation.metadata?.['componentKey'] === 'string' ? annotation.metadata['componentKey'] : undefined;
  const componentKey = componentKeyRaw?.trim() ? componentKeyRaw : `${annotation.kind}:${assetSymbol}:${amount}`;

  return {
    amount,
    assetSymbol,
    componentKey,
  };
}

export function getStakingRewardComponents(
  annotations: readonly TransactionAnnotation[] | undefined,
  assetSymbol?: Currency
): StakingRewardComponent[] {
  const components: StakingRewardComponent[] = [];

  for (const annotation of annotations ?? []) {
    const metadata = getStakingRewardComponentMetadata(annotation);
    if (!metadata) {
      continue;
    }

    if (assetSymbol !== undefined && metadata.assetSymbol !== assetSymbol) {
      continue;
    }

    components.push({
      amount: parseDecimal(metadata.amount),
      assetSymbol: metadata.assetSymbol,
      componentKey: metadata.componentKey,
    });
  }

  return components;
}

export function sumUniqueStakingRewardComponents(
  annotationCollections: readonly (readonly TransactionAnnotation[] | undefined)[],
  assetSymbol?: Currency
): Decimal {
  const uniqueAmounts = new Map<string, Decimal>();

  for (const annotations of annotationCollections) {
    for (const component of getStakingRewardComponents(annotations, assetSymbol)) {
      if (!uniqueAmounts.has(component.componentKey)) {
        uniqueAmounts.set(component.componentKey, component.amount);
      }
    }
  }

  return [...uniqueAmounts.values()].reduce((sum, amount) => sum.plus(amount), parseDecimal('0'));
}
