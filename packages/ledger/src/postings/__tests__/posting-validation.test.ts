import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { AccountingPostingDraft } from '../posting-draft.js';
import { validateAccountingPostingDraft } from '../posting-validation.js';

const ADA = assertOk(parseCurrency('ADA'));

function createPosting(params: {
  postingStableKey: string;
  quantity: string;
  role: AccountingPostingDraft['role'];
}): AccountingPostingDraft {
  return {
    postingStableKey: params.postingStableKey,
    assetId: 'blockchain:cardano:native',
    assetSymbol: ADA,
    quantity: parseDecimal(params.quantity),
    role: params.role,
    balanceCategory: 'liquid',
    sourceComponentRefs: [
      {
        component: {
          sourceActivityFingerprint: 'source_activity:v1:test',
          componentKind: 'cardano_stake_certificate',
          componentId: 'registration:stake_test:0',
          assetId: 'blockchain:cardano:native',
        },
        quantity: parseDecimal(params.quantity).abs(),
      },
    ],
  };
}

describe('validateAccountingPostingDraft', () => {
  it('accepts protocol deposits as negative refundable outflows', () => {
    assertOk(
      validateAccountingPostingDraft(
        createPosting({
          postingStableKey: 'protocol_deposit:lovelace',
          quantity: '-2',
          role: 'protocol_deposit',
        })
      )
    );
  });

  it('accepts protocol refunds as positive refundable inflows', () => {
    assertOk(
      validateAccountingPostingDraft(
        createPosting({
          postingStableKey: 'protocol_refund:lovelace',
          quantity: '2',
          role: 'protocol_refund',
        })
      )
    );
  });

  it('rejects protocol deposits with inflow quantity', () => {
    const error = assertErr(
      validateAccountingPostingDraft(
        createPosting({
          postingStableKey: 'protocol_deposit:lovelace',
          quantity: '2',
          role: 'protocol_deposit',
        })
      )
    );

    expect(error.message).toContain('role protocol_deposit is incompatible with quantity 2');
  });

  it('rejects protocol refunds with outflow quantity', () => {
    const error = assertErr(
      validateAccountingPostingDraft(
        createPosting({
          postingStableKey: 'protocol_refund:lovelace',
          quantity: '-2',
          role: 'protocol_refund',
        })
      )
    );

    expect(error.message).toContain('role protocol_refund is incompatible with quantity -2');
  });

  it('accepts opening positions as positive balance snapshot lots', () => {
    assertOk(
      validateAccountingPostingDraft({
        ...createPosting({
          postingStableKey: 'opening_position:lovelace',
          quantity: '42',
          role: 'opening_position',
        }),
        balanceCategory: 'liquid',
        sourceComponentRefs: [
          {
            component: {
              sourceActivityFingerprint: 'source_activity:v1:opening',
              componentKind: 'balance_snapshot',
              componentId: 'account:cutoff:blockchain:cardano:native:liquid',
              assetId: 'blockchain:cardano:native',
            },
            quantity: parseDecimal('42'),
          },
        ],
      })
    );
  });
});
