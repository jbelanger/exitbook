import { err, type Result } from '@exitbook/foundation';

import { canonicalStringify } from '../internal/canonical-json.js';
import { computeFingerprint } from '../internal/fingerprint-utils.js';

import type { SourceActivityOrigin } from './source-activity-origin.js';

const SOURCE_ACTIVITY_FINGERPRINT_PREFIX = 'source_activity:v1';

export interface SourceActivityFingerprintInput {
  accountFingerprint: string;
  platformKey: string;
  platformKind: 'blockchain' | 'exchange';
  sourceActivityOrigin: SourceActivityOrigin;
  sourceActivityStableKey: string;
}

export function buildSourceActivityFingerprintMaterial(input: SourceActivityFingerprintInput): Result<string, Error> {
  const accountFingerprint = input.accountFingerprint.trim();
  const platformKey = input.platformKey.trim();
  const sourceActivityStableKey = input.sourceActivityStableKey.trim();

  if (accountFingerprint === '') {
    return err(new Error('accountFingerprint must not be empty'));
  }

  if (platformKey === '') {
    return err(new Error('platformKey must not be empty'));
  }

  if (sourceActivityStableKey === '') {
    return err(new Error('sourceActivityStableKey must not be empty'));
  }

  return canonicalStringify({
    accountFingerprint,
    platformKey,
    platformKind: input.platformKind,
    sourceActivityOrigin: input.sourceActivityOrigin,
    sourceActivityStableKey,
  });
}

export function computeSourceActivityFingerprint(input: SourceActivityFingerprintInput): Result<string, Error> {
  const materialResult = buildSourceActivityFingerprintMaterial(input);
  if (materialResult.isErr()) {
    return err(materialResult.error);
  }

  return computeFingerprint(SOURCE_ACTIVITY_FINGERPRINT_PREFIX, materialResult.value);
}
