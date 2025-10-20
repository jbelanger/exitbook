import { parseDecimal } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import { USRules } from '../us-rules.ts';

describe('USRules', () => {
  const rules = new USRules();

  describe('getJurisdiction', () => {
    test('should return "US"', () => {
      expect(rules.getJurisdiction()).toBe('US');
    });
  });

  describe('classifyGain', () => {
    test('should return "short_term" for holdings less than 365 days', () => {
      expect(rules.classifyGain(1)).toBe('short_term');
      expect(rules.classifyGain(100)).toBe('short_term');
      expect(rules.classifyGain(364)).toBe('short_term');
    });

    test('should return "long_term" for holdings of 365 days or more', () => {
      expect(rules.classifyGain(365)).toBe('long_term');
      expect(rules.classifyGain(366)).toBe('long_term');
      expect(rules.classifyGain(730)).toBe('long_term');
      expect(rules.classifyGain(1000)).toBe('long_term');
    });

    test('should handle boundary case: exactly 365 days', () => {
      expect(rules.classifyGain(365)).toBe('long_term');
    });
  });

  describe('calculateTaxableGain', () => {
    test('should return 100% of gain (no inclusion rate)', () => {
      const gain = parseDecimal('10000');
      const taxableGain = rules.calculateTaxableGain(gain, 365);

      expect(taxableGain.toString()).toBe('10000');
    });

    test('should return 100% of loss', () => {
      const loss = parseDecimal('-5000');
      const taxableLoss = rules.calculateTaxableGain(loss, 100);

      expect(taxableLoss.toString()).toBe('-5000');
    });

    test('should return 100% regardless of holding period (short-term)', () => {
      const gain = parseDecimal('1000');
      const taxableGain = rules.calculateTaxableGain(gain, 100);

      expect(taxableGain.toString()).toBe('1000');
    });

    test('should return 100% regardless of holding period (long-term)', () => {
      const gain = parseDecimal('1000');
      const taxableGain = rules.calculateTaxableGain(gain, 730);

      expect(taxableGain.toString()).toBe('1000');
    });

    test('should preserve decimal precision', () => {
      const gain = parseDecimal('12345.6789');
      const taxableGain = rules.calculateTaxableGain(gain, 365);

      expect(taxableGain.toString()).toBe('12345.6789');
    });
  });

  describe('getLongTermHoldingPeriodDays', () => {
    test('should return 365 days', () => {
      expect(rules.getLongTermHoldingPeriodDays()).toBe(365);
    });
  });

  describe('isLossDisallowed - Wash Sale Rules', () => {
    test('should disallow loss if asset repurchased within 30 days AFTER disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-06-15'), // 14 days after - within 30 day window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });

    test('should allow loss if asset repurchased BEFORE disposal (unlike Canada)', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-05-15'), // 17 days before - NOT covered by US wash sale
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should allow loss if asset repurchased ON disposal date (same day)', () => {
      const disposalDate = new Date('2024-06-01T12:00:00Z');
      const reacquisitionDates = [
        new Date('2024-06-01T12:00:00Z'), // Same timestamp
      ];

      // US wash sale only applies AFTER disposal, not on the same day
      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should allow loss if asset repurchased exactly 31 days after disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-07-02'), // 31 days after - outside 30 day window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should disallow loss if ANY reacquisition is within 30 days after disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-05-15'), // 17 days before - not covered
        new Date('2024-06-10'), // 9 days after - INSIDE window
        new Date('2024-07-15'), // 44 days after - outside window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });

    test('should allow loss if all reacquisitions are before or more than 30 days after', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-05-01'), // Before disposal
        new Date('2024-05-15'), // Before disposal
        new Date('2024-07-15'), // 44 days after - outside window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should allow loss if no reacquisitions occurred', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates: Date[] = [];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should handle boundary case: exactly 30 days after disposal', () => {
      const disposalDate = new Date('2024-06-01T12:00:00Z');
      const reacquisitionDates = [
        new Date('2024-07-01T12:00:00Z'), // Exactly 30 days after
      ];

      // The rule is 30 days, so this should be within the window
      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });

    test('should allow loss for reacquisition immediately before disposal', () => {
      const disposalDate = new Date('2024-06-01T12:00:00Z');
      const reacquisitionDates = [
        new Date('2024-06-01T11:59:59Z'), // 1 second before
      ];

      // US wash sale does not apply to purchases before disposal
      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should disallow loss for reacquisition immediately after disposal', () => {
      const disposalDate = new Date('2024-06-01T12:00:00Z');
      const reacquisitionDates = [
        new Date('2024-06-01T12:00:01Z'), // 1 second after
      ];

      // US wash sale applies to purchases after disposal within 30 days
      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });
  });
});
