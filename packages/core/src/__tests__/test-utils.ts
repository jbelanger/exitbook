import { sha256Hex } from '@exitbook/foundation';

import { buildAssetMovementCanonicalMaterial, buildFeeMovementCanonicalMaterial } from '../identity/index.js';
import type { AssetMovementDraft, FeeMovementDraft } from '../transaction/index.js';

const DEFAULT_BLOCKCHAIN_SOURCES = new Set([
  'bitcoin',
  'cardano',
  'cosmos',
  'ethereum',
  'near',
  'solana',
  'substrate',
  'theta',
  'xrp',
]);

type SeedTxSourceType = 'blockchain' | 'exchange';

function inferSeedTxSourceType(source: string): SeedTxSourceType {
  return DEFAULT_BLOCKCHAIN_SOURCES.has(source) ? 'blockchain' : 'exchange';
}

function buildSeedAccountFingerprint(source: string, sourceType: SeedTxSourceType, accountId: number): string {
  if (sourceType === 'blockchain') {
    return sha256Hex(`default|wallet|${source}|identifier-${accountId}`);
  }

  return sha256Hex(`default|exchange|${source}`);
}

export function seedTxFingerprint(source: string, accountId: number, identityReference: string): string;
export function seedTxFingerprint(
  source: string,
  sourceType: SeedTxSourceType,
  accountId: number,
  identityReference: string
): string;
export function seedTxFingerprint(
  source: string,
  sourceTypeOrAccountId: SeedTxSourceType | number,
  accountIdOrIdentityReference: number | string,
  maybeIdentityReference?: string
): string {
  const sourceType = typeof sourceTypeOrAccountId === 'number' ? inferSeedTxSourceType(source) : sourceTypeOrAccountId;
  const accountId =
    typeof sourceTypeOrAccountId === 'number' ? sourceTypeOrAccountId : (accountIdOrIdentityReference as number);
  const identityReference =
    typeof sourceTypeOrAccountId === 'number' ? accountIdOrIdentityReference : maybeIdentityReference;

  if (typeof identityReference !== 'string') {
    throw new Error('identityReference is required');
  }

  const normalizedIdentityReference = identityReference.trim();
  const accountFingerprint = buildSeedAccountFingerprint(source, sourceType, accountId);
  const canonicalMaterial =
    sourceType === 'blockchain'
      ? `${accountFingerprint}|blockchain|${source}|${normalizedIdentityReference}`
      : `${accountFingerprint}|exchange|${source}|${[normalizedIdentityReference].sort().join('|')}`;

  return sha256Hex(canonicalMaterial);
}

export function seedMovementFingerprint(
  txFingerprint: string,
  canonicalMaterial: string,
  duplicateOccurrence: number
): string {
  return `movement:${sha256Hex(`${txFingerprint}|${canonicalMaterial}`)}:${duplicateOccurrence}`;
}

export function seedAssetMovementFingerprint(
  txFingerprint: string,
  movementType: 'inflow' | 'outflow',
  movement: Pick<AssetMovementDraft, 'assetId' | 'grossAmount' | 'netAmount'>,
  duplicateOccurrence = 1
): string {
  return seedMovementFingerprint(
    txFingerprint,
    buildAssetMovementCanonicalMaterial({
      movementType,
      assetId: movement.assetId,
      grossAmount: movement.grossAmount,
      netAmount: movement.netAmount,
    }),
    duplicateOccurrence
  );
}

export function seedFeeMovementFingerprint(
  txFingerprint: string,
  fee: Pick<FeeMovementDraft, 'assetId' | 'amount' | 'scope' | 'settlement'>,
  duplicateOccurrence = 1
): string {
  return seedMovementFingerprint(
    txFingerprint,
    buildFeeMovementCanonicalMaterial({
      assetId: fee.assetId,
      amount: fee.amount,
      scope: fee.scope,
      settlement: fee.settlement,
    }),
    duplicateOccurrence
  );
}
