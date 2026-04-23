import { err, type Result } from '@exitbook/foundation';

import { canonicalStringify } from '../internal/canonical-json.js';
import { computeFingerprint } from '../internal/fingerprint-utils.js';

import { SourceComponentRefSchema, type SourceComponentRef } from './source-component-ref.js';

const SOURCE_COMPONENT_FINGERPRINT_PREFIX = 'ledger_source_component:v1';

export function buildSourceComponentFingerprintMaterial(ref: SourceComponentRef): Result<string, Error> {
  const validation = SourceComponentRefSchema.safeParse(ref);
  if (!validation.success) {
    return err(new Error(`Invalid source component ref: ${validation.error.message}`));
  }

  return canonicalStringify({
    assetId: ref.assetId,
    componentId: ref.componentId,
    componentKind: ref.componentKind,
    occurrence: ref.occurrence,
    sourceActivityFingerprint: ref.sourceActivityFingerprint,
  });
}

export function computeSourceComponentFingerprint(ref: SourceComponentRef): Result<string, Error> {
  const materialResult = buildSourceComponentFingerprintMaterial(ref);
  if (materialResult.isErr()) {
    return err(materialResult.error);
  }

  return computeFingerprint(SOURCE_COMPONENT_FINGERPRINT_PREFIX, materialResult.value);
}
