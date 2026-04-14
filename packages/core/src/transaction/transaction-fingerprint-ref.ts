export const TRANSACTION_FINGERPRINT_REF_LENGTH = 10;

export function formatTransactionFingerprintRef(txFingerprint: string): string {
  if (txFingerprint.length <= TRANSACTION_FINGERPRINT_REF_LENGTH) {
    return txFingerprint;
  }

  return txFingerprint.slice(0, TRANSACTION_FINGERPRINT_REF_LENGTH);
}
