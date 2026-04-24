import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

export interface LedgerBalancePostingInput {
  ownerAccountId: number;
  assetId: string;
  assetSymbol: string;
  quantity: Decimal;
  journalFingerprint?: string | undefined;
  postingFingerprint?: string | undefined;
  sourceActivityFingerprint?: string | undefined;
}

export interface LedgerBalanceReferenceInput {
  ownerAccountId: number;
  assetId: string;
  assetSymbol: string;
  quantity: Decimal;
}

export interface LedgerAssetBalance {
  ownerAccountId: number;
  assetId: string;
  assetSymbol: string;
  quantity: Decimal;
  journalCount: number;
  journalFingerprints: readonly string[];
  postingCount: number;
  postingFingerprints: readonly string[];
  sourceActivityCount: number;
  sourceActivityFingerprints: readonly string[];
}

export interface LedgerBalanceResult {
  balances: readonly LedgerAssetBalance[];
  summary: {
    assetBalanceCount: number;
    journalCount: number;
    ownerAccountCount: number;
    postingCount: number;
    sourceActivityCount: number;
  };
}

export interface LedgerBalanceDiff {
  ownerAccountId: number;
  assetId: string;
  assetSymbol: string;
  delta: Decimal;
  ledgerQuantity: Decimal;
  referenceQuantity: Decimal;
  journalFingerprints: readonly string[];
  postingFingerprints: readonly string[];
  sourceActivityFingerprints: readonly string[];
}

interface MutableLedgerAssetBalance {
  ownerAccountId: number;
  assetId: string;
  assetSymbol: string;
  journalFingerprints: Set<string>;
  postingFingerprints: Set<string>;
  quantity: Decimal;
  sourceActivityFingerprints: Set<string>;
}

function buildLedgerBalanceKey(params: Pick<LedgerAssetBalance, 'assetId' | 'ownerAccountId'>): string {
  return `${params.ownerAccountId}\u0000${params.assetId}`;
}

function validateLedgerPosting(posting: LedgerBalancePostingInput): Result<void, Error> {
  if (!Number.isInteger(posting.ownerAccountId) || posting.ownerAccountId <= 0) {
    return err(
      new Error(
        `Ledger balance posting owner account id must be a positive integer, received ${posting.ownerAccountId}`
      )
    );
  }

  if (posting.assetId.trim().length === 0) {
    return err(new Error('Ledger balance posting asset id must not be empty'));
  }

  if (posting.assetSymbol.trim().length === 0) {
    return err(new Error(`Ledger balance posting ${posting.assetId} asset symbol must not be empty`));
  }

  if (posting.quantity.isZero()) {
    return err(new Error(`Ledger balance posting ${posting.assetId} quantity must not be zero`));
  }

  return ok(undefined);
}

function validateReferenceBalance(reference: LedgerBalanceReferenceInput): Result<void, Error> {
  if (!Number.isInteger(reference.ownerAccountId) || reference.ownerAccountId <= 0) {
    return err(
      new Error(
        `Ledger balance reference owner account id must be a positive integer, received ${reference.ownerAccountId}`
      )
    );
  }

  if (reference.assetId.trim().length === 0) {
    return err(new Error('Ledger balance reference asset id must not be empty'));
  }

  if (reference.assetSymbol.trim().length === 0) {
    return err(new Error(`Ledger balance reference ${reference.assetId} asset symbol must not be empty`));
  }

  return ok(undefined);
}

function createMutableBalance(posting: LedgerBalancePostingInput): MutableLedgerAssetBalance {
  return {
    ownerAccountId: posting.ownerAccountId,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    journalFingerprints: new Set(),
    postingFingerprints: new Set(),
    quantity: new Decimal(0),
    sourceActivityFingerprints: new Set(),
  };
}

function addOptionalSetValue(values: Set<string>, value: string | undefined): void {
  if (value !== undefined && value.trim().length > 0) {
    values.add(value);
  }
}

function applyPosting(
  balancesByKey: Map<string, MutableLedgerAssetBalance>,
  posting: LedgerBalancePostingInput
): Result<void, Error> {
  const validationResult = validateLedgerPosting(posting);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const key = buildLedgerBalanceKey(posting);
  const balance = balancesByKey.get(key) ?? createMutableBalance(posting);

  if (balance.assetSymbol !== posting.assetSymbol) {
    return err(
      new Error(
        `Ledger balance asset ${posting.assetId} on owner account ${posting.ownerAccountId} has conflicting symbols: ${balance.assetSymbol} vs ${posting.assetSymbol}`
      )
    );
  }

  balance.quantity = balance.quantity.plus(posting.quantity);
  addOptionalSetValue(balance.journalFingerprints, posting.journalFingerprint);
  addOptionalSetValue(balance.postingFingerprints, posting.postingFingerprint);
  addOptionalSetValue(balance.sourceActivityFingerprints, posting.sourceActivityFingerprint);
  balancesByKey.set(key, balance);

  return ok(undefined);
}

function materializeBalance(balance: MutableLedgerAssetBalance): LedgerAssetBalance {
  const journalFingerprints = [...balance.journalFingerprints].sort();
  const postingFingerprints = [...balance.postingFingerprints].sort();
  const sourceActivityFingerprints = [...balance.sourceActivityFingerprints].sort();

  return {
    ownerAccountId: balance.ownerAccountId,
    assetId: balance.assetId,
    assetSymbol: balance.assetSymbol,
    quantity: balance.quantity,
    journalCount: journalFingerprints.length,
    journalFingerprints,
    postingCount: postingFingerprints.length,
    postingFingerprints,
    sourceActivityCount: sourceActivityFingerprints.length,
    sourceActivityFingerprints,
  };
}

