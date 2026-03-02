export { AmountTimingStrategy } from './amount-timing-strategy.js';
export { ExactHashStrategy } from './exact-hash-strategy.js';
export { PartialMatchStrategy } from './partial-match-strategy.js';
export type { ILinkingStrategy, StrategyResult } from './types.js';

import { AmountTimingStrategy } from './amount-timing-strategy.js';
import { ExactHashStrategy } from './exact-hash-strategy.js';
import { PartialMatchStrategy } from './partial-match-strategy.js';
import type { ILinkingStrategy } from './types.js';

/** Default strategy ordering: exact hash → heuristic → partial */
export function defaultStrategies(): ILinkingStrategy[] {
  return [new ExactHashStrategy(), new AmountTimingStrategy(), new PartialMatchStrategy()];
}
