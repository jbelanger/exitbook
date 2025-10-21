import { describe, expect, test } from 'vitest';

import { ExchangeLedgerEntrySchema } from '../schemas.ts';

describe('ExchangeLedgerEntrySchema', () => {
  const validEntry = {
    amount: '100',
    asset: 'BTC',
    correlationId: 'REF001',
    id: 'ENTRY001',
    timestamp: 1704067200000, // Jan 1, 2024 in milliseconds
    type: 'trade',
    status: 'success' as const,
  };

  describe('timestamp validation', () => {
    test('accepts valid millisecond timestamp', () => {
      const result = ExchangeLedgerEntrySchema.safeParse(validEntry);
      expect(result.success).toBe(true);
    });

    test('rejects timestamp in seconds (10 digits)', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        timestamp: 1704067200, // Seconds, not milliseconds
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('milliseconds');
      }
    });

    test('rejects floating point timestamp', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        timestamp: 1704067200123.456, // Float
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('int');
      }
    });

    test('rejects negative timestamp', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        timestamp: -1704067200000,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('positive');
      }
    });

    test('rejects timestamp before year 2000', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        timestamp: 946684799999, // Dec 31, 1999 23:59:59.999
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('year 2000');
      }
    });

    test('accepts timestamp exactly at year 2000 + 1ms', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        timestamp: 946684800001, // Jan 1, 2000 00:00:00.001
      });

      expect(result.success).toBe(true);
    });
  });

  describe('required fields', () => {
    test('rejects missing id', () => {
      const { id: _, ...entryWithoutId } = validEntry;
      const result = ExchangeLedgerEntrySchema.safeParse(entryWithoutId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('id');
      }
    });

    test('rejects empty id', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        id: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('not be empty');
      }
    });

    test('rejects missing correlationId', () => {
      const { correlationId: _, ...entryWithoutCorrelationId } = validEntry;
      const result = ExchangeLedgerEntrySchema.safeParse(entryWithoutCorrelationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('correlationId');
      }
    });

    test('rejects empty asset', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        asset: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('not be empty');
      }
    });

    test('rejects empty type', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        type: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('not be empty');
      }
    });
  });

  describe('optional fields', () => {
    test('accepts entry with all optional fields', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        fee: '2.50',
        feeCurrency: 'USD',
        status: 'success',
      });

      expect(result.success).toBe(true);
    });

    test('accepts entry without optional fields', () => {
      const result = ExchangeLedgerEntrySchema.safeParse(validEntry);
      expect(result.success).toBe(true);
    });

    test('accepts undefined fee', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        fee: undefined,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('strict schema (no additional properties)', () => {
    test('rejects exchange-specific fields', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        account: 'ACCOUNT123', // Exchange-specific field
        balance: '1000', // Exchange-specific field
        direction: 'in', // Exchange-specific field
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should have at least one unrecognized key error
        const hasUnrecognizedKey = result.error.issues.some((issue) => issue.code === 'unrecognized_keys');
        expect(hasUnrecognizedKey).toBe(true);
      }
    });
  });

  describe('amount field', () => {
    test('accepts string amount', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        amount: '123.456',
      });

      expect(result.success).toBe(true);
    });

    test('accepts negative amount as string', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        amount: '-100.50',
      });

      expect(result.success).toBe(true);
    });

    test('accepts zero amount', () => {
      const result = ExchangeLedgerEntrySchema.safeParse({
        ...validEntry,
        amount: '0',
      });

      expect(result.success).toBe(true);
    });
  });
});
