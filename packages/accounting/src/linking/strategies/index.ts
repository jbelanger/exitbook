export { AmountTimingStrategy } from './amount-timing-strategy.js';
export { ExactHashStrategy } from './exact-hash-strategy.js';
export { PartialMatchStrategy } from './partial-match-strategy.js';
export { SameHashExternalOutflowStrategy } from './same-hash-external-outflow-strategy.js';
export type { ILinkingStrategy, StrategyResult } from './types.js';

import { AmountTimingStrategy } from './amount-timing-strategy.js';
import { ExactHashStrategy } from './exact-hash-strategy.js';
import { PartialMatchStrategy } from './partial-match-strategy.js';
import { SameHashExternalOutflowStrategy } from './same-hash-external-outflow-strategy.js';
import type { ILinkingStrategy } from './types.js';

/** Default strategy ordering: exact hash → same-hash external groups → heuristic → partial */
export function defaultStrategies(): ILinkingStrategy[] {
  return [
    new ExactHashStrategy(),
    new SameHashExternalOutflowStrategy(),
    new AmountTimingStrategy(),
    new PartialMatchStrategy(),
  ];
}
