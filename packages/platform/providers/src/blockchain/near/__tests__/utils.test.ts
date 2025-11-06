import { describe, expect, it } from 'vitest';

import { formatNearAccountId, isValidNearAccountId, nearToYoctoNear, yoctoNearToNear } from '../utils.js';

describe('utils', () => {
  describe('isValidNearAccountId', () => {
    it('should validate correct named NEAR accounts', () => {
      expect(isValidNearAccountId('alice.near')).toBe(true);
      expect(isValidNearAccountId('token.sweat')).toBe(true);
      expect(isValidNearAccountId('my-account.testnet')).toBe(true);
      expect(isValidNearAccountId('sub_account.parent.near')).toBe(true);
      expect(isValidNearAccountId('a1')).toBe(true); // Minimum length
    });

    it('should validate implicit accounts (64-char hex)', () => {
      expect(isValidNearAccountId('98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de')).toBe(true);
      expect(isValidNearAccountId('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')).toBe(true);
      expect(isValidNearAccountId('0000000000000000000000000000000000000000000000000000000000000000')).toBe(true);
    });

    it('should reject invalid addresses - too short', () => {
      expect(isValidNearAccountId('a')).toBe(false);
      expect(isValidNearAccountId('')).toBe(false);
    });

    it('should reject invalid addresses - too long', () => {
      const tooLong = 'a'.repeat(65);
      expect(isValidNearAccountId(tooLong)).toBe(false);
    });

    it('should reject invalid addresses - uppercase letters', () => {
      expect(isValidNearAccountId('Alice.near')).toBe(false);
      expect(isValidNearAccountId('ALICE.NEAR')).toBe(false);
      expect(isValidNearAccountId('MyAccount.testnet')).toBe(false);
    });

    it('should reject invalid addresses - invalid characters', () => {
      expect(isValidNearAccountId('alice@near')).toBe(false);
      expect(isValidNearAccountId('alice near')).toBe(false);
      expect(isValidNearAccountId('alice!near')).toBe(false);
      expect(isValidNearAccountId('alice#near')).toBe(false);
    });

    it('should reject invalid implicit accounts - wrong length hex', () => {
      expect(isValidNearAccountId('98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6d')).toBe(false); // 63 chars
      expect(isValidNearAccountId('98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6dea')).toBe(false); // 65 chars
    });

    it('should reject invalid implicit accounts - uppercase hex', () => {
      expect(isValidNearAccountId('98793CD91A3F870FB126F66285808C7E094AFCFC4EDA8A970F6648CDF0DBD6DE')).toBe(false);
    });

    it('should reject invalid implicit accounts - non-hex characters', () => {
      expect(isValidNearAccountId('98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6dg')).toBe(false); // 'g' is not hex
      expect(isValidNearAccountId('98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6d-')).toBe(false); // '-' is not hex
    });
  });

  describe('yoctoNearToNear', () => {
    it('should convert yoctoNEAR to NEAR', () => {
      // 1 NEAR = 10^24 yoctoNEAR
      expect(yoctoNearToNear('1000000000000000000000000').toString()).toBe('1');
      expect(yoctoNearToNear('500000000000000000000000').toString()).toBe('0.5');
      expect(yoctoNearToNear('2500000000000000000000000').toString()).toBe('2.5');
    });

    it('should handle string input', () => {
      expect(yoctoNearToNear('1000000000000000000000000').toString()).toBe('1');
    });

    it('should handle number input', () => {
      expect(yoctoNearToNear(1000000000000000000000000).toString()).toBe('1');
    });

    it('should handle zero', () => {
      expect(yoctoNearToNear(0).toString()).toBe('0');
      expect(yoctoNearToNear('0').toString()).toBe('0');
    });

    it('should handle very small amounts', () => {
      expect(yoctoNearToNear('1').toFixed()).toBe('0.000000000000000000000001');
      expect(yoctoNearToNear('100').toFixed()).toBe('0.0000000000000000000001');
    });

    it('should handle very large amounts', () => {
      // 1 million NEAR
      expect(yoctoNearToNear('1000000000000000000000000000000').toString()).toBe('1000000');
      // 1 billion NEAR
      expect(yoctoNearToNear('1000000000000000000000000000000000').toString()).toBe('1000000000');
    });

    it('should handle fractional results', () => {
      expect(yoctoNearToNear('123456789012345678901234').toString()).toBe('0.123456789012345678901234');
    });
  });

  describe('nearToYoctoNear', () => {
    it('should convert NEAR to yoctoNEAR', () => {
      expect(nearToYoctoNear(1).toFixed()).toBe('1000000000000000000000000');
      expect(nearToYoctoNear(0.5).toFixed()).toBe('500000000000000000000000');
      expect(nearToYoctoNear(2.5).toFixed()).toBe('2500000000000000000000000');
    });

    it('should handle string input', () => {
      expect(nearToYoctoNear('1').toFixed()).toBe('1000000000000000000000000');
    });

    it('should handle number input', () => {
      expect(nearToYoctoNear(1).toFixed()).toBe('1000000000000000000000000');
    });

    it('should handle zero', () => {
      expect(nearToYoctoNear(0).toFixed()).toBe('0');
      expect(nearToYoctoNear('0').toFixed()).toBe('0');
    });

    it('should handle very small amounts', () => {
      expect(nearToYoctoNear('0.000001').toFixed()).toBe('1000000000000000000');
    });

    it('should handle very large amounts', () => {
      expect(nearToYoctoNear('1000000').toFixed()).toBe('1000000000000000000000000000000');
    });

    it('should be reversible with yoctoNearToNear', () => {
      const nearAmount = '123.456789';
      const yoctoAmount = nearToYoctoNear(nearAmount);
      const backToNear = yoctoNearToNear(yoctoAmount.toFixed());
      expect(backToNear.toString()).toBe(nearAmount);
    });
  });

  describe('formatNearAccountId', () => {
    it('should return account ID unchanged (NEAR accounts are case-sensitive)', () => {
      expect(formatNearAccountId('alice.near')).toBe('alice.near');
      expect(formatNearAccountId('token.sweat')).toBe('token.sweat');
      expect(formatNearAccountId('sub_account.parent.near')).toBe('sub_account.parent.near');
    });

    it('should preserve implicit accounts unchanged', () => {
      const implicitAccount = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
      expect(formatNearAccountId(implicitAccount)).toBe(implicitAccount);
    });

    it('should not modify any characters', () => {
      expect(formatNearAccountId('my-test.account_123.near')).toBe('my-test.account_123.near');
    });
  });
});
