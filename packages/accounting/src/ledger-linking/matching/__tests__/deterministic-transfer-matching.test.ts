import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildLedgerLinkingAssetIdentityResolver } from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import {
  buildLedgerExactHashTransferRelationships,
  ledgerTransactionHashesMatch,
} from '../deterministic-transfer-matching.js';

const ETH = assertOk(parseCurrency('ETH'));
const USDC = assertOk(parseCurrency('USDC'));

describe('ledgerTransactionHashesMatch', () => {
  it('matches hex hashes case-insensitively and strips one-sided log indexes', () => {
    expect(ledgerTransactionHashesMatch('0xABC123-819', '0xabc123')).toBe(true);
  });

  it('requires exact log indexes when both hashes carry them', () => {
    expect(ledgerTransactionHashesMatch('0xabc123-819', '0xabc123-820')).toBe(false);
  });

  it('keeps non-hex hashes case-sensitive', () => {
    expect(ledgerTransactionHashesMatch('AbC123DeFg456', 'abc123defg456')).toBe(false);
  });
});

describe('buildLedgerExactHashTransferRelationships', () => {
  it('builds an internal-transfer relationship for one unambiguous exact-hash pair', () => {
    const result = assertOk(
      buildLedgerExactHashTransferRelationships([
        makeCandidate({
          candidateId: 1,
          direction: 'source',
          sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-outflow',
          journalFingerprint: 'ledger_journal:v1:ethereum-wallet-outflow',
          postingFingerprint: 'ledger_posting:v1:ethereum-wallet-outflow',
          blockchainTransactionHash: '0xabc123',
          ownerAccountId: 1,
        }),
        makeCandidate({
          candidateId: 2,
          direction: 'target',
          sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-inflow',
          journalFingerprint: 'ledger_journal:v1:ethereum-wallet-inflow',
          postingFingerprint: 'ledger_posting:v1:ethereum-wallet-inflow',
          blockchainTransactionHash: '0xABC123',
          ownerAccountId: 2,
        }),
      ])
    );

    expect(result.ambiguities).toEqual([]);
    expect(result.matches).toHaveLength(1);
    const relationshipStableKey = result.relationships[0]?.relationshipStableKey;
    expect(relationshipStableKey).toMatch(/^ledger-linking:exact_hash_transfer:v1:[0-9a-f]{32}$/);
    expect(result.relationships).toEqual([
      {
        allocations: [
          {
            allocationSide: 'source',
            sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-outflow',
            journalFingerprint: 'ledger_journal:v1:ethereum-wallet-outflow',
            postingFingerprint: 'ledger_posting:v1:ethereum-wallet-outflow',
            quantity: parseDecimal('1.25'),
          },
          {
            allocationSide: 'target',
            sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-inflow',
            journalFingerprint: 'ledger_journal:v1:ethereum-wallet-inflow',
            postingFingerprint: 'ledger_posting:v1:ethereum-wallet-inflow',
            quantity: parseDecimal('1.25'),
          },
        ],
        confidenceScore: parseDecimal('1'),
        evidence: {
          amount: '1.25',
          assetIdentityReason: 'same_asset_id',
          sourceAssetId: 'blockchain:ethereum:native',
          sourceBlockchainTransactionHash: '0xabc123',
          sourcePostingFingerprint: 'ledger_posting:v1:ethereum-wallet-outflow',
          targetAssetId: 'blockchain:ethereum:native',
          targetBlockchainTransactionHash: '0xABC123',
          targetPostingFingerprint: 'ledger_posting:v1:ethereum-wallet-inflow',
        },
        recognitionStrategy: 'exact_hash_transfer',
        relationshipStableKey,
        relationshipKind: 'internal_transfer',
      },
    ]);
    expect(result.matches[0]).toMatchObject({
      strategy: 'exact_hash_transfer',
      sourceCandidateId: 1,
      targetCandidateId: 2,
      assetIdentityResolution: {
        reason: 'same_asset_id',
        status: 'accepted',
      },
      sourceAssetId: 'blockchain:ethereum:native',
      targetAssetId: 'blockchain:ethereum:native',
      amount: '1.25',
    });
  });

  it('does not match candidates with different asset ids, amounts, owner accounts, or source activities', () => {
    const result = assertOk(
      buildLedgerExactHashTransferRelationships([
        makeCandidate({
          candidateId: 1,
          direction: 'source',
          postingFingerprint: 'ledger_posting:v1:source',
        }),
        makeCandidate({
          candidateId: 2,
          direction: 'target',
          postingFingerprint: 'ledger_posting:v1:different-asset',
          assetId: 'blockchain:ethereum:token:usdc',
          assetSymbol: USDC,
        }),
        makeCandidate({
          candidateId: 3,
          direction: 'target',
          postingFingerprint: 'ledger_posting:v1:different-amount',
          amount: '1.20',
        }),
        makeCandidate({
          candidateId: 4,
          direction: 'target',
          postingFingerprint: 'ledger_posting:v1:same-account',
          ownerAccountId: 1,
        }),
        makeCandidate({
          candidateId: 5,
          direction: 'target',
          postingFingerprint: 'ledger_posting:v1:same-activity',
          sourceActivityFingerprint: 'source_activity:v1:source',
        }),
      ])
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([]);
  });

  it('surfaces same-symbol exact-hash pairs blocked by mismatched asset identity', () => {
    const result = assertOk(
      buildLedgerExactHashTransferRelationships([
        makeCandidate({
          candidateId: 1,
          direction: 'source',
          sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
          journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
          postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
          assetId: 'exchange:kraken:eth',
          ownerAccountId: 1,
        }),
        makeCandidate({
          candidateId: 2,
          direction: 'target',
          sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
          journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
          postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
          assetId: 'blockchain:ethereum:native',
          ownerAccountId: 2,
        }),
      ])
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([]);
    expect(result.assetIdentityBlocks).toEqual([
      {
        amount: '1.25',
        assetSymbol: ETH,
        reason: 'same_symbol_different_asset_ids',
        sourceAssetId: 'exchange:kraken:eth',
        sourceBlockchainTransactionHash: '0xabc123',
        sourceCandidateId: 1,
        sourcePostingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
        targetAssetId: 'blockchain:ethereum:native',
        targetBlockchainTransactionHash: '0xabc123',
        targetCandidateId: 2,
        targetPostingFingerprint: 'ledger_posting:v1:ethereum-deposit',
      },
    ]);
  });

  it('matches different asset ids when an explicit asset identity assertion exists', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );
    const result = assertOk(
      buildLedgerExactHashTransferRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
            journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
            postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
            assetId: 'exchange:kraken:eth',
            ownerAccountId: 1,
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
            journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
            postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
            assetId: 'blockchain:ethereum:native',
            ownerAccountId: 2,
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.relationships).toHaveLength(1);
    expect(result.assetIdentityBlocks).toEqual([]);
    expect(result.matches[0]).toMatchObject({
      assetIdentityResolution: {
        assertion: {
          assetIdA: 'blockchain:ethereum:native',
          assetIdB: 'exchange:kraken:eth',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
        reason: 'accepted_assertion',
        status: 'accepted',
      },
      sourceAssetId: 'exchange:kraken:eth',
      targetAssetId: 'blockchain:ethereum:native',
    });
  });

  it('leaves exact-hash groups unresolved when the counterpart is ambiguous', () => {
    const result = assertOk(
      buildLedgerExactHashTransferRelationships([
        makeCandidate({
          candidateId: 1,
          direction: 'source',
          postingFingerprint: 'ledger_posting:v1:source',
        }),
        makeCandidate({
          candidateId: 2,
          direction: 'target',
          sourceActivityFingerprint: 'source_activity:v1:first-target',
          postingFingerprint: 'ledger_posting:v1:first-target',
          ownerAccountId: 2,
        }),
        makeCandidate({
          candidateId: 3,
          direction: 'target',
          sourceActivityFingerprint: 'source_activity:v1:second-target',
          postingFingerprint: 'ledger_posting:v1:second-target',
          ownerAccountId: 3,
        }),
      ])
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([
      {
        candidateId: 1,
        direction: 'source',
        matchingCandidateIds: [2, 3],
        reason: 'multiple_exact_hash_counterparts',
      },
    ]);
  });

  it('rejects malformed candidates instead of silently ignoring them', () => {
    const result = buildLedgerExactHashTransferRelationships([
      makeCandidate({ candidateId: 1 }),
      makeCandidate({ candidateId: 1, postingFingerprint: 'ledger_posting:v1:duplicate' }),
    ]);

    expect(assertErr(result).message).toContain('Duplicate ledger linking candidate id 1');
  });

  function makeCandidate(
    overrides: Partial<Omit<LedgerTransferLinkingCandidate, 'amount'>> & {
      amount?: string | undefined;
    } = {}
  ): LedgerTransferLinkingCandidate {
    const { amount, ...candidateOverrides } = overrides;

    return {
      candidateId: 1,
      ownerAccountId: 1,
      sourceActivityFingerprint: 'source_activity:v1:source',
      journalFingerprint: 'ledger_journal:v1:source',
      postingFingerprint: 'ledger_posting:v1:source',
      direction: 'source',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
      blockchainTransactionHash: '0xabc123',
      fromAddress: '0xfrom',
      toAddress: '0xto',
      assetId: 'blockchain:ethereum:native',
      assetSymbol: ETH,
      amount: parseDecimal(amount ?? '1.25'),
      ...candidateOverrides,
    };
  }
});
