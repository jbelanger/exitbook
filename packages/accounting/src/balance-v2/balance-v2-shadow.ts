import { buildTransactionBalanceImpact } from '@exitbook/core';
import type { Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import {
  buildBalanceV2FromPostings,
  indexBalanceV2ByAccountAsset,
  type BalanceV2AssetBalance,
  type BalanceV2PostingInput,
  type BalanceV2Result,
} from './balance-v2-runner.js';

export interface BalanceV2LegacyTransactionInput extends Pick<Transaction, 'accountId' | 'fees' | 'movements'> {
  txFingerprint?: string | undefined;
}

export interface BalanceV2ShadowDiff {
  accountId: number;
  assetId: string;
  assetSymbol: string;
  delta: Decimal;
  ledgerQuantity: Decimal;
  legacyQuantity: Decimal;
  ledgerJournalFingerprints: readonly string[];
  ledgerPostingFingerprints: readonly string[];
  ledgerSourceActivityFingerprints: readonly string[];
  legacyTransactionFingerprints: readonly string[];
}

export interface BalanceV2ShadowReport {
  diffs: readonly BalanceV2ShadowDiff[];
  ledgerBalances: readonly BalanceV2AssetBalance[];
  legacyBalances: readonly BalanceV2AssetBalance[];
}

function toLegacyPostingInput(
  transaction: BalanceV2LegacyTransactionInput,
  impactAsset: ReturnType<typeof buildTransactionBalanceImpact>['assets'][number]
): BalanceV2PostingInput | undefined {
  if (impactAsset.netBalanceDelta.isZero()) {
    return undefined;
  }

  return {
    accountId: transaction.accountId,
    assetId: impactAsset.assetId,
    assetSymbol: impactAsset.assetSymbol,
    quantity: impactAsset.netBalanceDelta,
    transactionFingerprint: transaction.txFingerprint,
  };
}

export function buildLegacyBalanceV2FromTransactions(
  transactions: readonly BalanceV2LegacyTransactionInput[]
): Result<BalanceV2Result, Error> {
  const postingInputs: BalanceV2PostingInput[] = [];

  for (const transaction of transactions) {
    if (!Number.isInteger(transaction.accountId) || transaction.accountId <= 0) {
      return err(
        new Error(`Legacy balance-v2 transaction account id must be positive, received ${transaction.accountId}`)
      );
    }

    const balanceImpact = buildTransactionBalanceImpact(transaction);
    for (const impactAsset of balanceImpact.assets) {
      const postingInput = toLegacyPostingInput(transaction, impactAsset);
      if (postingInput !== undefined) {
        postingInputs.push(postingInput);
      }
    }
  }

  return buildBalanceV2FromPostings(postingInputs);
}

export function diffBalanceV2Results(
  legacyResult: BalanceV2Result,
  ledgerResult: BalanceV2Result
): Result<BalanceV2ShadowDiff[], Error> {
  const legacyByKey = indexBalanceV2ByAccountAsset(legacyResult.balances);
  const ledgerByKey = indexBalanceV2ByAccountAsset(ledgerResult.balances);
  const allKeys = new Set([...legacyByKey.keys(), ...ledgerByKey.keys()]);
  const diffs: BalanceV2ShadowDiff[] = [];

  for (const key of [...allKeys].sort()) {
    const legacyBalance = legacyByKey.get(key);
    const ledgerBalance = ledgerByKey.get(key);
    const referenceBalance = ledgerBalance ?? legacyBalance;
    if (!referenceBalance) {
      continue;
    }

    if (legacyBalance && ledgerBalance && legacyBalance.assetSymbol !== ledgerBalance.assetSymbol) {
      return err(
        new Error(
          `Balance-v2 shadow asset ${referenceBalance.assetId} on account ${referenceBalance.accountId} has conflicting symbols: legacy ${legacyBalance.assetSymbol} vs ledger ${ledgerBalance.assetSymbol}`
        )
      );
    }

    const legacyQuantity = legacyBalance?.quantity ?? new Decimal(0);
    const ledgerQuantity = ledgerBalance?.quantity ?? new Decimal(0);
    if (legacyQuantity.eq(ledgerQuantity)) {
      continue;
    }

    diffs.push({
      accountId: referenceBalance.accountId,
      assetId: referenceBalance.assetId,
      assetSymbol: referenceBalance.assetSymbol,
      delta: ledgerQuantity.minus(legacyQuantity),
      ledgerQuantity,
      legacyQuantity,
      ledgerJournalFingerprints: ledgerBalance?.journalFingerprints ?? [],
      ledgerPostingFingerprints: ledgerBalance?.postingFingerprints ?? [],
      ledgerSourceActivityFingerprints: ledgerBalance?.sourceActivityFingerprints ?? [],
      legacyTransactionFingerprints: legacyBalance?.transactionFingerprints ?? [],
    });
  }

  return ok(diffs);
}

export function reconcileBalanceV2Shadow(params: {
  ledgerPostings: readonly BalanceV2PostingInput[];
  legacyTransactions: readonly BalanceV2LegacyTransactionInput[];
}): Result<BalanceV2ShadowReport, Error> {
  const legacyBalancesResult = buildLegacyBalanceV2FromTransactions(params.legacyTransactions);
  if (legacyBalancesResult.isErr()) {
    return err(legacyBalancesResult.error);
  }

  const ledgerBalancesResult = buildBalanceV2FromPostings(params.ledgerPostings);
  if (ledgerBalancesResult.isErr()) {
    return err(ledgerBalancesResult.error);
  }

  const diffsResult = diffBalanceV2Results(legacyBalancesResult.value, ledgerBalancesResult.value);
  if (diffsResult.isErr()) {
    return err(diffsResult.error);
  }

  return ok({
    diffs: diffsResult.value,
    ledgerBalances: ledgerBalancesResult.value.balances,
    legacyBalances: legacyBalancesResult.value.balances,
  });
}
