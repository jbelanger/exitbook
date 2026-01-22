import type { CostBasisConfig } from '../config/cost-basis-config.js';

import { AverageCostStrategy } from './strategies/average-cost-strategy.js';
import type { ICostBasisStrategy } from './strategies/base-strategy.js';
import { FifoStrategy } from './strategies/fifo-strategy.js';
import { LifoStrategy } from './strategies/lifo-strategy.js';

/**
 * Get strategy instance based on method
 * Pure function - returns strategy implementation for given method
 *
 * @param method - Cost basis calculation method
 * @returns Strategy instance
 * @throws Error if method is not yet implemented
 */
export function getStrategyForMethod(method: CostBasisConfig['method']): ICostBasisStrategy {
  switch (method) {
    case 'fifo': {
      return new FifoStrategy();
    }
    case 'lifo': {
      return new LifoStrategy();
    }
    case 'average-cost': {
      return new AverageCostStrategy();
    }
    case 'specific-id': {
      throw new Error(`specific-id method not yet implemented`);
    }
  }
}
