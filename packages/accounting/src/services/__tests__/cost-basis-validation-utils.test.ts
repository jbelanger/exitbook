import type { UniversalTransactionData } from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { PriceValidationResult } from '../cost-basis-validation-utils.js';
import {
  collectPricedEntities,
  validatePriceCompleteness,
  validatePriceCurrency,
  validateFxAuditTrail,
  formatValidationError,
  validateTransactionPrices,
} from '../cost-basis-validation-utils.js';

describe('cost-basis-validation-utils', () => {
  describe('collectPricedEntities', () => {
    it('should collect all inflows, outflows, and fees', () => {
      const tx: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        datetime: '2024-01-15T10:00:00Z',
        timestamp: 1705316400000,
        source: 'test',
        sourceType: 'blockchain',
        status: 'success',
        operation: {
          category: 'trade',
          type: 'buy',
        },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                source: 'test-provider',
                fetchedAt: new Date('2024-01-15T10:00:00Z'),
              },
            },
          ],
          outflows: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD',
              grossAmount: parseDecimal('50000'),
              netAmount: parseDecimal('50000'),
              priceAtTxTime: {
                price: { amount: parseDecimal('1'), currency: Currency.create('USD') },
                source: 'test-provider',
                fetchedAt: new Date('2024-01-15T10:00:00Z'),
              },
            },
          ],
        },
        fees: [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD',
            amount: parseDecimal('10'),
            scope: 'platform',
            settlement: 'balance',
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: Currency.create('USD') },
              source: 'test-provider',
              fetchedAt: new Date('2024-01-15T10:00:00Z'),
            },
          },
        ],
      };

      const entities = collectPricedEntities([tx]);

      expect(entities).toHaveLength(3);
      expect(entities[0]).toMatchObject({
        transactionId: '1',
        assetSymbol: 'BTC',
        kind: 'inflow',
        hasPrice: true,
        currency: 'USD',
      });
      expect(entities[1]).toMatchObject({
        transactionId: '1',
        assetSymbol: 'USD',
        kind: 'outflow',
        hasPrice: true,
        currency: 'USD',
      });
      expect(entities[2]).toMatchObject({
        transactionId: '1',
        assetSymbol: 'USD',
        kind: 'fee',
        hasPrice: true,
        currency: 'USD',
      });
    });

    it('should handle missing price data gracefully', () => {
      const tx: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        datetime: '2024-01-15T10:00:00Z',
        timestamp: 1705316400000,
        source: 'test',
        sourceType: 'blockchain',
        status: 'success',
        operation: {
          category: 'trade',
          type: 'buy',
        },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
              // No priceAtTxTime
            },
          ],
        },
        fees: [],
      };

      const entities = collectPricedEntities([tx]);

      expect(entities).toHaveLength(1);
      expect(entities[0]).toMatchObject({
        hasPrice: false,
        currency: undefined,
        hasFxMetadata: false,
      });
    });

    it('should extract FX metadata when present', () => {
      const tx: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        datetime: '2024-01-15T10:00:00Z',
        timestamp: 1705316400000,
        source: 'test',
        sourceType: 'blockchain',
        status: 'success',
        operation: {
          category: 'trade',
          type: 'buy',
        },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                source: 'test-provider',
                fetchedAt: new Date('2024-01-15T10:00:00Z'),
                fxRateToUSD: parseDecimal('1.35'),
                fxSource: 'ECB',
                fxTimestamp: new Date('2024-01-15T10:00:00Z'),
              },
            },
          ],
        },
        fees: [],
      };

      const entities = collectPricedEntities([tx]);

      expect(entities).toHaveLength(1);
      const entity = entities[0]!;
      expect(entity).toMatchObject({
        hasPrice: true,
        hasFxMetadata: true,
      });
      expect(entity.fxMetadata).toBeDefined();
      expect(entity.fxMetadata).toMatchObject({
        rate: '1.35',
        source: 'ECB',
        timestamp: '2024-01-15T10:00:00.000Z',
      });
    });
  });

  describe('validatePriceCompleteness', () => {
    it('should find entities with missing prices', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                // No price
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validatePriceCompleteness(entities);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        issueType: 'missing_price',
        entity: { assetSymbol: 'BTC', kind: 'inflow' },
      });
    });

    it('should return empty array when all prices present', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validatePriceCompleteness(entities);

      expect(issues).toHaveLength(0);
    });
  });

  describe('validatePriceCurrency', () => {
    it('should find entities with non-USD prices', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('45000'), currency: Currency.create('EUR') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validatePriceCurrency(entities);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        issueType: 'non_usd_currency',
        entity: { assetSymbol: 'BTC', currency: 'EUR', kind: 'inflow' },
      });
    });

    it('should accept USD prices', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validatePriceCurrency(entities);

      expect(issues).toHaveLength(0);
    });

    it('should handle case-insensitive USD check', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('usd') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validatePriceCurrency(entities);

      expect(issues).toHaveLength(0);
    });
  });

  describe('validateFxAuditTrail', () => {
    it('should find entities with incomplete FX metadata', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                  fxRateToUSD: parseDecimal('1.35'),
                  fxSource: 'ECB',
                  // Missing fxTimestamp
                },
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validateFxAuditTrail(entities);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        issueType: 'missing_fx_trail',
        entity: { assetSymbol: 'BTC', kind: 'inflow' },
      });
    });

    it('should accept complete FX metadata', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                  fxRateToUSD: parseDecimal('1.35'),
                  fxSource: 'ECB',
                  fxTimestamp: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validateFxAuditTrail(entities);

      expect(issues).toHaveLength(0);
    });

    it('should not flag entities without FX metadata', () => {
      const entities = collectPricedEntities([
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                  // No fx fields at all - this is fine for native USD prices
                },
              },
            ],
          },
          fees: [],
        },
      ]);

      const issues = validateFxAuditTrail(entities);

      expect(issues).toHaveLength(0);
    });
  });

  describe('formatValidationError', () => {
    it('should format multiple issue types', () => {
      const result: PriceValidationResult = {
        isValid: false,
        issues: [
          {
            entity: {
              transactionId: '1',
              datetime: '2024-01-15T10:00:00Z',
              assetSymbol: 'BTC',
              currency: undefined,
              kind: 'inflow',
              hasPrice: false,
              hasFxMetadata: false,
            },
            issueType: 'missing_price',
            message: 'Missing price',
          },
          {
            entity: {
              transactionId: '2',
              datetime: '2024-01-16T10:00:00Z',
              assetSymbol: 'ETH',
              currency: 'EUR',
              kind: 'outflow',
              hasPrice: true,
              hasFxMetadata: false,
            },
            issueType: 'non_usd_currency',
            message: 'Non-USD currency',
          },
        ],
        summary: {
          totalEntities: 5,
          missingPrices: 1,
          nonUsdPrices: 1,
          missingFxTrails: 0,
          byKind: new Map([
            ['inflow', 2],
            ['outflow', 2],
            ['fee', 1],
          ]),
          byCurrency: new Map([
            ['USD', 3],
            ['EUR', 1],
          ]),
        },
      };

      const errorMessage = formatValidationError(result);

      expect(errorMessage).toContain('Price preflight validation failed');
      expect(errorMessage).toContain('1 price(s) missing');
      expect(errorMessage).toContain('1 price(s) not in USD');
      expect(errorMessage).toContain("Run 'prices enrich'");
      expect(errorMessage).toContain('Tx 1');
      expect(errorMessage).toContain('Tx 2');
    });

    it('should handle FX trail issues', () => {
      const result: PriceValidationResult = {
        isValid: false,
        issues: [
          {
            entity: {
              transactionId: '1',
              datetime: '2024-01-15T10:00:00Z',
              assetSymbol: 'BTC',
              currency: 'USD',
              kind: 'inflow',
              hasPrice: true,
              hasFxMetadata: false,
              fxMetadata: {
                rate: '1.35',
                source: 'ECB',
                timestamp: '',
              },
            },
            issueType: 'missing_fx_trail',
            message: 'Missing FX trail',
          },
        ],
        summary: {
          totalEntities: 1,
          missingPrices: 0,
          nonUsdPrices: 0,
          missingFxTrails: 1,
          byKind: new Map([['inflow', 1]]),
          byCurrency: new Map([['USD', 1]]),
        },
      };

      const errorMessage = formatValidationError(result);

      expect(errorMessage).toContain('1 normalized price(s) missing complete FX audit trail');
    });
  });

  describe('validateTransactionPrices', () => {
    it('should return ok for valid transactions', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD',
                grossAmount: parseDecimal('50000'),
                netAmount: parseDecimal('50000'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('1'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [],
        },
      ];

      const result = validateTransactionPrices(transactions);

      expect(result.isOk()).toBe(true);
    });

    it('should return error for missing prices', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                // No price
              },
            ],
          },
          fees: [],
        },
      ];

      const result = validateTransactionPrices(transactions);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Price preflight validation failed');
        expect(result.error.message).toContain('1 price(s) missing');
      }
    });

    it('should return error for non-USD prices', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('45000'), currency: Currency.create('EUR') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [],
        },
      ];

      const result = validateTransactionPrices(transactions);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Price preflight validation failed');
        expect(result.error.message).toContain('1 price(s) not in USD');
      }
    });

    it('should return error for incomplete FX metadata', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                  fxRateToUSD: parseDecimal('1.35'),
                  fxSource: 'ECB',
                  // Missing fxTimestamp
                },
              },
            ],
          },
          fees: [],
        },
      ];

      const result = validateTransactionPrices(transactions);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Price preflight validation failed');
        expect(result.error.message).toContain('missing complete FX audit trail');
      }
    });

    it('should aggregate multiple issues', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          datetime: '2024-01-15T10:00:00Z',
          timestamp: 1705316400000,
          source: 'test',
          sourceType: 'blockchain',
          status: 'success',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
                // Missing price
              },
            ],
            outflows: [
              {
                assetId: 'test:eth',
                assetSymbol: 'ETH',
                grossAmount: parseDecimal('10.0'),
                netAmount: parseDecimal('10.0'),
                priceAtTxTime: {
                  price: { amount: parseDecimal('3000'), currency: Currency.create('EUR') },
                  source: 'test-provider',
                  fetchedAt: new Date('2024-01-15T10:00:00Z'),
                },
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD',
              amount: parseDecimal('10'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: {
                price: { amount: parseDecimal('1'), currency: Currency.create('USD') },
                source: 'test-provider',
                fetchedAt: new Date('2024-01-15T10:00:00Z'),
                fxRateToUSD: parseDecimal('1.35'),
                fxSource: 'ECB',
                // Incomplete FX metadata
              },
            },
          ],
        },
      ];

      const result = validateTransactionPrices(transactions);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('1 price(s) missing');
        expect(result.error.message).toContain('1 price(s) not in USD');
        expect(result.error.message).toContain('missing complete FX audit trail');
      }
    });
  });
});
