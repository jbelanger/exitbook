import { err, getErrorMessage, ok, sha256Hex, type Result } from '@exitbook/foundation';

export function computeFingerprint(prefix: string, material: string): Result<string, Error> {
  try {
    return ok(`${prefix}:${sha256Hex(material)}`);
  } catch (error) {
    return err(new Error(`Failed to compute fingerprint ${prefix}: ${getErrorMessage(error)}`));
  }
}
