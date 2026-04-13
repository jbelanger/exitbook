export const ACCOUNT_FINGERPRINT_REF_LENGTH = 10;

export function formatAccountFingerprintRef(accountFingerprint: string): string {
  if (accountFingerprint.length <= ACCOUNT_FINGERPRINT_REF_LENGTH) {
    return accountFingerprint;
  }

  return accountFingerprint.slice(0, ACCOUNT_FINGERPRINT_REF_LENGTH);
}
