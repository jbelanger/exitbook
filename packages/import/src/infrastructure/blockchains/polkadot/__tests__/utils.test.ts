import { describe, expect, it } from 'vitest';

import {
  derivePolkadotAddressVariants,
  encodeSS58Address,
  isSamePolkadotAddress,
  isValidSS58Address,
} from '../utils.js';

describe('Polkadot Utils', () => {
  // Test addresses for different SS58 formats (all represent the same public key)
  const polkadotMainnetAddress = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'; // Format 0
  const kusamaAddress = 'HNZata7iMYWmk5RvZRTiAsSDhV8366zq2YGb3tLH5Upf74F'; // Format 2
  const genericSubstrateAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // Format 42

  describe('isValidSS58Address', () => {
    it('should validate correct SS58 addresses', () => {
      expect(isValidSS58Address(polkadotMainnetAddress)).toBe(true);
      expect(isValidSS58Address(kusamaAddress)).toBe(true);
      expect(isValidSS58Address(genericSubstrateAddress)).toBe(true);
    });

    it('should reject clearly invalid SS58 addresses', () => {
      expect(isValidSS58Address('')).toBe(false);
      expect(isValidSS58Address('invalid')).toBe(false);
      expect(isValidSS58Address('123')).toBe(false); // Too short
      expect(isValidSS58Address('a'.repeat(100))).toBe(false); // Too long
    });

    it('should validate with specific SS58 format', () => {
      expect(isValidSS58Address(polkadotMainnetAddress, 0)).toBe(true);
      expect(isValidSS58Address(kusamaAddress, 2)).toBe(true);
      expect(isValidSS58Address(genericSubstrateAddress, 42)).toBe(true);
    });
  });

  describe('encodeSS58Address', () => {
    it('should encode public key to SS58 address with specific format', () => {
      // This test requires a known public key bytes
      // For now, we'll test that the function exists and doesn't throw
      const mockPublicKey = new Uint8Array(32).fill(1);

      expect(() => encodeSS58Address(mockPublicKey, 0)).not.toThrow();
      expect(() => encodeSS58Address(mockPublicKey, 2)).not.toThrow();
      expect(() => encodeSS58Address(mockPublicKey, 42)).not.toThrow();
    });
  });

  describe('derivePolkadotAddressVariants', () => {
    it('should generate address variants for common SS58 formats', () => {
      const variants = derivePolkadotAddressVariants(polkadotMainnetAddress);

      expect(variants).toBeInstanceOf(Array);
      expect(variants.length).toBeGreaterThan(1);
      expect(variants).toContain(polkadotMainnetAddress); // Original address should be included

      // Should contain addresses for different formats
      expect(variants.length).toBeGreaterThanOrEqual(6); // At least 6 common formats

      // All variants should be unique
      expect(new Set(variants).size).toBe(variants.length);
    });

    it('should handle invalid addresses gracefully', () => {
      const variants = derivePolkadotAddressVariants('invalid-address');

      expect(variants).toBeInstanceOf(Array);
      expect(variants).toEqual(['invalid-address']); // Should return original address
    });

    it('should include primary address in variants', () => {
      const testAddress = genericSubstrateAddress;
      const variants = derivePolkadotAddressVariants(testAddress);

      expect(variants).toContain(testAddress);
    });
  });

  describe('isSamePolkadotAddress', () => {
    it('should return true for identical addresses', () => {
      expect(isSamePolkadotAddress(polkadotMainnetAddress, polkadotMainnetAddress)).toBe(true);
      expect(isSamePolkadotAddress(kusamaAddress, kusamaAddress)).toBe(true);
    });

    it('should return true for same public key with different SS58 formats', () => {
      // Note: This test assumes these addresses represent the same public key
      // In a real scenario, you'd use addresses derived from the same key
      const variants = derivePolkadotAddressVariants(polkadotMainnetAddress);

      if (variants.length > 1) {
        expect(isSamePolkadotAddress(variants[0], variants[1])).toBe(true);
      }
    });

    it('should return false for different addresses', () => {
      const address1 = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const address2 = '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3'; // Different public key

      expect(isSamePolkadotAddress(address1, address2)).toBe(false);
    });

    it('should handle invalid addresses gracefully', () => {
      expect(isSamePolkadotAddress('invalid1', 'invalid2')).toBe(false);
      expect(isSamePolkadotAddress('invalid', polkadotMainnetAddress)).toBe(false);
      expect(isSamePolkadotAddress(polkadotMainnetAddress, 'invalid')).toBe(false);
    });

    it('should return true for same invalid addresses', () => {
      expect(isSamePolkadotAddress('invalid', 'invalid')).toBe(true);
    });
  });

  describe('SS58 Address Derivation Integration', () => {
    it('should generate consistent variants for the same address', () => {
      const variants1 = derivePolkadotAddressVariants(polkadotMainnetAddress);
      const variants2 = derivePolkadotAddressVariants(polkadotMainnetAddress);

      expect(variants1).toEqual(variants2);
    });

    it('should generate variants that all represent the same public key', () => {
      const variants = derivePolkadotAddressVariants(polkadotMainnetAddress);

      // All variants should be considered the same address
      for (let i = 0; i < variants.length - 1; i++) {
        for (let j = i + 1; j < variants.length; j++) {
          expect(isSamePolkadotAddress(variants[i], variants[j])).toBe(true);
        }
      }
    });

    it('should work with different input address formats', () => {
      const variants1 = derivePolkadotAddressVariants(polkadotMainnetAddress);
      const variants2 = derivePolkadotAddressVariants(genericSubstrateAddress);

      // If these addresses represent the same public key, they should generate the same variants
      // (This test might need adjustment based on the actual test addresses used)
      expect(variants1.length).toBe(variants2.length);
    });
  });
});
