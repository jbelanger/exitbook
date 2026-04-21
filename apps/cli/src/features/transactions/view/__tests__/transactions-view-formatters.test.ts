import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { describe, expect, it } from 'vitest';

import {
  buildTransactionFilterLabels,
  formatTransactionFlags,
  formatTransactionAnnotation,
  summarizeTransactionAnnotations,
} from '../transactions-view-formatters.js';

describe('formatTransactionFlags', () => {
  it('renders confirmed scam diagnostics as spam', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: false,
        diagnostics: [{ code: 'SCAM_TOKEN', message: 'confirmed scam', severity: 'error' }],
      })
    ).toBe('spam');
  });

  it('renders suspicious airdrop diagnostics as suspicious', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: false,
        diagnostics: [{ code: 'SUSPICIOUS_AIRDROP', message: 'promo memo', severity: 'warning' }],
      })
    ).toBe('suspicious');
  });

  it('renders excluded alongside scam assessment when both apply', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: true,
        diagnostics: [{ code: 'SCAM_TOKEN', message: 'confirmed scam', severity: 'error' }],
      })
    ).toBe('excluded,spam');
  });

  it('renders an em dash when no flags apply', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: false,
        diagnostics: [],
      })
    ).toBe('—');
  });
});

describe('buildTransactionFilterLabels', () => {
  it('formats annotation filters alongside existing transaction filters', () => {
    expect(
      buildTransactionFilterLabels({
        accountFilter: 'wallet-main',
        annotationKindFilter: 'bridge_participant',
        annotationTierFilter: 'heuristic',
        platformFilter: 'ethereum',
        assetFilter: 'ETH',
        assetIdFilter: undefined,
        addressFilter: '0xabc',
        fromFilter: undefined,
        toFilter: '0xdef',
        operationTypeFilter: 'withdrawal',
        noPriceFilter: true,
      })
    ).toEqual([
      'wallet-main',
      'ethereum',
      'ETH',
      'address=0xabc',
      'to=0xdef',
      'withdrawal',
      'annotation=bridge_participant',
      'tier=heuristic',
      'missing prices',
    ]);
  });
});

describe('formatTransactionAnnotation', () => {
  it('formats bridge annotations with tier, protocol, and bridge metadata', () => {
    expect(
      formatTransactionAnnotation({
        annotationFingerprint: 'annotation-1',
        accountId: 1,
        transactionId: 10,
        txFingerprint: 'eth-bridge-source',
        kind: 'bridge_participant',
        tier: 'asserted',
        target: { scope: 'transaction' },
        protocolRef: { id: 'wormhole' },
        role: 'source',
        detectorId: 'bridge-participant',
        derivedFromTxIds: [10],
        provenanceInputs: ['processor'],
        metadata: {
          counterpartTxFingerprint: 'arb-bridge-target',
          sourceChain: 'ethereum',
          destinationChain: 'arbitrum',
        },
      })
    ).toBe('bridge source [asserted · via wormhole · ethereum -> arbitrum · counterpart arb-bridge]');
  });
});

describe('summarizeTransactionAnnotations', () => {
  it('returns an em dash when no annotations are present', () => {
    expect(summarizeTransactionAnnotations([])).toBe('—');
  });

  it('truncates after two rendered annotations', () => {
    const annotations: TransactionAnnotation[] = [
      {
        annotationFingerprint: 'annotation-1',
        accountId: 1,
        transactionId: 10,
        txFingerprint: 'tx-10',
        kind: 'bridge_participant',
        tier: 'asserted',
        target: { scope: 'transaction' as const },
        role: 'source',
        detectorId: 'bridge-participant',
        derivedFromTxIds: [10],
        provenanceInputs: ['processor'] as const,
      },
      {
        annotationFingerprint: 'annotation-2',
        accountId: 1,
        transactionId: 10,
        txFingerprint: 'tx-10',
        kind: 'bridge_participant',
        tier: 'heuristic',
        target: { scope: 'transaction' as const },
        role: 'target',
        detectorId: 'heuristic-bridge-participant',
        derivedFromTxIds: [10, 11] as const,
        provenanceInputs: ['timing'] as const,
      },
      {
        annotationFingerprint: 'annotation-3',
        accountId: 1,
        transactionId: 10,
        txFingerprint: 'tx-10',
        kind: 'wrap',
        tier: 'asserted',
        target: { scope: 'transaction' as const },
        detectorId: 'wrap-detector',
        derivedFromTxIds: [10] as const,
        provenanceInputs: ['processor'] as const,
      },
    ];

    expect(summarizeTransactionAnnotations(annotations)).toContain('+1 more');
  });
});
