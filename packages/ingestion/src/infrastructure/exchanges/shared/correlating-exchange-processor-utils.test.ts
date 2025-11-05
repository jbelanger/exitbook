import { describe, expect, it } from 'vitest';

import type { FeeInput, MovementInput } from './strategies/index.ts';
import type { ExchangeFundFlow } from './types.ts';
import {
  classifyExchangeOperationFromFundFlow,
  consolidateExchangeFees,
  consolidateExchangeMovements,
  detectExchangeClassificationUncertainty,
  determinePrimaryDirection,
  selectPrimaryMovement,
} from './correlating-exchange-processor-utils.ts';

describe('correlating-exchange-processor-utils', () => {
  describe('selectPrimaryMovement', () => {
    it('should select largest inflow when inflows exist', () => {
      const inflows: MovementInput[] = [
        { asset: 'BTC', grossAmount: '0.5', netAmount: '0.5' },
        { asset: 'ETH', grossAmount: '10.0', netAmount: '10.0' },
        { asset: 'USD', grossAmount: '1.0', netAmount: '1.0' },
      ];
      const outflows: MovementInput[] = [];

      const result = selectPrimaryMovement(inflows, outflows);

      expect(result).toEqual({ amount: '10.0', asset: 'ETH' });
    });

    it('should select largest outflow when no inflows', () => {
      const inflows: MovementInput[] = [];
      const outflows: MovementInput[] = [
        { asset: 'BTC', grossAmount: '0.5', netAmount: '0.5' },
        { asset: 'ETH', grossAmount: '10.0', netAmount: '10.0' },
        { asset: 'USD', grossAmount: '1.0', netAmount: '1.0' },
      ];

      const result = selectPrimaryMovement(inflows, outflows);

      expect(result).toEqual({ amount: '10.0', asset: 'ETH' });
    });

    it('should prefer inflow over outflow', () => {
      const inflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '1.0', netAmount: '1.0' }];
      const outflows: MovementInput[] = [{ asset: 'ETH', grossAmount: '100.0', netAmount: '100.0' }];

      const result = selectPrimaryMovement(inflows, outflows);

      expect(result).toEqual({ amount: '1.0', asset: 'BTC' });
    });

    it('should skip zero amounts', () => {
      const inflows: MovementInput[] = [
        { asset: 'DUST', grossAmount: '0', netAmount: '0' },
        { asset: 'BTC', grossAmount: '0.5', netAmount: '0.5' },
      ];
      const outflows: MovementInput[] = [];

      const result = selectPrimaryMovement(inflows, outflows);

      expect(result).toEqual({ amount: '0.5', asset: 'BTC' });
    });

    it('should return UNKNOWN when no movements', () => {
      const result = selectPrimaryMovement([], []);

      expect(result).toEqual({ amount: '0', asset: 'UNKNOWN' });
    });

    it('should handle all zero amounts', () => {
      const inflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '0', netAmount: '0' }];
      const outflows: MovementInput[] = [{ asset: 'ETH', grossAmount: '0', netAmount: '0' }];

      const result = selectPrimaryMovement(inflows, outflows);

      expect(result.amount).toBe('0');
    });
  });

  describe('consolidateExchangeMovements', () => {
    it('should consolidate duplicate assets by summing amounts', () => {
      const movements: MovementInput[] = [
        { asset: 'BTC', grossAmount: '1.0', netAmount: '1.0' },
        { asset: 'BTC', grossAmount: '0.5', netAmount: '0.5' },
        { asset: 'ETH', grossAmount: '10.0', netAmount: '9.5' },
      ];

      const result = consolidateExchangeMovements(movements);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        asset: 'BTC',
        amount: '1.5',
        grossAmount: '1.5',
        netAmount: '1.5',
      });
      expect(result).toContainEqual({
        asset: 'ETH',
        amount: '10',
        grossAmount: '10',
        netAmount: '9.5',
      });
    });

    it('should handle single movement', () => {
      const movements: MovementInput[] = [{ asset: 'BTC', grossAmount: '1.0', netAmount: '0.99' }];

      const result = consolidateExchangeMovements(movements);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        asset: 'BTC',
        amount: '1',
        grossAmount: '1',
        netAmount: '0.99',
      });
    });

    it('should handle empty array', () => {
      const result = consolidateExchangeMovements([]);

      expect(result).toEqual([]);
    });

    it('should sum netAmount correctly when different from grossAmount', () => {
      const movements: MovementInput[] = [
        { asset: 'BTC', grossAmount: '1.0', netAmount: '0.95' },
        { asset: 'BTC', grossAmount: '2.0', netAmount: '1.9' },
      ];

      const result = consolidateExchangeMovements(movements);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        asset: 'BTC',
        amount: '3',
        grossAmount: '3',
        netAmount: '2.85',
      });
    });

    it('should default netAmount to grossAmount when not provided', () => {
      const movements: MovementInput[] = [
        { asset: 'BTC', grossAmount: '1.0' },
        { asset: 'BTC', grossAmount: '0.5' },
      ];

      const result = consolidateExchangeMovements(movements);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        asset: 'BTC',
        amount: '1.5',
        grossAmount: '1.5',
        netAmount: '1.5',
      });
    });
  });

  describe('consolidateExchangeFees', () => {
    it('should consolidate fees by asset, scope, and settlement', () => {
      const fees: FeeInput[] = [
        { asset: 'BTC', amount: '0.001', scope: 'platform', settlement: 'balance' },
        { asset: 'BTC', amount: '0.002', scope: 'platform', settlement: 'balance' },
        { asset: 'ETH', amount: '0.01', scope: 'network', settlement: 'on-chain' },
      ];

      const result = consolidateExchangeFees(fees);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        asset: 'BTC',
        amount: '0.003',
        scope: 'platform',
        settlement: 'balance',
      });
      expect(result).toContainEqual({
        asset: 'ETH',
        amount: '0.01',
        scope: 'network',
        settlement: 'on-chain',
      });
    });

    it('should not consolidate fees with different scope', () => {
      const fees: FeeInput[] = [
        { asset: 'BTC', amount: '0.001', scope: 'platform', settlement: 'balance' },
        { asset: 'BTC', amount: '0.002', scope: 'network', settlement: 'balance' },
      ];

      const result = consolidateExchangeFees(fees);

      expect(result).toHaveLength(2);
    });

    it('should not consolidate fees with different settlement', () => {
      const fees: FeeInput[] = [
        { asset: 'BTC', amount: '0.001', scope: 'platform', settlement: 'balance' },
        { asset: 'BTC', amount: '0.002', scope: 'platform', settlement: 'on-chain' },
      ];

      const result = consolidateExchangeFees(fees);

      expect(result).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const result = consolidateExchangeFees([]);

      expect(result).toEqual([]);
    });

    it('should handle single fee', () => {
      const fees: FeeInput[] = [{ asset: 'BTC', amount: '0.001', scope: 'platform', settlement: 'balance' }];

      const result = consolidateExchangeFees(fees);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        asset: 'BTC',
        amount: '0.001',
        scope: 'platform',
        settlement: 'balance',
      });
    });
  });

  describe('classifyExchangeOperationFromFundFlow', () => {
    it('should classify single asset swap (different assets)', () => {
      const fundFlow: ExchangeFundFlow = {
        inflows: [{ asset: 'BTC', grossAmount: '1.0' }],
        outflows: [{ asset: 'USD', grossAmount: '50000' }],
        fees: [],
        primary: { asset: 'BTC', amount: '1.0' },
        correlationId: 'tx1',
        entryCount: 2,
        timestamp: Date.now(),
      };

      const result = classifyExchangeOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({
        category: 'trade',
        type: 'swap',
      });
      expect(result.note).toBeUndefined();
    });

    it('should classify simple deposit', () => {
      const fundFlow: ExchangeFundFlow = {
        inflows: [{ asset: 'BTC', grossAmount: '1.0' }],
        outflows: [],
        fees: [],
        primary: { asset: 'BTC', amount: '1.0' },
        correlationId: 'tx1',
        entryCount: 1,
        timestamp: Date.now(),
      };

      const result = classifyExchangeOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({
        category: 'transfer',
        type: 'deposit',
      });
    });

    it('should classify simple withdrawal', () => {
      const fundFlow: ExchangeFundFlow = {
        inflows: [],
        outflows: [{ asset: 'BTC', grossAmount: '1.0' }],
        fees: [],
        primary: { asset: 'BTC', amount: '1.0' },
        correlationId: 'tx1',
        entryCount: 1,
        timestamp: Date.now(),
      };

      const result = classifyExchangeOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({
        category: 'transfer',
        type: 'withdrawal',
      });
    });

    it('should classify self-transfer (same asset in and out)', () => {
      const fundFlow: ExchangeFundFlow = {
        inflows: [{ asset: 'BTC', grossAmount: '1.0' }],
        outflows: [{ asset: 'BTC', grossAmount: '0.5' }],
        fees: [],
        primary: { asset: 'BTC', amount: '1.0' },
        correlationId: 'tx1',
        entryCount: 2,
        timestamp: Date.now(),
      };

      const result = classifyExchangeOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({
        category: 'transfer',
        type: 'transfer',
      });
    });

    it('should classify fee-only entry', () => {
      const fundFlow: ExchangeFundFlow = {
        inflows: [],
        outflows: [],
        fees: [{ asset: 'BTC', amount: '0.001', scope: 'platform', settlement: 'balance' }],
        primary: { asset: 'BTC', amount: '0.001' },
        correlationId: 'tx1',
        entryCount: 1,
        timestamp: Date.now(),
      };

      const result = classifyExchangeOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({
        category: 'fee',
        type: 'fee',
      });
    });

    it('should classify complex multi-asset with uncertainty', () => {
      const fundFlow: ExchangeFundFlow = {
        inflows: [
          { asset: 'BTC', grossAmount: '1.0' },
          { asset: 'ETH', grossAmount: '10.0' },
        ],
        outflows: [{ asset: 'USD', grossAmount: '50000' }],
        fees: [],
        primary: { asset: 'BTC', amount: '1.0' },
        correlationId: 'tx1',
        entryCount: 3,
        timestamp: Date.now(),
        classificationUncertainty: 'Complex transaction with 1 outflow(s) and 2 inflow(s)',
      };

      const result = classifyExchangeOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({
        category: 'transfer',
        type: 'transfer',
      });
      expect(result.note).toBeDefined();
      expect(result.note?.type).toBe('classification_uncertain');
      expect(result.note?.severity).toBe('info');
    });

    it('should handle unclassifiable transactions', () => {
      const fundFlow: ExchangeFundFlow = {
        inflows: [
          { asset: 'BTC', grossAmount: '1.0' },
          { asset: 'ETH', grossAmount: '10.0' },
        ],
        outflows: [
          { asset: 'USD', grossAmount: '50000' },
          { asset: 'USDC', grossAmount: '1000' },
        ],
        fees: [],
        primary: { asset: 'BTC', amount: '1.0' },
        correlationId: 'tx1',
        entryCount: 4,
        timestamp: Date.now(),
      };

      const result = classifyExchangeOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({
        category: 'transfer',
        type: 'transfer',
      });
      expect(result.note).toBeDefined();
      expect(result.note?.type).toBe('classification_failed');
      expect(result.note?.severity).toBe('warning');
    });
  });

  describe('detectExchangeClassificationUncertainty', () => {
    it('should detect uncertainty with multiple inflows', () => {
      const inflows: MovementInput[] = [
        { asset: 'BTC', grossAmount: '1.0' },
        { asset: 'ETH', grossAmount: '10.0' },
      ];
      const outflows: MovementInput[] = [{ asset: 'USD', grossAmount: '50000' }];

      const result = detectExchangeClassificationUncertainty(inflows, outflows);

      expect(result).toBe('Complex transaction with 1 outflow(s) and 2 inflow(s). May be multi-asset swap or batch operation.');
    });

    it('should detect uncertainty with multiple outflows', () => {
      const inflows: MovementInput[] = [{ asset: 'USD', grossAmount: '50000' }];
      const outflows: MovementInput[] = [
        { asset: 'BTC', grossAmount: '1.0' },
        { asset: 'ETH', grossAmount: '10.0' },
      ];

      const result = detectExchangeClassificationUncertainty(inflows, outflows);

      expect(result).toBe('Complex transaction with 2 outflow(s) and 1 inflow(s). May be multi-asset swap or batch operation.');
    });

    it('should not detect uncertainty for simple transactions', () => {
      const inflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '1.0' }];
      const outflows: MovementInput[] = [{ asset: 'USD', grossAmount: '50000' }];

      const result = detectExchangeClassificationUncertainty(inflows, outflows);

      expect(result).toBeUndefined();
    });

    it('should not detect uncertainty for single direction', () => {
      const inflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '1.0' }];
      const outflows: MovementInput[] = [];

      const result = detectExchangeClassificationUncertainty(inflows, outflows);

      expect(result).toBeUndefined();
    });

    it('should not detect uncertainty for empty movements', () => {
      const result = detectExchangeClassificationUncertainty([], []);

      expect(result).toBeUndefined();
    });
  });

  describe('determinePrimaryDirection', () => {
    it('should return inflow when primary asset is in inflows', () => {
      const inflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '1.0' }];
      const outflows: MovementInput[] = [{ asset: 'USD', grossAmount: '50000' }];

      const result = determinePrimaryDirection(inflows, outflows, 'BTC');

      expect(result).toBe('inflow');
    });

    it('should return outflow when primary asset is in outflows', () => {
      const inflows: MovementInput[] = [{ asset: 'USD', grossAmount: '50000' }];
      const outflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '1.0' }];

      const result = determinePrimaryDirection(inflows, outflows, 'BTC');

      expect(result).toBe('outflow');
    });

    it('should return neutral when primary asset is in both', () => {
      const inflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '1.0' }];
      const outflows: MovementInput[] = [{ asset: 'BTC', grossAmount: '0.5' }];

      const result = determinePrimaryDirection(inflows, outflows, 'BTC');

      expect(result).toBe('neutral');
    });

    it('should return neutral when primary asset is in neither', () => {
      const inflows: MovementInput[] = [{ asset: 'ETH', grossAmount: '10.0' }];
      const outflows: MovementInput[] = [{ asset: 'USD', grossAmount: '50000' }];

      const result = determinePrimaryDirection(inflows, outflows, 'BTC');

      expect(result).toBe('neutral');
    });

    it('should return neutral when both empty', () => {
      const result = determinePrimaryDirection([], [], 'BTC');

      expect(result).toBe('neutral');
    });
  });
});
