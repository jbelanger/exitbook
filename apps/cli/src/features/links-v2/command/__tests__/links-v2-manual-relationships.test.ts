import { parseCurrency } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildLinksV2ManualRelationshipAcceptPayload } from '../links-v2-manual-relationships.js';

describe('buildLinksV2ManualRelationshipAcceptPayload', () => {
  it('builds allocation-native manual relationship payloads from source and target postings', () => {
    const result = buildLinksV2ManualRelationshipAcceptPayload({
      candidates: makeCandidates(),
      reason: 'RNDR to RENDER migration evidence',
      relationshipKind: 'asset_migration',
      sourcePostingFingerprint: 'ledger_posting:v1:source',
      targetPostingFingerprint: 'ledger_posting:v1:target',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      allocations: [
        {
          allocation_side: 'source',
          asset_id: 'exchange:kucoin:rndr',
          asset_symbol: 'RNDR',
          posting_fingerprint: 'ledger_posting:v1:source',
          quantity: '19.5536',
        },
        {
          allocation_side: 'target',
          asset_id: 'blockchain:ethereum:render',
          asset_symbol: 'RENDER',
          posting_fingerprint: 'ledger_posting:v1:target',
          quantity: '19.5536',
        },
      ],
      evidence: {
        reason: 'RNDR to RENDER migration evidence',
        sourceCandidateId: 1,
        targetCandidateId: 2,
      },
      proposal_kind: 'manual_relationship',
      relationship_kind: 'asset_migration',
      type: 'ledger_linking_relationship_accept',
    });
    expect(result.value.review_id).toMatch(/^manual_[a-f0-9]{12}$/);
  });

  it('rejects manual quantities that overclaim a posting', () => {
    const result = buildLinksV2ManualRelationshipAcceptPayload({
      candidates: makeCandidates(),
      reason: 'overclaim',
      relationshipKind: 'internal_transfer',
      sourcePostingFingerprint: 'ledger_posting:v1:source',
      sourceQuantity: '20',
      targetPostingFingerprint: 'ledger_posting:v1:target',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected overclaimed manual relationship to fail');
    }
    expect(result.error.message).toContain('overclaims posting ledger_posting:v1:source');
  });
});

function makeCandidates() {
  return [
    {
      activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
      amount: new Decimal('19.5536'),
      assetId: 'exchange:kucoin:rndr',
      assetSymbol: currency('RNDR'),
      blockchainTransactionHash: undefined,
      candidateId: 1,
      direction: 'source',
      fromAddress: undefined,
      journalDiagnosticCodes: ['possible_asset_migration'],
      journalFingerprint: 'ledger_journal:v1:source',
      ownerAccountId: 1,
      platformKey: 'kucoin',
      platformKind: 'exchange',
      postingFingerprint: 'ledger_posting:v1:source',
      sourceActivityFingerprint: 'source_activity:v1:source',
      toAddress: undefined,
    },
    {
      activityDatetime: new Date('2026-04-23T00:05:00.000Z'),
      amount: new Decimal('19.5536'),
      assetId: 'blockchain:ethereum:render',
      assetSymbol: currency('RENDER'),
      blockchainTransactionHash: '0xrender',
      candidateId: 2,
      direction: 'target',
      fromAddress: '0xfrom',
      journalDiagnosticCodes: ['possible_asset_migration'],
      journalFingerprint: 'ledger_journal:v1:target',
      ownerAccountId: 2,
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      postingFingerprint: 'ledger_posting:v1:target',
      sourceActivityFingerprint: 'source_activity:v1:target',
      toAddress: '0xto',
    },
  ] as const;
}

function currency(symbol: string) {
  const result = parseCurrency(symbol);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}
