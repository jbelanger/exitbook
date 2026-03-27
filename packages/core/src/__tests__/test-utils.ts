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

type SeedTxPlatformKind = 'blockchain' | 'exchange';

function inferSeedTxPlatformKind(platformKey: string): SeedTxPlatformKind {
  return DEFAULT_BLOCKCHAIN_SOURCES.has(platformKey) ? 'blockchain' : 'exchange';
}

function buildSeedAccountFingerprint(platformKey: string, platformKind: SeedTxPlatformKind, accountId: number): string {
  if (platformKind === 'blockchain') {
    return sha256Hex(`default|wallet|${platformKey}|identifier-${accountId}`);
  }

  return sha256Hex(`default|exchange|${platformKey}`);
}

export function seedTxFingerprint(platformKey: string, accountId: number, identityReference: string): string;
export function seedTxFingerprint(
  platformKey: string,
  platformKind: SeedTxPlatformKind,
  accountId: number,
  identityReference: string
): string;
export function seedTxFingerprint(
  platformKey: string,
  platformKindOrAccountId: SeedTxPlatformKind | number,
  accountIdOrIdentityReference: number | string,
  maybeIdentityReference?: string
): string {
  const platformKind =
    typeof platformKindOrAccountId === 'number' ? inferSeedTxPlatformKind(platformKey) : platformKindOrAccountId;
  const accountId =
    typeof platformKindOrAccountId === 'number' ? platformKindOrAccountId : (accountIdOrIdentityReference as number);
  const identityReference =
    typeof platformKindOrAccountId === 'number' ? accountIdOrIdentityReference : maybeIdentityReference;

  if (typeof identityReference !== 'string') {
    throw new Error('identityReference is required');
  }

  const normalizedIdentityReference = identityReference.trim();
  const accountFingerprint = buildSeedAccountFingerprint(platformKey, platformKind, accountId);
  const canonicalMaterial =
    platformKind === 'blockchain'
      ? `${accountFingerprint}|blockchain|${platformKey}|${normalizedIdentityReference}`
      : `${accountFingerprint}|exchange|${platformKey}|${[normalizedIdentityReference].sort().join('|')}`;

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
