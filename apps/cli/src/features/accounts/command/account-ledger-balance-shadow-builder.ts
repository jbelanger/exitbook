import {
  buildLedgerBalancesFromPostings,
  type LedgerAssetBalance,
  type LedgerBalancePostingInput,
} from '@exitbook/accounting/ledger-balance';
import type { Account } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { BalanceComparison, BalanceVerificationResult } from '@exitbook/ingestion/balance';
import { Decimal } from 'decimal.js';

import type { LedgerBalanceShadowAssetComparison, LedgerBalanceShadowResult } from './accounts-refresh-types.js';

const LEDGER_BALANCE_TOLERANCE = new Decimal('0.00000001');

export class AccountLedgerBalanceShadowBuilder {
  constructor(private readonly db: DataSession) {}

  async build(
    scopeAccount: Account,
    verificationResult: BalanceVerificationResult
  ): Promise<Result<LedgerBalanceShadowResult, Error>> {
    const postingsResult = await this.db.accountingLedger.findPostingsByOwnerAccountId(scopeAccount.id);
    if (postingsResult.isErr()) {
      return err(
        new Error(
          `Failed to load ledger postings for balance shadow account #${scopeAccount.id}: ${postingsResult.error.message}`
        )
      );
    }

    if (postingsResult.value.length === 0) {
      return ok({
        status: 'unavailable',
        reason: 'No persisted ledger postings exist for this account scope.',
        summary: {
          journals: 0,
          legacyDiffs: 0,
          legacyMatches: 0,
          liveMatches: 0,
          liveMismatches: 0,
          postings: 0,
          sourceActivities: 0,
          totalCurrencies: 0,
        },
        balances: [],
      });
    }

    const ledgerResult = buildLedgerBalancesFromPostings(
      postingsResult.value.map(
        (posting): LedgerBalancePostingInput => ({
          ownerAccountId: posting.ownerAccountId,
          assetId: posting.assetId,
          assetSymbol: posting.assetSymbol,
          balanceCategory: posting.balanceCategory,
          quantity: posting.quantity,
          journalFingerprint: posting.journalFingerprint,
          postingFingerprint: posting.postingFingerprint,
          sourceActivityFingerprint: posting.sourceActivityFingerprint,
        })
      )
    );
    if (ledgerResult.isErr()) {
      return err(ledgerResult.error);
    }

    const comparisonRows = buildLedgerShadowRows(ledgerResult.value.balances, verificationResult.comparisons);
    const liveMismatches = comparisonRows.filter(
      (row) => row.ledgerVsLiveDifference !== undefined && row.status === 'mismatch'
    ).length;
    const liveMatches = comparisonRows.filter(
      (row) => row.ledgerVsLiveDifference !== undefined && row.status === 'match'
    ).length;
    const legacyDiffs = comparisonRows.filter(
      (row) => row.ledgerVsLegacyDifference !== undefined && !parseDecimal(row.ledgerVsLegacyDifference).isZero()
    ).length;
    const legacyMatches = comparisonRows.filter(
      (row) => row.ledgerVsLegacyDifference !== undefined && parseDecimal(row.ledgerVsLegacyDifference).isZero()
    ).length;

    return ok({
      status: liveMismatches > 0 ? 'failed' : legacyDiffs > 0 ? 'warning' : 'success',
      summary: {
        journals: ledgerResult.value.summary.journalCount,
        legacyDiffs,
        legacyMatches,
        liveMatches,
        liveMismatches,
        postings: ledgerResult.value.summary.postingCount,
        sourceActivities: ledgerResult.value.summary.sourceActivityCount,
        totalCurrencies: comparisonRows.length,
      },
      balances: comparisonRows,
    });
  }
}

function buildLedgerShadowRows(
  ledgerBalances: readonly LedgerAssetBalance[],
  legacyComparisons: readonly BalanceComparison[]
): LedgerBalanceShadowAssetComparison[] {
  const ledgerByKey = new Map(ledgerBalances.map((balance) => [buildLedgerShadowRowKey(balance), balance] as const));
  const comparisonByKey = new Map(
    legacyComparisons.map(
      (comparison) => [buildLedgerShadowRowKey({ ...comparison, balanceCategory: 'liquid' }), comparison] as const
    )
  );
  const rowKeys = [...new Set([...ledgerByKey.keys(), ...comparisonByKey.keys()])].sort();

  return rowKeys.map((rowKey) => {
    const ledgerBalance = ledgerByKey.get(rowKey);
    const comparison = comparisonByKey.get(rowKey);
    const [assetId, balanceCategory] = parseLedgerShadowRowKey(rowKey);
    const ledgerQuantity = ledgerBalance?.quantity ?? new Decimal(0);
    const legacyQuantity = comparison !== undefined ? parseDecimal(comparison.calculatedBalance) : undefined;
    const liveQuantity = comparison !== undefined ? parseDecimal(comparison.liveBalance) : undefined;
    const ledgerVsLegacyDifference = legacyQuantity !== undefined ? ledgerQuantity.minus(legacyQuantity) : undefined;
    const ledgerVsLiveDifference = liveQuantity !== undefined ? ledgerQuantity.minus(liveQuantity) : undefined;

    return {
      assetId,
      balanceCategory,
      assetSymbol: comparison?.assetSymbol ?? ledgerBalance?.assetSymbol ?? assetId,
      ledgerBalance: ledgerQuantity.toFixed(),
      ...(legacyQuantity !== undefined && {
        legacyCalculatedBalance: legacyQuantity.toFixed(),
        ledgerVsLegacyDifference: ledgerVsLegacyDifference?.toFixed(),
      }),
      ...(liveQuantity !== undefined && {
        liveBalance: liveQuantity.toFixed(),
        ledgerVsLiveDifference: ledgerVsLiveDifference?.toFixed(),
      }),
      status: getLedgerShadowRowStatus(ledgerVsLiveDifference, ledgerVsLegacyDifference),
      sourceActivityCount: ledgerBalance?.sourceActivityCount ?? 0,
      journalCount: ledgerBalance?.journalCount ?? 0,
      postingCount: ledgerBalance?.postingCount ?? 0,
    };
  });
}

function buildLedgerShadowRowKey(params: {
  assetId: string;
  balanceCategory: LedgerBalanceShadowAssetComparison['balanceCategory'];
}): string {
  return `${params.assetId}\u0000${params.balanceCategory}`;
}

function parseLedgerShadowRowKey(rowKey: string): [string, LedgerBalanceShadowAssetComparison['balanceCategory']] {
  const [assetId, balanceCategory] = rowKey.split('\u0000') as [
    string,
    LedgerBalanceShadowAssetComparison['balanceCategory'],
  ];
  return [assetId, balanceCategory];
}

function getLedgerShadowRowStatus(
  ledgerVsLiveDifference: Decimal | undefined,
  ledgerVsLegacyDifference: Decimal | undefined
): LedgerBalanceShadowAssetComparison['status'] {
  if (ledgerVsLiveDifference !== undefined) {
    return ledgerVsLiveDifference.abs().lessThanOrEqualTo(LEDGER_BALANCE_TOLERANCE) ? 'match' : 'mismatch';
  }

  if (ledgerVsLegacyDifference !== undefined) {
    return ledgerVsLegacyDifference.abs().lessThanOrEqualTo(LEDGER_BALANCE_TOLERANCE) ? 'match' : 'warning';
  }

  return 'warning';
}
