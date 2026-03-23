import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

export function buildCanadaTaxPropertyKey(assetIdentityKey: string): Result<string, Error> {
  const normalizedIdentityKey = assetIdentityKey.trim();
  if (normalizedIdentityKey.length === 0) {
    return err(new Error('Canada tax property key requires a non-empty assetIdentityKey'));
  }

  return ok(`ca:${normalizedIdentityKey}`);
}
