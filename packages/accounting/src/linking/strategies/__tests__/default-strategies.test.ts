import { describe, expect, it } from 'vitest';

import { AmountTimingStrategy } from '../amount-timing-strategy.js';
import { BridgeDiagnosticStrategy } from '../bridge-diagnostic-strategy.js';
import { CounterpartyRoundtripStrategy } from '../counterparty-roundtrip-strategy.js';
import { ExactHashStrategy } from '../exact-hash-strategy.js';
import { defaultStrategies } from '../index.js';
import { PartialMatchStrategy } from '../partial-match-strategy.js';
import { SameHashExternalOutflowStrategy } from '../same-hash-external-outflow-strategy.js';

describe('defaultStrategies', () => {
  it('returns 6 strategies', () => {
    const strategies = defaultStrategies();
    expect(strategies).toHaveLength(6);
  });

  it('returns strategies in correct order', () => {
    const strategies = defaultStrategies();

    expect(strategies[0]).toBeInstanceOf(ExactHashStrategy);
    expect(strategies[1]).toBeInstanceOf(SameHashExternalOutflowStrategy);
    expect(strategies[2]).toBeInstanceOf(CounterpartyRoundtripStrategy);
    expect(strategies[3]).toBeInstanceOf(BridgeDiagnosticStrategy);
    expect(strategies[4]).toBeInstanceOf(AmountTimingStrategy);
    expect(strategies[5]).toBeInstanceOf(PartialMatchStrategy);
  });

  it('has correct strategy names in order', () => {
    const strategies = defaultStrategies();
    const names = strategies.map((s) => s.name);

    expect(names).toEqual([
      'exact-hash',
      'same-hash-external-outflow',
      'counterparty-roundtrip',
      'bridge-diagnostic',
      'amount-timing',
      'partial-match',
    ]);
  });
});
