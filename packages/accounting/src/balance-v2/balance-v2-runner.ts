import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

export interface BalanceV2PostingInput {
  accountId: number;
  assetId: string;
  assetSymbol: string;
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
  quantity: Decimal;
  journalFingerprints: readonly string[];
  postingFingerprints: readonly string[];
  sourceActivityFingerprints: readonly string[];
  transactionFingerprints: readonly string[];
}

export interface BalanceV2Result {
  balances: readonly BalanceV2AssetBalance[];
}

interface MutableBalanceV2AssetBalance {
  accountId: number;
  assetId: string;
  assetSymbol: string;
  journalFingerprints: Set<string>;
  postingFingerprints: Set<string>;
  quantity: Decimal;
  sourceActivityFingerprints: Set<string>;
  transactionFingerprints: Set<string>;
}

function buildBalanceV2Key(params: Pick<BalanceV2AssetBalance, 'accountId' | 'assetId'>): string {
  return `${params.accountId}\u0000${params.assetId}`;
}

function validateBalanceV2Posting(posting: BalanceV2PostingInput): Result<void, Error> {
  if (!Number.isInteger(posting.accountId) || posting.accountId <= 0) {
    return err(new Error(`Balance-v2 posting account id must be a positive integer, received ${posting.accountId}`));
  }

  if (posting.assetId.trim().length === 0) {
    return err(new Error('Balance-v2 posting asset id must not be empty'));
  }

  if (posting.assetSymbol.trim().length === 0) {
    return err(new Error(`Balance-v2 posting ${posting.assetId} asset symbol must not be empty`));
  }

  if (posting.quantity.isZero()) {
    return err(new Error(`Balance-v2 posting ${posting.assetId} quantity must not be zero`));
  }

  return ok(undefined);
}

function createMutableBalance(posting: BalanceV2PostingInput): MutableBalanceV2AssetBalance {
  return {
    accountId: posting.accountId,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    journalFingerprints: new Set(),
    postingFingerprints: new Set(),
    quantity: new Decimal(0),
    sourceActivityFingerprints: new Set(),
    transactionFingerprints: new Set(),
  };
}

function addOptionalSetValue(values: Set<string>, value: string | undefined): void {
  if (value !== undefined && value.trim().length > 0) {
    values.add(value);
  }
}

function applyPosting(
  balancesByKey: Map<string, MutableBalanceV2AssetBalance>,
  posting: BalanceV2PostingInput
): Result<void, Error> {
  const validationResult = validateBalanceV2Posting(posting);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const key = buildBalanceV2Key(posting);
  const balance = balancesByKey.get(key) ?? createMutableBalance(posting);

  if (balance.assetSymbol !== posting.assetSymbol) {
    return err(
      new Error(
        `Balance-v2 asset ${posting.assetId} on account ${posting.accountId} has conflicting symbols: ${balance.assetSymbol} vs ${posting.assetSymbol}`
      )
    );
  }

  balance.quantity = balance.quantity.plus(posting.quantity);
  addOptionalSetValue(balance.journalFingerprints, posting.journalFingerprint);
  addOptionalSetValue(balance.postingFingerprints, posting.postingFingerprint);
  addOptionalSetValue(balance.sourceActivityFingerprints, posting.sourceActivityFingerprint);
  addOptionalSetValue(balance.transactionFingerprints, posting.transactionFingerprint);
  balancesByKey.set(key, balance);

  return ok(undefined);
}

function materializeBalance(balance: MutableBalanceV2AssetBalance): BalanceV2AssetBalance {
  return {
    accountId: balance.accountId,
    assetId: balance.assetId,
    assetSymbol: balance.assetSymbol,
    quantity: balance.quantity,
    journalFingerprints: [...balance.journalFingerprints].sort(),
    postingFingerprints: [...balance.postingFingerprints].sort(),
    sourceActivityFingerprints: [...balance.sourceActivityFingerprints].sort(),
    transactionFingerprints: [...balance.transactionFingerprints].sort(),
  };
}

function sortBalances(balances: BalanceV2AssetBalance[]): BalanceV2AssetBalance[] {
  return balances.sort((left, right) => {
    const accountComparison = left.accountId - right.accountId;
    if (accountComparison !== 0) {
      return accountComparison;
    }

    return left.assetId.localeCompare(right.assetId);
  });
}

export function buildBalanceV2FromPostings(postings: readonly BalanceV2PostingInput[]): Result<BalanceV2Result, Error> {
  const balancesByKey = new Map<string, MutableBalanceV2AssetBalance>();

  for (const posting of postings) {
    const applyResult = applyPosting(balancesByKey, posting);
    if (applyResult.isErr()) {
      return err(applyResult.error);
    }
  }

  return ok({
    balances: sortBalances([...balancesByKey.values()].map(materializeBalance)),
  });
}

export function indexBalanceV2ByAccountAsset(
  balances: readonly BalanceV2AssetBalance[]
): Map<string, BalanceV2AssetBalance> {
  return new Map(balances.map((balance) => [buildBalanceV2Key(balance), balance]));
}
