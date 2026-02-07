import type { TransactionLink } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { analyzeLinkGaps, formatGapsViewResult, formatLinkGapAnalysis } from '../gaps-view-utils.js';
import type { GapsViewResult } from '../gaps-view-utils.js';

describe('gaps-view-utils', () => {
  const createMockTransaction = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData => ({
    id: 1,
    accountId: 1,
    externalId: 'tx-123',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: 1704110400000,
    source: 'kraken',
    sourceType: 'exchange',
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

  describe('analyzeLinkGaps', () => {
    const createBlockchainDeposit = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData =>
      createMockTransaction({
        id: 11,
        externalId: 'btc-inflow',
        source: 'bitcoin',
        blockchain: {
          name: 'bitcoin',
          transaction_hash: 'hash',
          is_confirmed: true,
        },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('0.8'),
              netAmount: parseDecimal('0.8'),
            },
          ],
          outflows: [],
        },
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
        ...overrides,
      });

    const createBlockchainWithdrawal = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData =>
      createMockTransaction({
        id: 21,
        externalId: 'btc-outflow',
        source: 'bitcoin',
        blockchain: {
          name: 'bitcoin',
          transaction_hash: 'hash-out',
          is_confirmed: true,
        },
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('0.5'),
              netAmount: parseDecimal('0.5'),
            },
          ],
        },
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
        ...overrides,
      });

    const createExchangeWithdrawal = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData =>
      createMockTransaction({
        id: 31,
        externalId: 'kraken-outflow',
        source: 'kraken',
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'test:eth',
              assetSymbol: 'ETH',
              grossAmount: parseDecimal('5'),
              netAmount: parseDecimal('5'),
            },
          ],
        },
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
        ...overrides,
      });

    it('should flag deposits without confirmed links', () => {
      const transactions: UniversalTransactionData[] = [createBlockchainDeposit()];
      const links: TransactionLink[] = [];

      const analysis = analyzeLinkGaps(transactions, links);

      expect(analysis.summary.total_issues).toBe(1);
      expect(analysis.summary.uncovered_inflows).toBe(1);
      expect(analysis.summary.unmatched_outflows).toBe(0);
      expect(analysis.summary.affected_assets).toBe(1);
      expect(analysis.issues[0]!.assetSymbol).toBe('BTC');
      expect(analysis.issues[0]!.missingAmount).toBe('0.8');
      expect(analysis.issues[0]!.totalAmount).toBe('0.8');
      expect(analysis.issues[0]!.direction).toBe('inflow');
      expect(analysis.summary.assets[0]).toStrictEqual({
        assetSymbol: 'BTC',
        inflowOccurrences: 1,
        inflowMissingAmount: '0.8',
        outflowOccurrences: 0,
        outflowMissingAmount: '0',
      });
    });

    it('should treat confirmed links as coverage', () => {
      const transactions: UniversalTransactionData[] = [createBlockchainDeposit()];
      const links: TransactionLink[] = [
        {
          id: 'link-1',
          sourceTransactionId: 5,
          targetTransactionId: 11,
          assetSymbol: 'BTC',
          sourceAmount: parseDecimal('0.8'),
          targetAmount: parseDecimal('0.8'),
          linkType: 'exchange_to_blockchain',
          confidenceScore: parseDecimal('0.97'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.99'),
            timingValid: true,
            timingHours: 6,
            addressMatch: true,
          },
          status: 'confirmed',
          reviewedBy: undefined,
          reviewedAt: undefined,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
          metadata: undefined,
        },
      ];

      const analysis = analyzeLinkGaps(transactions, links);

      expect(analysis.summary.total_issues).toBe(0);
      expect(analysis.summary.uncovered_inflows).toBe(0);
      expect(analysis.summary.unmatched_outflows).toBe(0);
      expect(analysis.summary.assets).toHaveLength(0);
    });

    it('should ignore reward transactions', () => {
      const transactions: UniversalTransactionData[] = [
        createBlockchainDeposit({
          id: 20,
          operation: {
            category: 'staking',
            type: 'reward',
          },
        }),
      ];
      const links: TransactionLink[] = [];

      const analysis = analyzeLinkGaps(transactions, links);

      expect(analysis.summary.total_issues).toBe(0);
      expect(analysis.summary.uncovered_inflows).toBe(0);
      expect(analysis.summary.unmatched_outflows).toBe(0);
    });

    it('should flag withdrawals without confirmed links', () => {
      const transactions: UniversalTransactionData[] = [createBlockchainWithdrawal()];
      const links: TransactionLink[] = [];

      const analysis = analyzeLinkGaps(transactions, links);

      expect(analysis.summary.total_issues).toBe(1);
      expect(analysis.summary.uncovered_inflows).toBe(0);
      expect(analysis.summary.unmatched_outflows).toBe(1);
      expect(analysis.summary.affected_assets).toBe(1);
      const issue = analysis.issues[0]!;
      expect(issue.assetSymbol).toBe('BTC');
      expect(issue.missingAmount).toBe('0.5');
      expect(issue.totalAmount).toBe('0.5');
      expect(issue.direction).toBe('outflow');
      expect(analysis.summary.assets[0]).toStrictEqual({
        assetSymbol: 'BTC',
        inflowOccurrences: 0,
        inflowMissingAmount: '0',
        outflowOccurrences: 1,
        outflowMissingAmount: '0.5',
      });
    });

    it('should treat confirmed links as coverage for withdrawals', () => {
      const withdrawal = createBlockchainWithdrawal({ id: 22, externalId: 'btc-outflow-2' });
      const transactions: UniversalTransactionData[] = [withdrawal];
      const links: TransactionLink[] = [
        {
          id: 'link-out-1',
          sourceTransactionId: withdrawal.id ?? 0,
          targetTransactionId: 42,
          assetSymbol: 'BTC',
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.5'),
          linkType: 'blockchain_to_blockchain',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.99'),
            timingValid: true,
            timingHours: 1,
            addressMatch: true,
          },
          status: 'confirmed',
          reviewedBy: undefined,
          reviewedAt: undefined,
          createdAt: new Date('2024-01-02T00:00:00Z'),
          updatedAt: new Date('2024-01-02T00:00:00Z'),
          metadata: undefined,
        },
      ];

      const analysis = analyzeLinkGaps(transactions, links);

      expect(analysis.summary.total_issues).toBe(0);
      expect(analysis.summary.uncovered_inflows).toBe(0);
      expect(analysis.summary.unmatched_outflows).toBe(0);
    });

    it('should flag exchange withdrawals without confirmed links', () => {
      const transactions: UniversalTransactionData[] = [createExchangeWithdrawal()];
      const links: TransactionLink[] = [];

      const analysis = analyzeLinkGaps(transactions, links);

      expect(analysis.summary.total_issues).toBe(1);
      expect(analysis.summary.uncovered_inflows).toBe(0);
      expect(analysis.summary.unmatched_outflows).toBe(1);
      expect(analysis.summary.affected_assets).toBe(1);
      const issue = analysis.issues[0]!;
      expect(issue.assetSymbol).toBe('ETH');
      expect(issue.direction).toBe('outflow');
      expect(issue.missingAmount).toBe('5');
      expect(issue.totalAmount).toBe('5');
      expect(analysis.summary.assets[0]).toStrictEqual({
        assetSymbol: 'ETH',
        inflowOccurrences: 0,
        inflowMissingAmount: '0',
        outflowOccurrences: 1,
        outflowMissingAmount: '5',
      });
    });

    it('should treat confirmed links as coverage for exchange withdrawals', () => {
      const withdrawal = createExchangeWithdrawal({ id: 32, externalId: 'kraken-outflow-2' });
      const transactions: UniversalTransactionData[] = [withdrawal];
      const links: TransactionLink[] = [
        {
          id: 'link-ex-1',
          sourceTransactionId: withdrawal.id ?? 0,
          targetTransactionId: 77,
          assetSymbol: 'ETH',
          sourceAmount: parseDecimal('5'),
          targetAmount: parseDecimal('5'),
          linkType: 'exchange_to_blockchain',
          confidenceScore: parseDecimal('0.92'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.99'),
            timingValid: true,
            timingHours: 3,
            addressMatch: true,
          },
          status: 'confirmed',
          reviewedBy: undefined,
          reviewedAt: undefined,
          createdAt: new Date('2024-01-03T00:00:00Z'),
          updatedAt: new Date('2024-01-03T00:00:00Z'),
          metadata: undefined,
        },
      ];

      const analysis = analyzeLinkGaps(transactions, links);

      expect(analysis.summary.total_issues).toBe(0);
      expect(analysis.summary.uncovered_inflows).toBe(0);
      expect(analysis.summary.unmatched_outflows).toBe(0);
    });
  });

  describe('formatGapsViewResult', () => {
    it('should format link category result', () => {
      const transactions: UniversalTransactionData[] = [
        createMockTransaction({
          id: 55,
          source: 'bitcoin',
          externalId: 'tx-55',
          blockchain: {
            name: 'bitcoin',
            transaction_hash: 'hash',
            is_confirmed: true,
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('0.3'),
                netAmount: parseDecimal('0.3'),
              },
            ],
            outflows: [],
          },
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        }),
      ];

      const linkAnalysis = analyzeLinkGaps(transactions, []);
      const result: GapsViewResult = {
        category: 'links',
        analysis: linkAnalysis,
      };

      const formatted = formatGapsViewResult(result);

      expect(formatted).toContain('Link Gap Analysis');
      expect(formatted).toContain('Uncovered Inflows: 1');
      expect(formatted).toContain('Unmatched Outflows: 0');
    });

    it('should handle unsupported categories', () => {
      const result = {
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
      } as unknown as GapsViewResult;

      const formatted = formatGapsViewResult(result);

      expect(formatted).toContain('prices');
      expect(formatted).toContain('not yet implemented');
    });
  });

  describe('formatLinkGapAnalysis', () => {
    it('should include actionable guidance', () => {
      const transactions: UniversalTransactionData[] = [
        createMockTransaction({
          id: 77,
          source: 'bitcoin',
          externalId: 'tx-77',
          blockchain: {
            name: 'bitcoin',
            transaction_hash: 'hash',
            is_confirmed: true,
          },
          movements: {
            inflows: [
              {
                assetId: 'test:eth',
                assetSymbol: 'ETH',
                grossAmount: parseDecimal('2.1'),
                netAmount: parseDecimal('2.1'),
              },
            ],
            outflows: [],
          },
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        }),
      ];

      const analysis = analyzeLinkGaps(transactions, []);
      const formatted = formatLinkGapAnalysis(analysis);

      expect(formatted).toContain('Link Gap Analysis');
      expect(formatted).toContain('Unmatched Outflows: 0');
      expect(formatted).toContain('Action');
      expect(formatted).toContain('[ETH][IN]');
    });

    it('should warn about unmatched outflows', () => {
      const transactions: UniversalTransactionData[] = [
        createMockTransaction({
          id: 90,
          source: 'bitcoin',
          externalId: 'tx-90',
          blockchain: {
            name: 'bitcoin',
            transaction_hash: 'hash-90',
            is_confirmed: true,
          },
          movements: {
            inflows: [],
            outflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.25'),
                netAmount: parseDecimal('1.25'),
              },
            ],
          },
          operation: {
            category: 'transfer',
            type: 'withdrawal',
          },
        }),
      ];

      const analysis = analyzeLinkGaps(transactions, []);
      const formatted = formatLinkGapAnalysis(analysis);

      expect(formatted).toContain('[BTC][OUT]');
      expect(formatted).toContain('may be treated as a gift');
    });

    it('should confirm when there are no gaps', () => {
      const transactions: UniversalTransactionData[] = [
        createMockTransaction({
          id: 101,
          source: 'bitcoin',
          externalId: 'tx-101',
          blockchain: {
            name: 'bitcoin',
            transaction_hash: 'hash-101',
            is_confirmed: true,
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('0.2'),
                netAmount: parseDecimal('0.2'),
              },
            ],
            outflows: [],
          },
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        }),
      ];

      const links: TransactionLink[] = [
        {
          id: 'link-101',
          sourceTransactionId: 11,
          targetTransactionId: 101,
          assetSymbol: 'BTC',
          sourceAmount: parseDecimal('0.2'),
          targetAmount: parseDecimal('0.2'),
          linkType: 'exchange_to_blockchain',
          confidenceScore: parseDecimal('0.98'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.99'),
            timingValid: true,
            timingHours: 2,
            addressMatch: true,
          },
          status: 'confirmed',
          reviewedBy: undefined,
          reviewedAt: undefined,
          createdAt: new Date('2024-01-04T00:00:00Z'),
          updatedAt: new Date('2024-01-04T00:00:00Z'),
          metadata: undefined,
        },
      ];

      const analysis = analyzeLinkGaps(transactions, links);
      const formatted = formatLinkGapAnalysis(analysis);

      expect(analysis.summary.total_issues).toBe(0);
      expect(formatted).toContain('All movements have confirmed counterparties. ✅');
    });
  });
});
