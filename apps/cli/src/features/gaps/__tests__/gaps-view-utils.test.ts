import type { UniversalTransaction } from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { analyzeFeeGaps, formatFeeGapAnalysis, formatGapsViewResult } from '../gaps-view-utils.js';
import type { GapsViewResult } from '../gaps-view-utils.js';

describe('gaps-view-utils', () => {
  const createMockTransaction = (overrides: Partial<UniversalTransaction> = {}): UniversalTransaction => ({
    id: 1,
    externalId: 'tx-123',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: 1704110400000,
    source: 'kraken',
    status: 'success',
    movements: {
      inflows: [],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'withdrawal',
    },
    ...overrides,
  });

  describe('analyzeFeeGaps', () => {
    it('should detect fee without price', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          fees: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: undefined,
            },
          ],
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);

      expect(analysis.summary.total_issues).toBe(1);
      expect(analysis.summary.by_type.fee_without_price).toBe(1);
      expect(analysis.issues[0]!.issue_type).toBe('fee_without_price');
      expect(analysis.issues[0]!.asset).toBe('BTC');
      expect(analysis.issues[0]!.amount).toBe('0.0001');
    });

    it('should detect platform fee without price', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          fees: [
            {
              asset: 'USD',
              amount: parseDecimal('2.50'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: undefined,
            },
          ],
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);

      expect(analysis.summary.total_issues).toBe(1);
      expect(analysis.summary.by_type.fee_without_price).toBe(1);
      expect(analysis.issues[0]!.asset).toBe('USD');
    });

    it('should detect missing fee fields when operation is fee', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          operation: {
            category: 'fee',
            type: 'fee',
          },
          movements: {
            inflows: [],
            outflows: [
              {
                asset: 'ETH',
                grossAmount: parseDecimal('0.01'),
              },
            ],
          },
          fees: [],
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);

      expect(analysis.summary.total_issues).toBe(1);
      expect(analysis.summary.by_type.missing_fee_fields).toBe(1);
      expect(analysis.issues[0]!.issue_type).toBe('missing_fee_fields');
    });

    it('should detect fee in movements when note mentions fees', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          movements: {
            inflows: [
              {
                asset: 'BTC',
                grossAmount: parseDecimal('1.0'),
              },
            ],
            outflows: [
              {
                asset: 'BTC',
                grossAmount: parseDecimal('0.001'),
              },
            ],
          },
          fees: [],
          note: {
            type: 'info',
            message: 'Transaction includes network fee',
          },
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);

      expect(analysis.summary.total_issues).toBe(1);
      expect(analysis.summary.by_type.fee_in_movements).toBe(1);
      expect(analysis.issues[0]!.issue_type).toBe('fee_in_movements');
      expect(analysis.issues[0]!.asset).toBe('BTC');
    });

    it('should not flag outflow if it matches fee field', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          movements: {
            inflows: [],
            outflows: [
              {
                asset: 'BTC',
                grossAmount: parseDecimal('0.0001'),
              },
            ],
          },
          fees: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: {
                price: { amount: parseDecimal('60000'), currency: Currency.create('USD') },
                source: 'exchange-execution',
                fetchedAt: new Date('2024-01-01T12:00:00Z'),
              },
            },
          ],
          note: {
            type: 'info',
            message: 'Network fee applied',
          },
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);

      // Should not flag this as fee_in_movements since it's already in fee field
      expect(analysis.summary.by_type.fee_in_movements).toBe(0);
    });

    it('should return empty analysis for transactions with no issues', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          fees: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: {
                price: { amount: parseDecimal('60000'), currency: Currency.create('USD') },
                source: 'exchange-execution',
                fetchedAt: new Date('2024-01-01T12:00:00Z'),
              },
            },
          ],
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);

      expect(analysis.summary.total_issues).toBe(0);
      expect(analysis.summary.affected_transactions).toBe(0);
      expect(analysis.issues).toHaveLength(0);
    });

    it('should handle multiple issues in same transaction', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          fees: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: undefined,
            },
            {
              asset: 'USD',
              amount: parseDecimal('2.50'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: undefined,
            },
          ],
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);

      expect(analysis.summary.total_issues).toBe(2);
      expect(analysis.summary.affected_transactions).toBe(1);
      expect(analysis.summary.by_type.fee_without_price).toBe(2);
    });

    it('should handle empty transaction list', () => {
      const analysis = analyzeFeeGaps([]);

      expect(analysis.summary.total_issues).toBe(0);
      expect(analysis.summary.affected_transactions).toBe(0);
      expect(analysis.issues).toHaveLength(0);
    });
  });

  describe('formatFeeGapAnalysis', () => {
    it('should format analysis with issues', () => {
      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          fees: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: undefined,
            },
          ],
        }),
      ];

      const analysis = analyzeFeeGaps(transactions);
      const formatted = formatFeeGapAnalysis(analysis);

      expect(formatted).toContain('Fee Gap Analysis');
      expect(formatted).toContain('Total Issues: 1');
      expect(formatted).toContain('Fees without price data');
      expect(formatted).toContain('TX #1');
    });

    it('should format empty analysis', () => {
      const analysis = analyzeFeeGaps([]);
      const formatted = formatFeeGapAnalysis(analysis);

      expect(formatted).toContain('Fee Gap Analysis');
      expect(formatted).toContain('Total Issues: 0');
      expect(formatted).toContain('No fee gaps found');
    });
  });

  describe('formatGapsViewResult', () => {
    it('should format fee category result', () => {
      const result: GapsViewResult = {
        category: 'fees',
        analysis: {
          issues: [],
          summary: {
            total_issues: 0,
            by_type: {
              outflow_without_fee_field: 0,
              fee_without_price: 0,
              missing_fee_fields: 0,
              fee_in_movements: 0,
            },
            affected_transactions: 0,
          },
        },
      };

      const formatted = formatGapsViewResult(result);

      expect(formatted).toContain('Fee Gap Analysis');
    });

    it('should handle unsupported categories', () => {
      const result: GapsViewResult = {
        category: 'prices',
        analysis: {
          issues: [],
          summary: {
            total_issues: 0,
            by_type: {
              outflow_without_fee_field: 0,
              fee_without_price: 0,
              missing_fee_fields: 0,
              fee_in_movements: 0,
            },
            affected_transactions: 0,
          },
        },
      };

      const formatted = formatGapsViewResult(result);

      expect(formatted).toContain('prices');
      expect(formatted).toContain('not yet implemented');
    });
  });
});
