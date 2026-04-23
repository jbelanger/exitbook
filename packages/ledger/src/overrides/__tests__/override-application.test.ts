import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { IdentifiedAccountingPostingDraft } from '../../postings/posting-draft.js';
import { applyAccountingOverridePatchToPosting } from '../override-application.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('applyAccountingOverridePatchToPosting', () => {
  it('applies a posting role override', () => {
    const posting: IdentifiedAccountingPostingDraft = {
      postingFingerprint: 'ledger_posting:v1:123',
      postingStableKey: 'posting:1',
      assetId: 'blockchain:ethereum:native',
      assetSymbol: ETH,
      quantity: parseDecimal('-1'),
      role: 'principal',
      sourceComponentRefs: [
        {
          component: {
            sourceActivityFingerprint: 'activity:1',
            componentKind: 'account_delta',
            componentId: 'delta:1',
          },
          quantity: parseDecimal('1'),
        },
      ],
    };

    const nextPosting = assertOk(
      applyAccountingOverridePatchToPosting(
        posting,
        { scope: 'posting', postingFingerprint: 'ledger_posting:v1:123' },
        { kind: 'posting_role', role: 'protocol_overhead' }
      )
    );

    expect(nextPosting.role).toBe('protocol_overhead');
  });

  it('rejects a mismatched posting fingerprint', () => {
    const posting: IdentifiedAccountingPostingDraft = {
      postingFingerprint: 'ledger_posting:v1:123',
      postingStableKey: 'posting:1',
      assetId: 'blockchain:ethereum:native',
      assetSymbol: ETH,
      quantity: parseDecimal('-0.01'),
      role: 'fee',
      settlement: 'on-chain',
      sourceComponentRefs: [
        {
          component: {
            sourceActivityFingerprint: 'activity:1',
            componentKind: 'network_fee',
            componentId: 'fee:1',
          },
          quantity: parseDecimal('0.01'),
        },
      ],
    };

    const error = assertErr(
      applyAccountingOverridePatchToPosting(
        posting,
        { scope: 'posting', postingFingerprint: 'ledger_posting:v1:wrong' },
        { kind: 'posting_settlement', settlement: 'balance' }
      )
    );

    expect(error.message).toContain('mismatch');
  });
});
