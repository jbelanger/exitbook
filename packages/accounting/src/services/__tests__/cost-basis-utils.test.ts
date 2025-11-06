/**
 * Tests for cost basis utility functions
 *
 * These tests verify the pure business logic for cost basis strategy selection
 * according to the "Functional Core, Imperative Shell" pattern
 */

import { describe, expect, it } from 'vitest';

import { getStrategyForMethod } from '../cost-basis-utils.js';
import { FifoStrategy } from '../strategies/fifo-strategy.js';
import { LifoStrategy } from '../strategies/lifo-strategy.js';

describe('getStrategyForMethod', () => {
  describe('implemented strategies', () => {
    it('returns FifoStrategy for "fifo" method', () => {
      const strategy = getStrategyForMethod('fifo');

      expect(strategy).toBeInstanceOf(FifoStrategy);
    });

    it('returns LifoStrategy for "lifo" method', () => {
      const strategy = getStrategyForMethod('lifo');

      expect(strategy).toBeInstanceOf(LifoStrategy);
    });
  });

  describe('unimplemented strategies', () => {
    it('throws error for "specific-id" method', () => {
      expect(() => getStrategyForMethod('specific-id')).toThrow('specific-id method not yet implemented');
    });

    it('throws error for "average-cost" method', () => {
      expect(() => getStrategyForMethod('average-cost')).toThrow('average-cost method not yet implemented');
    });
  });

  describe('strategy behavior', () => {
    it('returns different strategy instances for different methods', () => {
      const fifoStrategy = getStrategyForMethod('fifo');
      const lifoStrategy = getStrategyForMethod('lifo');

      expect(fifoStrategy).not.toBe(lifoStrategy);
      expect(fifoStrategy.constructor).not.toBe(lifoStrategy.constructor);
    });

    it('returns new strategy instances on each call', () => {
      const strategy1 = getStrategyForMethod('fifo');
      const strategy2 = getStrategyForMethod('fifo');

      // Each call should return a new instance
      expect(strategy1).not.toBe(strategy2);
      // But they should be the same type
      expect(strategy1.constructor).toBe(strategy2.constructor);
    });
  });
});
