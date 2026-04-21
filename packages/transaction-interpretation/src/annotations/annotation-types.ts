import { err, ok, type Result } from '@exitbook/foundation';
import type { ProtocolRef } from '@exitbook/protocol-catalog';

export const ANNOTATION_KINDS = [
  'bridge_participant',
  'asset_migration_participant',
  'wrap',
  'unwrap',
  'protocol_deposit',
  'protocol_withdrawal',
  'airdrop_claim',
] as const;

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const ANNOTATION_TIERS = ['asserted', 'heuristic'] as const;

export type AnnotationTier = (typeof ANNOTATION_TIERS)[number];

export const ANNOTATION_ROLES = ['source', 'target', 'claim', 'deposit', 'withdrawal'] as const;

export type AnnotationRole = (typeof ANNOTATION_ROLES)[number];

export const ANNOTATION_PROVENANCE_INPUTS = [
  'processor',
  'diagnostic',
  'movement_role',
  'address_pattern',
  'timing',
  'counterparty',
] as const;

export type AnnotationProvenanceInput = (typeof ANNOTATION_PROVENANCE_INPUTS)[number];

export type AnnotationTarget = { scope: 'transaction' } | { movementFingerprint: string; scope: 'movement' };
export type DerivedFromTxIds = readonly [number, ...number[]];

export function canonicalizeDerivedFromTxIds(derivedFromTxIds: DerivedFromTxIds): DerivedFromTxIds {
  const uniqueSorted = [...new Set(derivedFromTxIds)].sort((left, right) => left - right);
  const first = uniqueSorted.shift();

  return first === undefined ? derivedFromTxIds : [first, ...uniqueSorted];
}

export function toDerivedFromTxIds(ids: readonly number[]): Result<DerivedFromTxIds, Error> {
  const [first, ...rest] = ids;

  if (first === undefined) {
    return err(new Error('derivedFromTxIds must contain at least one transaction id'));
  }

  return ok([first, ...rest]);
}

export interface TransactionAnnotation {
  annotationFingerprint: string;
  accountId: number;
  transactionId: number;
  txFingerprint: string;
  kind: AnnotationKind;
  tier: AnnotationTier;
  target: AnnotationTarget;
  protocolRef?: ProtocolRef | undefined;
  role?: AnnotationRole | undefined;
  groupKey?: string | undefined;
  detectorId: string;
  derivedFromTxIds: DerivedFromTxIds;
  provenanceInputs: readonly AnnotationProvenanceInput[];
  metadata?: Record<string, unknown> | undefined;
}
