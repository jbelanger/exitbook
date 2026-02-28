/**
 * Tests for getStrategyForMethod factory function
 */

import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { AverageCostStrategy } from '../average-cost-strategy.js';
import { FifoStrategy } from '../fifo-strategy.js';
import { LifoStrategy } from '../lifo-strategy.js';
import { getStrategyForMethod } from '../strategy-factory.js';

describe('getStrategyForMethod', () => {
  describe('implemented strategies', () => {
    it('returns FifoStrategy for "fifo" method', () => {
      const result = getStrategyForMethod('fifo');
      const strategy = assertOk(result);

      expect(strategy).toBeInstanceOf(FifoStrategy);
    });

    it('returns LifoStrategy for "lifo" method', () => {
      const result = getStrategyForMethod('lifo');
      const strategy = assertOk(result);

      expect(strategy).toBeInstanceOf(LifoStrategy);
    });

    it('returns AverageCostStrategy for "average-cost" method', () => {
      const result = getStrategyForMethod('average-cost');
      const strategy = assertOk(result);

      expect(strategy).toBeInstanceOf(AverageCostStrategy);
    });
  });

  describe('unimplemented strategies', () => {
    it('returns err for "specific-id" method', () => {
      const result = getStrategyForMethod('specific-id');
      const error = assertErr(result);

      expect(error.message).toContain('specific-id');
    });
  });

  describe('strategy behavior', () => {
    it('returns different strategy instances for different methods', () => {
      const fifoStrategy = assertOk(getStrategyForMethod('fifo'));
      const lifoStrategy = assertOk(getStrategyForMethod('lifo'));

      expect(fifoStrategy).not.toBe(lifoStrategy);
      expect(fifoStrategy.constructor).not.toBe(lifoStrategy.constructor);
    });

    it('returns new strategy instances on each call', () => {
      const strategy1 = assertOk(getStrategyForMethod('fifo'));
      const strategy2 = assertOk(getStrategyForMethod('fifo'));

      expect(strategy1).not.toBe(strategy2);
      expect(strategy1.constructor).toBe(strategy2.constructor);
    });
  });
});
