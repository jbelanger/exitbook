import { err, getErrorMessage, ok, type Result, sha256Hex } from '@exitbook/foundation';
import { formatProtocolRef, type ProtocolRef } from '@exitbook/protocol-catalog';

import type { AnnotationKind, AnnotationRole, AnnotationTarget, AnnotationTier } from './annotation-types.js';

export interface AnnotationFingerprintInput {
  kind: AnnotationKind;
  tier: AnnotationTier;
  txFingerprint: string;
  target: AnnotationTarget;
  protocolRef?: ProtocolRef | undefined;
  role?: AnnotationRole | undefined;
  groupKey?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

// Canonicalize metadata as stable JSON with sorted keys so that two detectors
// reaching the same conclusion with the same content produce the same
// fingerprint regardless of insertion order.
function canonicalizeMetadata(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeMetadata(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeMetadata(v)}`);
    return `{${parts.join(',')}}`;
  }
  // Unsupported non-serializable value types (e.g., functions, symbols) fall
  // back to a stable sentinel so we never fail silently while still producing
  // deterministic output. Detectors should never emit such values.
  return '"__unsupported__"';
}

function targetMaterial(target: AnnotationTarget, txFingerprint: string): string {
  if (target.scope === 'transaction') return `tx|${txFingerprint}`;
  return `mv|${target.movementFingerprint}`;
}

/**
 * Deterministic annotation identity. Two detectors that converge on the same
 * fact must produce the same fingerprint. The material intentionally excludes
 * `detector_id`, `derived_from_tx_ids`, and timestamps per the architecture
 * doc's fingerprint-stability section.
 */
export function computeAnnotationFingerprint(input: AnnotationFingerprintInput): Result<string, Error> {
  const material = [
    input.kind,
    input.tier,
    targetMaterial(input.target, input.txFingerprint),
    input.protocolRef ? `proto|${formatProtocolRef(input.protocolRef)}` : 'proto|',
    input.role ?? '',
    input.groupKey ?? '',
    canonicalizeMetadata(input.metadata),
  ].join('|');

  try {
    return ok(`annotation:${sha256Hex(material)}`);
  } catch (error) {
    return err(new Error(`Failed to compute annotation fingerprint: ${getErrorMessage(error)}`));
  }
}
