import { parseDecimal } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import { CanadaRules } from '../canada-rules.js';

describe('CanadaRules', () => {
  const rules = new CanadaRules();

  describe('getJurisdiction', () => {
    test('should return "CA"', () => {
      expect(rules.getJurisdiction()).toBe('CA');
    });
  });

  describe('classifyGain', () => {
    test('should return undefined for any holding period (no classification in Canada)', () => {
      expect(rules.classifyGain(1)).toBeUndefined();
      expect(rules.classifyGain(100)).toBeUndefined();
      expect(rules.classifyGain(365)).toBeUndefined();
      expect(rules.classifyGain(730)).toBeUndefined();
    });
  });

  describe('calculateTaxableGain', () => {
    test('should return 50% of gain (inclusion rate)', () => {
      const gain = parseDecimal('10000');
      const taxableGain = rules.calculateTaxableGain(gain, 365);

      expect(taxableGain.toString()).toBe('5000');
    });

    test('should return 50% of loss', () => {
      const loss = parseDecimal('-5000');
      const taxableLoss = rules.calculateTaxableGain(loss, 100);

      expect(taxableLoss.toString()).toBe('-2500');
    });

    test('should apply inclusion rate regardless of holding period', () => {
      const gain = parseDecimal('1000');

      // Short holding period
      expect(rules.calculateTaxableGain(gain, 1).toString()).toBe('500');

      // Long holding period
      expect(rules.calculateTaxableGain(gain, 730).toString()).toBe('500');
    });

    test('should handle decimal precision correctly', () => {
      const gain = parseDecimal('12345.678');
      const taxableGain = rules.calculateTaxableGain(gain, 100);

      expect(taxableGain.toString()).toBe('6172.839');
    });
  });

  describe('getLongTermHoldingPeriodDays', () => {
    test('should return undefined (not applicable in Canada)', () => {
      expect(rules.getLongTermHoldingPeriodDays()).toBeUndefined();
    });
  });

  describe('isLossDisallowed - Superficial Loss Rules', () => {
    test('should disallow loss if asset repurchased within 30 days AFTER disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-06-15'), // 14 days after - within 30 day window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });

    test('should disallow loss if asset repurchased within 30 days BEFORE disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-05-15'), // 17 days before - within 30 day window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });

    test('should disallow loss if asset repurchased on same day as disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-06-01'), // Same day
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });

    test('should allow loss if asset repurchased exactly 31 days after disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-07-02'), // 31 days after - outside 30 day window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should allow loss if asset repurchased exactly 31 days before disposal', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-05-01'), // 31 days before - outside 30 day window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(false);
    });

    test('should disallow loss if ANY reacquisition is within the 60-day window', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-04-15'), // 47 days before - outside window
        new Date('2024-05-20'), // 12 days before - INSIDE window
        new Date('2024-07-15'), // 44 days after - outside window
      ];

      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });

    test('should allow loss if all reacquisitions are outside the 60-day window', () => {
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDates = [
        new Date('2024-04-15'), // 47 days before - outside window
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

    test('should handle boundary case: exactly 30 days before disposal', () => {
      const disposalDate = new Date('2024-06-01T12:00:00Z');
      const reacquisitionDates = [
        new Date('2024-05-02T12:00:00Z'), // Exactly 30 days before
      ];

      // The rule is 30 days, so this should be within the window
      expect(rules.isLossDisallowed(disposalDate, reacquisitionDates)).toBe(true);
    });
  });
});
