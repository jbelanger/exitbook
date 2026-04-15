import { describe, expect, it } from 'vitest';

import { formatMovementFingerprintRef, MOVEMENT_FINGERPRINT_REF_LENGTH } from '../movement-fingerprint-ref.js';

describe('formatMovementFingerprintRef', () => {
  it('formats canonical persisted movement fingerprints as hash-ref plus duplicate occurrence', () => {
    expect(formatMovementFingerprintRef('movement:1234567890abcdef1234567890abcdef:2')).toBe('1234567890:2');
  });

  it('falls back to a plain prefix for non-canonical test fingerprints', () => {
    expect(formatMovementFingerprintRef('inflow:btc:1')).toBe('inflow:btc');
  });

  it('keeps already-short fallback fingerprints unchanged', () => {
    expect(formatMovementFingerprintRef('short-ref')).toBe('short-ref');
  });

  it('uses the configured hash ref length for canonical movement hashes', () => {
    expect(formatMovementFingerprintRef('movement:12345678901234567890:1').split(':')[0]).toHaveLength(
      MOVEMENT_FINGERPRINT_REF_LENGTH
    );
  });
});
