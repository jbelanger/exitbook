/**
 * Tests for cost basis utility functions
 *
 * These tests verify the pure business logic for cost basis strategy selection
 * according to the "Functional Core, Imperative Shell" pattern
 */

import { describe, expect, it } from 'vitest';

import { getStrategyForMethod } from '../cost-basis-utils.js';
import { AverageCostStrategy } from '../strategies/average-cost-strategy.js';
import { FifoStrategy } from '../strategies/fifo-strategy.js';
import { LifoStrategy } from '../strategies/lifo-strategy.js';

describe('getStrategyForMethod', () => {
  describe('implemented strategies', () => {
    it('returns FifoStrategy for "fifo" method', () => {
      const result = getStrategyForMethod('fifo');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(FifoStrategy);
    });

    it('returns LifoStrategy for "lifo" method', () => {
      const result = getStrategyForMethod('lifo');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(LifoStrategy);
    });

    it('returns AverageCostStrategy for "average-cost" method', () => {
      const result = getStrategyForMethod('average-cost');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(AverageCostStrategy);
    });
  });

  describe('unimplemented strategies', () => {
    it('returns err for "specific-id" method', () => {
      const result = getStrategyForMethod('specific-id');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('specific-id');
    });
  });

  describe('strategy behavior', () => {
    it('returns different strategy instances for different methods', () => {
      const fifoStrategy = getStrategyForMethod('fifo')._unsafeUnwrap();
      const lifoStrategy = getStrategyForMethod('lifo')._unsafeUnwrap();

      expect(fifoStrategy).not.toBe(lifoStrategy);
      expect(fifoStrategy.constructor).not.toBe(lifoStrategy.constructor);
    });

    it('returns new strategy instances on each call', () => {
      const strategy1 = getStrategyForMethod('fifo')._unsafeUnwrap();
      const strategy2 = getStrategyForMethod('fifo')._unsafeUnwrap();

      expect(strategy1).not.toBe(strategy2);
      expect(strategy1.constructor).toBe(strategy2.constructor);
    });
  });
});
