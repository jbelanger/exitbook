import type { Transaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export interface DateRange {
  earliest: string;
  latest: string;
}

export interface BalanceAssetDiagnosticsSummary {
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

export function buildBalanceAssetDiagnosticsSummary(params: {
  assetId: string;
  assetSymbol?: string | undefined;
  transactions: Transaction[];
}): BalanceAssetDiagnosticsSummary {
  let assetSymbol = params.assetSymbol;

  let inflowTotal = parseDecimal('0');
  let outflowTotal = parseDecimal('0');
  let feeTotal = parseDecimal('0');
  let txCount = 0;
  let earliestDate: string | undefined;
  let latestDate: string | undefined;

  for (const tx of params.transactions) {
    let touched = false;

    for (const inflow of tx.movements.inflows ?? []) {
      if (inflow.assetId !== params.assetId) continue;
      touched = true;
      inflowTotal = inflowTotal.plus(inflow.grossAmount);
      if (!assetSymbol) {
        assetSymbol = inflow.assetSymbol;
      }
    }

    for (const outflow of tx.movements.outflows ?? []) {
      if (outflow.assetId !== params.assetId) continue;
      touched = true;
      outflowTotal = outflowTotal.plus(outflow.grossAmount);
      if (!assetSymbol) {
        assetSymbol = outflow.assetSymbol;
      }
    }

    for (const fee of tx.fees ?? []) {
      if (fee.assetId !== params.assetId) continue;
      if (fee.settlement === 'on-chain') continue;
      touched = true;
      feeTotal = feeTotal.plus(fee.amount);
      if (!assetSymbol) {
        assetSymbol = fee.assetSymbol;
      }
    }

    if (touched) {
      txCount++;
      if (!earliestDate || tx.datetime < earliestDate) earliestDate = tx.datetime;
      if (!latestDate || tx.datetime > latestDate) latestDate = tx.datetime;
    }
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
