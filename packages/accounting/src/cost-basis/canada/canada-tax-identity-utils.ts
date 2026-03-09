import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';

export function buildCanadaTaxPropertyKey(assetIdentityKey: string): Result<string, Error> {
  const normalizedIdentityKey = assetIdentityKey.trim();
  if (normalizedIdentityKey.length === 0) {
    return err(new Error('Canada tax property key requires a non-empty assetIdentityKey'));
  }

  return ok(`ca:${normalizedIdentityKey}`);
}
