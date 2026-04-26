import { err, ok, type Result } from '@exitbook/foundation';
import type { AccountingBalanceCategory } from '@exitbook/ledger';
import type { Decimal } from 'decimal.js';

import {
  buildLedgerBalancesFromPostings,
  type LedgerAssetBalance,
  type LedgerBalancePostingInput,
} from '../ledger-balance.js';

export interface BalanceV2PostingInput {
  accountId: number;
  assetId: string;
  assetSymbol: string;
  balanceCategory?: AccountingBalanceCategory | undefined;
  quantity: Decimal;
  journalFingerprint?: string | undefined;
  postingFingerprint?: string | undefined;
  sourceActivityFingerprint?: string | undefined;
  transactionFingerprint?: string | undefined;
}

export interface BalanceV2AssetBalance {
  accountId: number;
  assetId: string;
  assetSymbol: string;
  balanceCategory: AccountingBalanceCategory;
  quantity: Decimal;
  journalFingerprints: readonly string[];
  postingFingerprints: readonly string[];
  sourceActivityFingerprints: readonly string[];
  transactionFingerprints: readonly string[];
}

export interface BalanceV2Result {
  balances: readonly BalanceV2AssetBalance[];
}

function resolveBalanceV2Category(posting: Pick<BalanceV2PostingInput, 'balanceCategory'>): AccountingBalanceCategory {
  return posting.balanceCategory ?? 'liquid';
}

function buildBalanceV2Key(params: Pick<BalanceV2AssetBalance, 'accountId' | 'assetId' | 'balanceCategory'>): string {
  return `${params.accountId}\u0000${params.assetId}\u0000${params.balanceCategory}`;
}

function toLedgerPostingInput(posting: BalanceV2PostingInput): LedgerBalancePostingInput {
  return {
    ownerAccountId: posting.accountId,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    balanceCategory: resolveBalanceV2Category(posting),
    quantity: posting.quantity,
    journalFingerprint: posting.journalFingerprint,
    postingFingerprint: posting.postingFingerprint,
    sourceActivityFingerprint: posting.sourceActivityFingerprint,
  };
}

function collectTransactionFingerprints(postings: readonly BalanceV2PostingInput[]): Map<string, readonly string[]> {
  const fingerprintsByKey = new Map<string, Set<string>>();

  for (const posting of postings) {
    if (posting.transactionFingerprint === undefined || posting.transactionFingerprint.trim().length === 0) {
      continue;
    }

    const key = buildBalanceV2Key({
      accountId: posting.accountId,
      assetId: posting.assetId,
      balanceCategory: resolveBalanceV2Category(posting),
    });
    const fingerprints = fingerprintsByKey.get(key) ?? new Set<string>();
    fingerprints.add(posting.transactionFingerprint);
    fingerprintsByKey.set(key, fingerprints);
  }

  return new Map([...fingerprintsByKey.entries()].map(([key, values]) => [key, [...values].sort()]));
}

function toBalanceV2AssetBalance(
  balance: LedgerAssetBalance,
  transactionFingerprintsByKey: Map<string, readonly string[]>
): BalanceV2AssetBalance {
  const accountId = balance.ownerAccountId;
  const key = buildBalanceV2Key({
    accountId,
    assetId: balance.assetId,
    balanceCategory: balance.balanceCategory,
  });

  return {
    accountId,
    assetId: balance.assetId,
    assetSymbol: balance.assetSymbol,
    balanceCategory: balance.balanceCategory,
    quantity: balance.quantity,
    journalFingerprints: balance.journalFingerprints,
    postingFingerprints: balance.postingFingerprints,
    sourceActivityFingerprints: balance.sourceActivityFingerprints,
    transactionFingerprints: transactionFingerprintsByKey.get(key) ?? [],
  };
}

export function buildBalanceV2FromPostings(postings: readonly BalanceV2PostingInput[]): Result<BalanceV2Result, Error> {
  const ledgerResult = buildLedgerBalancesFromPostings(postings.map(toLedgerPostingInput));
  if (ledgerResult.isErr()) {
    return err(ledgerResult.error);
  }

  const transactionFingerprintsByKey = collectTransactionFingerprints(postings);
  return ok({
    balances: ledgerResult.value.balances.map((balance) =>
      toBalanceV2AssetBalance(balance, transactionFingerprintsByKey)
    ),
  });
}

export function indexBalanceV2ByAccountAssetCategory(
  balances: readonly BalanceV2AssetBalance[]
): Map<string, BalanceV2AssetBalance> {
  return new Map(balances.map((balance) => [buildBalanceV2Key(balance), balance]));
}
