import { err, ok, type Result } from 'neverthrow';

import type { CostBasisConfig } from '../config/cost-basis-config.js';

import { AverageCostStrategy } from './strategies/average-cost-strategy.js';
import type { ICostBasisStrategy } from './strategies/base-strategy.js';
import { FifoStrategy } from './strategies/fifo-strategy.js';
import { LifoStrategy } from './strategies/lifo-strategy.js';

/**
 * Get strategy instance based on method.
 * Pure function — returns strategy implementation for given method.
 */
export function getStrategyForMethod(method: CostBasisConfig['method']): Result<ICostBasisStrategy, Error> {
  switch (method) {
    case 'fifo': {
      return ok(new FifoStrategy());
    }
    case 'lifo': {
      return ok(new LifoStrategy());
    }
    case 'average-cost': {
      return ok(new AverageCostStrategy());
    }
    case 'specific-id': {
      return err(new Error('specific-id cost basis method is not yet implemented'));
    }
  }
}
