import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { Transaction } from './transaction.js';

export interface TransactionBalanceImpactAssetEntry {
  assetId: string;
  assetSymbol: string;
  creditGross: Decimal;
  debitGross: Decimal;
  separateFeeDebit: Decimal;
  embeddedFeeAmount: Decimal;
  netBalanceDelta: Decimal;
}

export interface TransactionBalanceImpact {
  assets: TransactionBalanceImpactAssetEntry[];
}

const ZERO_DECIMAL = parseDecimal('0');

export function buildTransactionBalanceImpact(
  transaction: Pick<Transaction, 'fees' | 'movements'>
): TransactionBalanceImpact {
  const assets = new Map<string, TransactionBalanceImpactAssetEntry>();

  const ensureAssetEntry = (assetId: string, assetSymbol: string): TransactionBalanceImpactAssetEntry => {
    const existingEntry = assets.get(assetId);
    if (existingEntry) {
      return existingEntry;
    }

    const newEntry: TransactionBalanceImpactAssetEntry = {
      assetId,
      assetSymbol,
      creditGross: ZERO_DECIMAL,
      debitGross: ZERO_DECIMAL,
      separateFeeDebit: ZERO_DECIMAL,
      embeddedFeeAmount: ZERO_DECIMAL,
      netBalanceDelta: ZERO_DECIMAL,
    };

    assets.set(assetId, newEntry);
    return newEntry;
  };

  for (const inflow of transaction.movements.inflows ?? []) {
    const entry = ensureAssetEntry(inflow.assetId, inflow.assetSymbol);
    entry.creditGross = entry.creditGross.plus(inflow.grossAmount);
    entry.netBalanceDelta = entry.netBalanceDelta.plus(inflow.grossAmount);
  }

  for (const outflow of transaction.movements.outflows ?? []) {
    const entry = ensureAssetEntry(outflow.assetId, outflow.assetSymbol);
    entry.debitGross = entry.debitGross.plus(outflow.grossAmount);
    entry.netBalanceDelta = entry.netBalanceDelta.minus(outflow.grossAmount);
  }

  for (const fee of transaction.fees ?? []) {
    const entry = ensureAssetEntry(fee.assetId, fee.assetSymbol);
    if (fee.settlement === 'on-chain') {
      entry.embeddedFeeAmount = entry.embeddedFeeAmount.plus(fee.amount);
      continue;
    }

    entry.separateFeeDebit = entry.separateFeeDebit.plus(fee.amount);
    entry.netBalanceDelta = entry.netBalanceDelta.minus(fee.amount);
  }

  return {
    assets: [...assets.values()],
  };
}
