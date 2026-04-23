import { err, type Result } from '@exitbook/foundation';

import { canonicalStringify } from '../internal/canonical-json.js';
import { computeFingerprint } from '../internal/fingerprint-utils.js';

const SOURCE_ACTIVITY_FINGERPRINT_PREFIX = 'source_activity:v1';

export interface SourceActivityFingerprintInput {
  accountFingerprint: string;
  platformKey: string;
  platformKind: 'blockchain' | 'exchange';
  blockchainTransactionHash?: string | undefined;
  componentEventIds?: readonly string[] | undefined;
}

export function buildSourceActivityFingerprintMaterial(input: SourceActivityFingerprintInput): Result<string, Error> {
  const accountFingerprint = input.accountFingerprint.trim();
  const platformKey = input.platformKey.trim();

  if (accountFingerprint === '') {
    return err(new Error('accountFingerprint must not be empty'));
  }

  if (platformKey === '') {
    return err(new Error('platformKey must not be empty'));
  }

  if (input.platformKind === 'blockchain') {
    const blockchainTransactionHash = input.blockchainTransactionHash?.trim();
    if (!blockchainTransactionHash) {
      return err(new Error('blockchainTransactionHash is required for blockchain source activities'));
    }

    return canonicalStringify({
      accountFingerprint,
      blockchainTransactionHash,
      platformKey,
      platformKind: input.platformKind,
    });
  }

  const componentEventIds = input.componentEventIds?.map((eventId) => eventId.trim()).sort();
  if (!componentEventIds || componentEventIds.length === 0) {
    return err(new Error('componentEventIds is required for exchange source activities'));
  }

  if (componentEventIds.some((eventId) => eventId === '')) {
    return err(new Error('componentEventIds must not contain empty values'));
  }

  return canonicalStringify({
    accountFingerprint,
    componentEventIds,
    platformKey,
    platformKind: input.platformKind,
  });
}

export function computeSourceActivityFingerprint(input: SourceActivityFingerprintInput): Result<string, Error> {
  const materialResult = buildSourceActivityFingerprintMaterial(input);
  if (materialResult.isErr()) {
    return err(materialResult.error);
  }

  return computeFingerprint(SOURCE_ACTIVITY_FINGERPRINT_PREFIX, materialResult.value);
}
