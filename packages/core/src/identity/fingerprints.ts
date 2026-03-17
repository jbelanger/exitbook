import { err, ok, type Result } from '../result/index.js';
import { getErrorMessage } from '../utils/index.js';

// ---------------------------------------------------------------------------
// Shared hashing utility (Web Crypto — runtime-agnostic)
// ---------------------------------------------------------------------------

async function sha256Hex(material: string): Promise<Result<string, Error>> {
  try {
    if (!globalThis.crypto?.subtle) {
      return err(new Error('Web Crypto API is not available'));
    }

    const encoded = new TextEncoder().encode(material);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return ok(
      Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  } catch (error) {
    return err(new Error(`Failed to compute SHA-256 fingerprint: ${getErrorMessage(error)}`));
  }
}

// ---------------------------------------------------------------------------
// Account fingerprint
// ---------------------------------------------------------------------------

export interface AccountFingerprintInput {
  accountType: string;
  sourceName: string;
  identifier: string;
}

/**
 * Stable account identity fingerprint.
 *
 * Derived from semantic account identity material — not database IDs.
 * Deterministic across rebuilds for the same account type/source/identifier.
 */
export async function computeAccountFingerprint(input: AccountFingerprintInput): Promise<Result<string, Error>> {
  const { accountType, sourceName, identifier } = input;
  const trimmedAccountType = accountType.trim();
  const trimmedSourceName = sourceName.trim();
  const trimmedIdentifier = identifier.trim();

  if (trimmedAccountType === '') {
    return err(new Error('accountType must not be empty'));
  }

  if (trimmedSourceName === '') {
    return err(new Error('sourceName must not be empty'));
  }

  if (trimmedIdentifier === '') {
    return err(new Error('identifier must not be empty'));
  }

  const material = `${trimmedAccountType}|${trimmedSourceName}|${trimmedIdentifier}`;
  return sha256Hex(material);
}

// ---------------------------------------------------------------------------
// Transaction fingerprint
// ---------------------------------------------------------------------------

export interface TransactionFingerprintInput {
  accountFingerprint: string;
  source: string;
  sourceType: 'blockchain' | 'exchange';
  blockchainTransactionHash?: string | undefined;
  componentEventIds?: string[] | undefined;
}

/**
 * Canonical transaction fingerprint — the only processed transaction identifier.
 *
 * Blockchain: sha256(accountFingerprint|blockchain|source|transactionHash)
 * Exchange:   sha256(accountFingerprint|exchange|source|sortedEventId1|sortedEventId2|...)
 */
export async function computeTxFingerprint(input: TransactionFingerprintInput): Promise<Result<string, Error>> {
  const { accountFingerprint, source, sourceType } = input;
  const trimmedAccountFingerprint = accountFingerprint.trim();
  const trimmedSource = source.trim();

  if (trimmedAccountFingerprint === '') {
    return err(new Error('accountFingerprint must not be empty'));
  }

  if (trimmedSource === '') {
    return err(new Error('source must not be empty'));
  }

  if (sourceType === 'blockchain') {
    const hash = input.blockchainTransactionHash;
    if (!hash || hash.trim() === '') {
      return err(new Error('blockchainTransactionHash is required for blockchain transactions'));
    }
    const material = `${trimmedAccountFingerprint}|blockchain|${trimmedSource}|${hash.trim()}`;
    return sha256Hex(material);
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
  const material = `${trimmedAccountFingerprint}|exchange|${trimmedSource}|${sorted.join('|')}`;
  return sha256Hex(material);
}

// ---------------------------------------------------------------------------
// Movement fingerprint
// ---------------------------------------------------------------------------

export interface MovementFingerprintInput {
  txFingerprint: string;
  movementType: 'inflow' | 'outflow' | 'fee';
  position: number; // 0-based index within movements of this type
}

/**
 * Deterministic movement identity within a transaction.
 * Format: movement:${txFingerprint}:${movementType}:${position}
 */
export function computeMovementFingerprint(input: MovementFingerprintInput): Result<string, Error> {
  const { txFingerprint, movementType, position } = input;

  if (!txFingerprint || txFingerprint.trim() === '') {
    return err(new Error('txFingerprint must not be empty'));
  }

  if (position < 0 || !Number.isInteger(position)) {
    return err(new Error(`position must be a non-negative integer, got ${position}`));
  }

  return ok(`movement:${txFingerprint}:${movementType}:${position}`);
}
