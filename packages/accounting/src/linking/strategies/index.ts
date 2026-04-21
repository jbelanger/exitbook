import { AmountTimingStrategy } from './amount-timing-strategy.js';
import { BridgeAnnotationStrategy } from './bridge-annotation-strategy.js';
import { CounterpartyRoundtripStrategy } from './counterparty-roundtrip-strategy.js';
import { ExactHashStrategy } from './exact-hash-strategy.js';
import { PartialMatchStrategy } from './partial-match-strategy.js';
import { SameHashExternalOutflowStrategy } from './same-hash-external-outflow-strategy.js';
import type { ILinkingStrategy } from './types.js';

/** Default strategy ordering: exact hash → same-hash external groups → counterparty roundtrip → bridge annotation → heuristic → partial */
export function defaultStrategies(): ILinkingStrategy[] {
  return [
    new ExactHashStrategy(),
    new SameHashExternalOutflowStrategy(),
    new CounterpartyRoundtripStrategy(),
    new BridgeAnnotationStrategy(),
    new AmountTimingStrategy(),
    new PartialMatchStrategy(),
  ];
}
