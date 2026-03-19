import { err, ok, type Result } from '@exitbook/core';

import type { CostBasisConfig } from '../../model/cost-basis-config.js';

import type { ICostBasisStrategy } from './base-strategy.js';
import { FifoStrategy } from './fifo-strategy.js';
import { LifoStrategy } from './lifo-strategy.js';

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
      return err(new Error('average-cost is handled by the Canada workflow, not the standard strategy factory'));
    }
    case 'specific-id': {
      return err(new Error('specific-id cost basis method is not yet implemented'));
    }
    default: {
      const _exhaustive: never = method;
      return err(new Error(`Unsupported cost basis method '${String(_exhaustive)}'`));
    }
  }
}
