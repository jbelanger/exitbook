import { describe, expect, it } from 'vitest';

import * as core from '../index.js';

describe('@exitbook/core root exports', () => {
  it('re-exports balance-impact helpers from the package root', () => {
    expect(core.buildTransactionBalanceImpact).toBeTypeOf('function');
    expect(core.collectTransactionBalanceImpactPricingInputs).toBeTypeOf('function');
  });
});
