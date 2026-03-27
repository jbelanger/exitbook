import { err, getErrorMessage, ok, type Result, sha256Hex } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

// Wrap the raw sha256Hex in Result for fingerprint use
function sha256Result(material: string): Result<string, Error> {
  try {
    return ok(sha256Hex(material));
  } catch (error) {
    return err(new Error(`Failed to compute SHA-256 fingerprint: ${getErrorMessage(error)}`));
  }
}

// ---------------------------------------------------------------------------
// Account fingerprint
// ---------------------------------------------------------------------------

export interface AccountFingerprintInput {
  profileKey: string;
  accountType: string;
  platformKey: string;
  identifier: string;
}

type FingerprintAccountKind = 'exchange' | 'wallet';

function normalizeFingerprintAccountKind(accountType: string): Result<FingerprintAccountKind, Error> {
  const normalizedAccountType = accountType.trim();

  if (normalizedAccountType === 'blockchain') {
    return ok('wallet');
  }
  if (normalizedAccountType === 'exchange-api' || normalizedAccountType === 'exchange-csv') {
    return ok('exchange');
  }

  return err(new Error(`Unsupported accountType '${normalizedAccountType}' for fingerprint identity`));
}

/**
 * Stable account identity fingerprint.
 *
 * Derived from semantic account identity material — not database IDs.
 * Deterministic across rebuilds for the same profile-scoped semantic account.
 *
 * Exchange identities intentionally ignore mutable API keys and CSV paths and
 * instead rely on the lifecycle invariant that a profile owns at most one
 * top-level exchange account per platform. If that invariant changes, revisit
 * this function before changing account lifecycle rules.
 */
export function computeAccountFingerprint(input: AccountFingerprintInput): Result<string, Error> {
  const { profileKey, accountType, platformKey, identifier } = input;
  const trimmedProfileKey = profileKey.trim();
  const trimmedPlatformKey = platformKey.trim();
  const trimmedIdentifier = identifier.trim();

  if (trimmedProfileKey === '') {
    return err(new Error('profileKey must not be empty'));
  }

  const accountKindResult = normalizeFingerprintAccountKind(accountType);
  if (accountKindResult.isErr()) {
    return err(accountKindResult.error);
  }

  if (trimmedPlatformKey === '') {
    return err(new Error('platformKey must not be empty'));
  }

  if (accountKindResult.value === 'wallet' && trimmedIdentifier === '') {
    return err(new Error('identifier must not be empty'));
  }

  const material =
    accountKindResult.value === 'exchange'
      ? `${trimmedProfileKey}|exchange|${trimmedPlatformKey}`
      : `${trimmedProfileKey}|wallet|${trimmedPlatformKey}|${trimmedIdentifier}`;
  return sha256Result(material);
}

// ---------------------------------------------------------------------------
// Transaction fingerprint
// ---------------------------------------------------------------------------

export interface TransactionFingerprintInput {
  accountFingerprint: string;
  platformKey: string;
  platformKind: 'blockchain' | 'exchange';
  blockchainTransactionHash?: string | undefined;
  componentEventIds?: string[] | undefined;
}

/**
 * Canonical transaction fingerprint — the only processed transaction identifier.
 *
 * Blockchain: sha256(accountFingerprint|blockchain|platformKey|transactionHash)
 * Exchange:   sha256(accountFingerprint|exchange|platformKey|sortedEventId1|sortedEventId2|...)
 *
 * Keep this rooted in `accountFingerprint`. Notes, links, and movement
 * fingerprints inherit profile isolation automatically from account identity.
 */
