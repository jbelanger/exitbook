import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

interface BalanceMismatchInput {
  assetId: string; // Unique asset identity for filtering
  assetSymbol: string; // Display symbol
  currency: string; // Deprecated: use assetSymbol for display
  live: Decimal;
  calculated: Decimal;
}

interface MovementSample {
  datetime: string;
  transactionHash?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  amount: Decimal;
}

export function buildBalanceMismatchExplanation(params: {
  accountIdentifier: string;
  mismatches: BalanceMismatchInput[];
  topN?: number;
  transactions: UniversalTransactionData[];
}): Result<{ lines: string[] }, Error> {
  const topN = params.topN ?? 5;

  if (params.mismatches.length === 0) {
    return ok({ lines: [] });
  }

  if (topN < 1) {
    return err(new Error(`Explain: invalid topN (${topN}); must be >= 1`));
  }

  const transactions = params.transactions;
  const lines: string[] = [];

  if (transactions.length === 0) {
    lines.push('No transactions found in DB for this account (cannot explain mismatches).');
    return ok({ lines });
  }

  const firstTx = transactions[0];
  const lastTx = transactions[transactions.length - 1];
  lines.push(
    `Transactions in DB: ${transactions.length} (${firstTx?.datetime ?? 'unknown'} → ${lastTx?.datetime ?? 'unknown'})`
  );

  for (const mismatch of params.mismatches) {
    const assetId = mismatch.assetId;
    const assetSymbol = mismatch.assetSymbol;
    const inflows: MovementSample[] = [];
    const outflows: MovementSample[] = [];

    let inflowTotal = parseDecimal('0');
    let outflowTotal = parseDecimal('0');
    let feeTotal = parseDecimal('0');
    let txCountWithAsset = 0;

    for (const tx of transactions) {
      let touched = false;

      for (const inflow of tx.movements.inflows ?? []) {
        if (inflow.assetId !== assetId) continue;
        touched = true;
        inflowTotal = inflowTotal.plus(inflow.grossAmount);
        inflows.push({
          amount: inflow.grossAmount,
          datetime: tx.datetime,
          from: tx.from,
          to: tx.to,
          transactionHash: tx.blockchain?.transaction_hash,
        });
      }

      for (const outflow of tx.movements.outflows ?? []) {
        if (outflow.assetId !== assetId) continue;
        touched = true;
        outflowTotal = outflowTotal.plus(outflow.grossAmount);
        outflows.push({
          amount: outflow.grossAmount,
          datetime: tx.datetime,
          from: tx.from,
          to: tx.to,
          transactionHash: tx.blockchain?.transaction_hash,
        });
      }

      for (const fee of tx.fees ?? []) {
        if (fee.assetId !== assetId) continue;
        if (fee.settlement !== 'balance') continue;
        touched = true;
        feeTotal = feeTotal.plus(fee.amount);
      }

      if (touched) {
        txCountWithAsset++;
      }
    }

    const netFromTxs = inflowTotal.minus(outflowTotal).minus(feeTotal);
    const impliedOpeningOrMissing = mismatch.live.minus(mismatch.calculated);

    lines.push(
      `${assetSymbol}: tx-derived net=${netFromTxs.toFixed()} (in=${inflowTotal.toFixed()}, out=${outflowTotal.toFixed()}, fees=${feeTotal.toFixed()}) across ${txCountWithAsset} tx(s)`
    );
    lines.push(
      `${assetSymbol}: live=${mismatch.live.toFixed()}, calculated=${mismatch.calculated.toFixed()}, implied missing history/opening balance=${impliedOpeningOrMissing.toFixed()}`
    );

    if (inflows.length === 0 && outflows.length === 0 && feeTotal.isZero()) {
      lines.push(
        `${assetSymbol}: no movements found in imported transactions; live balance may be dust, minted/burned, or missing history.`
      );
      continue;
    }

    inflows.sort((a, b) => b.amount.abs().comparedTo(a.amount.abs()));
    outflows.sort((a, b) => b.amount.abs().comparedTo(a.amount.abs()));

    if (outflows.length > 0) {
      lines.push(`${assetSymbol}: top outflows:`);
      for (const sample of outflows.slice(0, topN)) {
        lines.push(
          `  - ${sample.amount.toFixed()} on ${sample.datetime} to ${sample.to ?? 'unknown'} (tx ${sample.transactionHash ?? 'unknown'})`
        );
      }
    }

    if (inflows.length > 0) {
      lines.push(`${assetSymbol}: top inflows:`);
      for (const sample of inflows.slice(0, topN)) {
        lines.push(
          `  - ${sample.amount.toFixed()} on ${sample.datetime} from ${sample.from ?? 'unknown'} (tx ${sample.transactionHash ?? 'unknown'})`
        );
      }
    }
  }

  return ok({ lines });
}
