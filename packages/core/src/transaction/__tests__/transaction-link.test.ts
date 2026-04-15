import { describe, expect, it } from 'vitest';

import {
  getExplainedTargetResidual,
  getExplainedTargetResidualFromMetadata,
  resolveTransactionLinkProvenance,
} from '../transaction-link.js';

describe('transaction-link helpers', () => {
  it('uses persisted provenance when present', () => {
    expect(
      resolveTransactionLinkProvenance({
        metadata: { linkProvenance: 'manual' },
        reviewedBy: 'human',
      })
    ).toBe('manual');
  });

  it('treats unreviewed or auto-reviewed links as system provenance', () => {
    expect(resolveTransactionLinkProvenance({ metadata: undefined, reviewedBy: undefined })).toBe('system');
    expect(resolveTransactionLinkProvenance({ metadata: undefined, reviewedBy: 'auto' })).toBe('system');
  });

  it('treats user-reviewed links without persisted provenance as user provenance', () => {
    expect(resolveTransactionLinkProvenance({ metadata: undefined, reviewedBy: 'joel' })).toBe('user');
  });

  it('extracts an explained target residual when all links agree', () => {
    const residual = getExplainedTargetResidual([
      {
        metadata: {
          explainedTargetResidualAmount: '10.524451',
          explainedTargetResidualRole: 'staking_reward',
        },
      },
      {
        metadata: {
          explainedTargetResidualAmount: '10.524451',
          explainedTargetResidualRole: 'staking_reward',
        },
      },
    ]);

    expect(residual).toBeDefined();
    expect(residual?.amount.toFixed()).toBe('10.524451');
    expect(residual?.role).toBe('staking_reward');
  });

  it('returns undefined when only some links carry explained residual metadata', () => {
    const residual = getExplainedTargetResidual([
      {
        metadata: {
          explainedTargetResidualAmount: '10.524451',
          explainedTargetResidualRole: 'staking_reward',
        },
      },
      {
        metadata: undefined,
      },
    ]);

    expect(residual).toBeUndefined();
  });

  it('returns undefined when explained residual metadata disagrees across links', () => {
    const residual = getExplainedTargetResidual([
      {
        metadata: {
          explainedTargetResidualAmount: '10.524451',
          explainedTargetResidualRole: 'staking_reward',
        },
      },
      {
        metadata: {
          explainedTargetResidualAmount: '10.524451',
          explainedTargetResidualRole: 'refund_rebate',
        },
      },
    ]);

    expect(residual).toBeUndefined();
  });

  it('extracts one explained target residual from one metadata object', () => {
    const residual = getExplainedTargetResidualFromMetadata({
      explainedTargetResidualAmount: '10.524451',
      explainedTargetResidualRole: 'staking_reward',
    });

    expect(residual?.amount.toFixed()).toBe('10.524451');
    expect(residual?.role).toBe('staking_reward');
  });
});