function sortBalances(balances: LedgerAssetBalance[]): LedgerAssetBalance[] {
  return balances.sort((left, right) => {
    const accountComparison = left.ownerAccountId - right.ownerAccountId;
    if (accountComparison !== 0) {
      return accountComparison;
    }

    return left.assetId.localeCompare(right.assetId);
  });
}

function buildSummary(balances: readonly LedgerAssetBalance[]): LedgerBalanceResult['summary'] {
  const ownerAccountIds = new Set<number>();
  const journalFingerprints = new Set<string>();
  const postingFingerprints = new Set<string>();
  const sourceActivityFingerprints = new Set<string>();

  for (const balance of balances) {
    ownerAccountIds.add(balance.ownerAccountId);
    for (const journalFingerprint of balance.journalFingerprints) {
      journalFingerprints.add(journalFingerprint);
    }
    for (const postingFingerprint of balance.postingFingerprints) {
      postingFingerprints.add(postingFingerprint);
    }
    for (const sourceActivityFingerprint of balance.sourceActivityFingerprints) {
      sourceActivityFingerprints.add(sourceActivityFingerprint);
    }
  }

  return {
    assetBalanceCount: balances.length,
    journalCount: journalFingerprints.size,
    ownerAccountCount: ownerAccountIds.size,
    postingCount: postingFingerprints.size,
    sourceActivityCount: sourceActivityFingerprints.size,
  };
}

function indexReferences(
  references: readonly LedgerBalanceReferenceInput[]
): Result<Map<string, LedgerBalanceReferenceInput>, Error> {
  const referencesByKey = new Map<string, LedgerBalanceReferenceInput>();

  for (const reference of references) {
    const validationResult = validateReferenceBalance(reference);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const key = buildLedgerBalanceKey(reference);
    const existing = referencesByKey.get(key);
    if (existing !== undefined && existing.assetSymbol !== reference.assetSymbol) {
      return err(
        new Error(
          `Ledger balance reference ${reference.assetId} on owner account ${reference.ownerAccountId} has conflicting symbols: ${existing.assetSymbol} vs ${reference.assetSymbol}`
        )
      );
    }

    const quantity = (existing?.quantity ?? new Decimal(0)).plus(reference.quantity);
    referencesByKey.set(key, { ...reference, quantity });
  }

  return ok(referencesByKey);
}

export function buildLedgerBalancesFromPostings(
  postings: readonly LedgerBalancePostingInput[]
): Result<LedgerBalanceResult, Error> {
  const balancesByKey = new Map<string, MutableLedgerAssetBalance>();

  for (const posting of postings) {
    const applyResult = applyPosting(balancesByKey, posting);
    if (applyResult.isErr()) {
      return err(applyResult.error);
    }
  }

  const balances = sortBalances([...balancesByKey.values()].map(materializeBalance));
  return ok({
    balances,
    summary: buildSummary(balances),
  });
}

export function indexLedgerBalancesByOwnerAsset(
  balances: readonly LedgerAssetBalance[]
): Map<string, LedgerAssetBalance> {
  return new Map(balances.map((balance) => [buildLedgerBalanceKey(balance), balance]));
}

export function diffLedgerBalancesAgainstReferences(params: {
  ledgerBalances: readonly LedgerAssetBalance[];
  referenceBalances: readonly LedgerBalanceReferenceInput[];
  tolerance?: Decimal | number | string | undefined;
}): Result<LedgerBalanceDiff[], Error> {
  const referencesResult = indexReferences(params.referenceBalances);
  if (referencesResult.isErr()) {
    return err(referencesResult.error);
  }

  const ledgerByKey = indexLedgerBalancesByOwnerAsset(params.ledgerBalances);
  const referenceByKey = referencesResult.value;
  const allKeys = new Set([...ledgerByKey.keys(), ...referenceByKey.keys()]);
  const tolerance = new Decimal(params.tolerance ?? 0);
  const diffs: LedgerBalanceDiff[] = [];

  for (const key of [...allKeys].sort()) {
    const ledgerBalance = ledgerByKey.get(key);
    const referenceBalance = referenceByKey.get(key);
    const reference = ledgerBalance ?? referenceBalance;
    if (reference === undefined) {
      continue;
    }

    if (
      ledgerBalance !== undefined &&
      referenceBalance !== undefined &&
      ledgerBalance.assetSymbol !== referenceBalance.assetSymbol
    ) {
      return err(
        new Error(
          `Ledger balance diff ${reference.assetId} on owner account ${reference.ownerAccountId} has conflicting symbols: ledger ${ledgerBalance.assetSymbol} vs reference ${referenceBalance.assetSymbol}`
        )
      );
    }

    const ledgerQuantity = ledgerBalance?.quantity ?? new Decimal(0);
    const referenceQuantity = referenceBalance?.quantity ?? new Decimal(0);
    const delta = ledgerQuantity.minus(referenceQuantity);
    if (delta.abs().lessThanOrEqualTo(tolerance)) {
      continue;
    }

    diffs.push({
      ownerAccountId: reference.ownerAccountId,
      assetId: reference.assetId,
      assetSymbol: reference.assetSymbol,
      delta,
      ledgerQuantity,
      referenceQuantity,
      journalFingerprints: ledgerBalance?.journalFingerprints ?? [],
      postingFingerprints: ledgerBalance?.postingFingerprints ?? [],
      sourceActivityFingerprints: ledgerBalance?.sourceActivityFingerprints ?? [],
    });
  }

  return ok(diffs);
}