export function computeTxFingerprint(input: TransactionFingerprintInput): Result<string, Error> {
  const { accountFingerprint, platformKey, platformKind } = input;
  const trimmedAccountFingerprint = accountFingerprint.trim();
  const trimmedPlatformKey = platformKey.trim();

  if (trimmedAccountFingerprint === '') {
    return err(new Error('accountFingerprint must not be empty'));
  }

  if (trimmedPlatformKey === '') {
    return err(new Error('platformKey must not be empty'));
  }

  if (platformKind === 'blockchain') {
    const hash = input.blockchainTransactionHash;
    if (!hash || hash.trim() === '') {
      return err(new Error('blockchainTransactionHash is required for blockchain transactions'));
    }
    const material = `${trimmedAccountFingerprint}|blockchain|${trimmedPlatformKey}|${hash.trim()}`;
    return sha256Result(material);
  }

  const eventIds = input.componentEventIds;
  if (!eventIds || eventIds.length === 0) {
    return err(new Error('componentEventIds is required for exchange transactions'));
  }

  const normalizedEventIds = eventIds.map((eventId) => eventId.trim());
  if (normalizedEventIds.some((eventId) => eventId === '')) {
    return err(new Error('componentEventIds must not contain empty values'));
  }

  const sorted = [...normalizedEventIds].sort();
  const material = `${trimmedAccountFingerprint}|exchange|${trimmedPlatformKey}|${sorted.join('|')}`;
  return sha256Result(material);
}

// ---------------------------------------------------------------------------
// Movement fingerprint
// ---------------------------------------------------------------------------

export interface AssetMovementCanonicalMaterialInput {
  movementType: 'inflow' | 'outflow';
  assetId: string;
  grossAmount: Decimal;
  netAmount?: Decimal | undefined;
}

export interface FeeMovementCanonicalMaterialInput {
  assetId: string;
  amount: Decimal;
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other';
  settlement: 'on-chain' | 'balance' | 'external';
}

/**
 * Canonical asset-movement identity material within a transaction.
 *
 * This intentionally excludes display-only or enrichable data like symbols and
 * prices. Duplicate rows with the same canonical material are treated as
 * interchangeable and are later disambiguated only by duplicate occurrence.
 */
export function buildAssetMovementCanonicalMaterial(input: AssetMovementCanonicalMaterialInput): string {
  const effectiveNetAmount = input.netAmount ?? input.grossAmount;
  return `${input.movementType}|${input.assetId}|${input.grossAmount.toFixed()}|${effectiveNetAmount.toFixed()}`;
}

/**
 * Canonical fee identity material within a transaction.
 *
 * Fee identity is scoped to the fee asset plus fee semantics. Like asset
 * movements, enrichment metadata is excluded on purpose.
 */
export function buildFeeMovementCanonicalMaterial(input: FeeMovementCanonicalMaterialInput): string {
  return `fee|${input.assetId}|${input.amount.toFixed()}|${input.scope}|${input.settlement}`;
}

export interface MovementFingerprintInput {
  txFingerprint: string;
  canonicalMaterial: string;
  duplicateOccurrence: number; // 1-based occurrence within identical canonical-material bucket
}

/**
 * Deterministic movement identity within a transaction.
 *
 * The fingerprint is rooted in canonical semantic movement content, not array
 * ordering. Exact duplicates are intentionally treated as interchangeable and
 * only receive a bucket-local occurrence suffix. The stored value hashes the
 * transaction fingerprint together with canonical material so movement identity
 * stays globally unique without embedding the full transaction fingerprint.
 */
export function computeMovementFingerprint(input: MovementFingerprintInput): Result<string, Error> {
  const { txFingerprint, canonicalMaterial, duplicateOccurrence } = input;
  const normalizedTxFingerprint = txFingerprint.trim();
  const normalizedCanonicalMaterial = canonicalMaterial.trim();

  if (!txFingerprint || normalizedTxFingerprint === '') {
    return err(new Error('txFingerprint must not be empty'));
  }

  if (!canonicalMaterial || normalizedCanonicalMaterial === '') {
    return err(new Error('canonicalMaterial must not be empty'));
  }

  if (duplicateOccurrence <= 0 || !Number.isInteger(duplicateOccurrence)) {
    return err(new Error(`duplicateOccurrence must be a positive integer, got ${duplicateOccurrence}`));
  }

  const compositeHashResult = sha256Result(`${normalizedTxFingerprint}|${normalizedCanonicalMaterial}`);
  if (compositeHashResult.isErr()) {
    return err(compositeHashResult.error);
  }

  return ok(`movement:${compositeHashResult.value}:${duplicateOccurrence}`);
}
