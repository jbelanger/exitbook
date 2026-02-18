import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

export interface DateRange {
  earliest: string;
  latest: string;
}

interface MovementSample {
  amount: Decimal;
  datetime: string;
  from?: string | undefined;
  to?: string | undefined;
  transactionHash?: string | undefined;
}

interface FeeSample {
  amount: Decimal;
  datetime: string;
  transactionHash?: string | undefined;
}

export interface BalanceAssetDebugResult {
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
  topInflows: MovementSample[];
  topOutflows: MovementSample[];
  topFees: FeeSample[];
}

export function buildBalanceAssetDebug(params: {
  assetId: string;
  assetSymbol?: string | undefined;
  topN?: number | undefined;
  transactions: UniversalTransactionData[];
}): Result<BalanceAssetDebugResult, Error> {
  const topN = params.topN ?? 5;
  if (topN < 1) {
    return err(new Error(`Debug: invalid topN (${topN}); must be >= 1`));
  }

  let assetSymbol = params.assetSymbol;
  const inflows: MovementSample[] = [];
  const outflows: MovementSample[] = [];
  const fees: FeeSample[] = [];

  let inflowTotal = parseDecimal('0');
  let outflowTotal = parseDecimal('0');
  let feeTotal = parseDecimal('0');
  let txCount = 0;
  let earliestDate: string | undefined;
  let latestDate: string | undefined;

  for (const tx of params.transactions) {
    let touched = false;
    const txHash = tx.blockchain?.transaction_hash ?? tx.externalId;

    for (const inflow of tx.movements.inflows ?? []) {
      if (inflow.assetId !== params.assetId) continue;
      touched = true;
      inflowTotal = inflowTotal.plus(inflow.grossAmount);
      inflows.push({
        amount: inflow.grossAmount,
        datetime: tx.datetime,
        from: tx.from,
        to: tx.to,
        transactionHash: txHash,
      });
      if (!assetSymbol) {
        assetSymbol = inflow.assetSymbol;
      }
    }

    for (const outflow of tx.movements.outflows ?? []) {
      if (outflow.assetId !== params.assetId) continue;
      touched = true;
      outflowTotal = outflowTotal.plus(outflow.grossAmount);
      outflows.push({
        amount: outflow.grossAmount,
        datetime: tx.datetime,
        from: tx.from,
        to: tx.to,
        transactionHash: txHash,
      });
      if (!assetSymbol) {
        assetSymbol = outflow.assetSymbol;
      }
    }

    for (const fee of tx.fees ?? []) {
      if (fee.assetId !== params.assetId) continue;
      if (fee.settlement === 'on-chain') continue;
      touched = true;
      feeTotal = feeTotal.plus(fee.amount);
      fees.push({
        amount: fee.amount,
        datetime: tx.datetime,
        transactionHash: txHash,
      });
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

  inflows.sort((a, b) => b.amount.abs().comparedTo(a.amount.abs()));
  outflows.sort((a, b) => b.amount.abs().comparedTo(a.amount.abs()));
  fees.sort((a, b) => b.amount.abs().comparedTo(a.amount.abs()));

  return ok({
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
    topInflows: inflows.slice(0, topN),
    topOutflows: outflows.slice(0, topN),
    topFees: fees.slice(0, topN),
  });
}
