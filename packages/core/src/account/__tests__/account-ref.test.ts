import { describe, expect, it } from 'vitest';

import { ACCOUNT_FINGERPRINT_REF_LENGTH, formatAccountFingerprintRef } from '../account-ref.js';

describe('formatAccountFingerprintRef', () => {
  it('returns the full fingerprint when it is already short enough', () => {
    expect(formatAccountFingerprintRef('1234567890')).toBe('1234567890');
  });

  it('truncates longer fingerprints to the shared account ref length', () => {
    expect(formatAccountFingerprintRef('1234567890abcdef')).toBe('1234567890');
    expect(formatAccountFingerprintRef('1234567890abcdef')).toHaveLength(ACCOUNT_FINGERPRINT_REF_LENGTH);
  });
});
