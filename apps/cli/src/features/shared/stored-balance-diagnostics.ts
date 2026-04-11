import { buildTransactionBalanceImpact, type Transaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export interface DateRange {
  earliest: string;
  latest: string;
}

export interface StoredBalanceAssetDiagnosticsSummary {
  assetId: string;
  assetSymbol: string;
  totals: {
    fees: Decimal;
    inflows: Decimal;
    net: Decimal;
    outflows: Decimal;
    txCount: number;
  };
  /** Actual first and last transaction dates across all movements for this asset. */
  dateRange?: DateRange | undefined;
}

export function buildStoredBalanceAssetDiagnosticsSummary(params: {
  assetId: string;
  assetSymbol?: string | undefined;
  transactions: Transaction[];
}): StoredBalanceAssetDiagnosticsSummary {
  let assetSymbol = params.assetSymbol;

  let inflowTotal = parseDecimal('0');
  let outflowTotal = parseDecimal('0');
  let feeTotal = parseDecimal('0');
  let txCount = 0;
  let earliestDate: string | undefined;
  let latestDate: string | undefined;

  for (const tx of params.transactions) {
    const assetImpact = buildTransactionBalanceImpact(tx).assets.find((entry) => entry.assetId === params.assetId);

    if (!assetImpact) {
      continue;
    }

    const touched =
      !assetImpact.creditGross.isZero() || !assetImpact.debitGross.isZero() || !assetImpact.separateFeeDebit.isZero();

    if (!touched) {
      continue;
    }

    inflowTotal = inflowTotal.plus(assetImpact.creditGross);
    outflowTotal = outflowTotal.plus(assetImpact.debitGross);
    feeTotal = feeTotal.plus(assetImpact.separateFeeDebit);

    if (!assetSymbol) {
      assetSymbol = assetImpact.assetSymbol;
    }

    txCount++;
    if (!earliestDate || tx.datetime < earliestDate) earliestDate = tx.datetime;
    if (!latestDate || tx.datetime > latestDate) latestDate = tx.datetime;
  }

  const net = inflowTotal.minus(outflowTotal).minus(feeTotal);

  return {
    assetId: params.assetId,
    assetSymbol: assetSymbol ?? params.assetId,
    totals: {
      inflows: inflowTotal,
      outflows: outflowTotal,
      fees: feeTotal,
      net,
      txCount,
    },
    dateRange: earliestDate && latestDate ? { earliest: earliestDate, latest: latestDate } : undefined,
  };
}
