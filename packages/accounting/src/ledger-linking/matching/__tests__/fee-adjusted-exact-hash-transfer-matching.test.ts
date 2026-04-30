import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildLedgerLinkingAssetIdentityResolver } from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import {
  buildLedgerFeeAdjustedExactHashTransferRecognizer,
  buildLedgerFeeAdjustedExactHashTransferRelationships,
} from '../fee-adjusted-exact-hash-transfer-matching.js';

const AAVE = assertOk(parseCurrency('AAVE'));

describe('buildLedgerFeeAdjustedExactHashTransferRelationships', () => {
  it('materializes a partial source allocation for fee-adjusted exchange withdrawals with accepted asset identity', () => {
    const result = assertOk(
      buildLedgerFeeAdjustedExactHashTransferRelationships(
        [
          makeCandidate({
            amount: '1.96664461',
            assetId: 'exchange:coinbase:aave',
            candidateId: 1,
            direction: 'source',
            ownerAccountId: 1,
            platformKind: 'exchange',
            platformKey: 'coinbase',
            postingFingerprint: 'ledger_posting:v1:coinbase-aave-withdrawal',
          }),
          makeCandidate({
            amount: '1.96490624',
            assetId: 'blockchain:ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            candidateId: 2,
            direction: 'target',
            ownerAccountId: 2,
            platformKind: 'blockchain',
            platformKey: 'ethereum',
            sourceActivityFingerprint: 'source_activity:v1:ethereum-aave-deposit',
            journalFingerprint: 'ledger_journal:v1:ethereum-aave-deposit',
            postingFingerprint: 'ledger_posting:v1:ethereum-aave-deposit',
            activityDatetime: new Date('2026-02-05T04:46:35.000Z'),
          }),
        ],
        makeAssetIdentityResolver([
          {
            assetIdA: 'blockchain:ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            assetIdB: 'exchange:coinbase:aave',
            evidenceKind: 'exact_hash_observed',
            relationshipKind: 'internal_transfer',
          },
        ])
      )
    );

    expect(result.assetIdentityBlocks).toEqual([]);
    expect(result.ambiguities).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      amount: '1.96490624',
      residualAmount: '0.00173837',
      residualSide: 'source',
      sourceAmount: '1.96664461',
      sourceCandidateId: 1,
      strategy: 'fee_adjusted_exact_hash_transfer',
      targetAmount: '1.96490624',
      targetCandidateId: 2,
      timeDistanceSeconds: 99,
    });
    expect(result.relationships[0]).toMatchObject({
      allocations: [
        {
          allocationSide: 'source',
          postingFingerprint: 'ledger_posting:v1:coinbase-aave-withdrawal',
          quantity: parseDecimal('1.96490624'),
        },
        {
          allocationSide: 'target',
          postingFingerprint: 'ledger_posting:v1:ethereum-aave-deposit',
          quantity: parseDecimal('1.96490624'),
        },
      ],
      evidence: {
        amount: '1.96490624',
        residualAmount: '0.00173837',
        residualSide: 'source',
        sourceAmount: '1.96664461',
        targetAmount: '1.96490624',
        timeDistanceSeconds: 99,
      },
      recognitionStrategy: 'fee_adjusted_exact_hash_transfer',
      relationshipKind: 'internal_transfer',
    });
  });

  it('surfaces one-to-one asset identity blocks without materializing the relationship', () => {
    const result = assertOk(
      buildLedgerFeeAdjustedExactHashTransferRelationships(
        [
          makeCandidate({
            amount: '1.96664461',
            assetId: 'exchange:coinbase:aave',
            candidateId: 1,
            direction: 'source',
            ownerAccountId: 1,
            platformKind: 'exchange',
            platformKey: 'coinbase',
            postingFingerprint: 'ledger_posting:v1:coinbase-aave-withdrawal',
          }),
          makeCandidate({
            amount: '1.96490624',
            assetId: 'blockchain:ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            candidateId: 2,
            direction: 'target',
            ownerAccountId: 2,
            platformKind: 'blockchain',
            platformKey: 'ethereum',
            sourceActivityFingerprint: 'source_activity:v1:ethereum-aave-deposit',
            journalFingerprint: 'ledger_journal:v1:ethereum-aave-deposit',
            postingFingerprint: 'ledger_posting:v1:ethereum-aave-deposit',
            activityDatetime: new Date('2026-02-05T04:46:35.000Z'),
          }),
        ],
        makeAssetIdentityResolver()
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.assetIdentityBlocks).toEqual([
      {
        amount: '1.96490624',
        assetSymbol: AAVE,
        reason: 'same_symbol_different_asset_ids',
        residualAmount: '0.00173837',
        residualSide: 'source',
        sourceAmount: '1.96664461',
        sourceAssetId: 'exchange:coinbase:aave',
        sourceBlockchainTransactionHash: '0xABC123',
        sourceCandidateId: 1,
        sourcePostingFingerprint: 'ledger_posting:v1:coinbase-aave-withdrawal',
        targetAmount: '1.96490624',
        targetAssetId: 'blockchain:ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
        targetBlockchainTransactionHash: '0xABC123',
        targetCandidateId: 2,
        targetPostingFingerprint: 'ledger_posting:v1:ethereum-aave-deposit',
        timeDistanceSeconds: 99,
      },
    ]);
  });

  it('does not match non-exchange sources, target-before-source timing, or equal amounts', () => {
    const assetIdentityResolver = makeAssetIdentityResolver();

    expect(
      assertOk(
        buildLedgerFeeAdjustedExactHashTransferRelationships(
          [
            makeCandidate({
              amount: '2',
              assetId: 'blockchain:ethereum:0xsource',
              candidateId: 1,
              direction: 'source',
              ownerAccountId: 1,
              platformKind: 'blockchain',
              platformKey: 'ethereum',
            }),
            makeCandidate({
              amount: '1',
              assetId: 'blockchain:ethereum:0xtarget',
              candidateId: 2,
              direction: 'target',
              ownerAccountId: 2,
              sourceActivityFingerprint: 'source_activity:v1:target',
              journalFingerprint: 'ledger_journal:v1:target',
              postingFingerprint: 'ledger_posting:v1:target',
            }),
          ],
          assetIdentityResolver
        )
      ).matches
    ).toEqual([]);

    expect(
      assertOk(
        buildLedgerFeeAdjustedExactHashTransferRelationships(
          [
            makeCandidate({
              amount: '2',
              candidateId: 1,
              direction: 'source',
              ownerAccountId: 1,
              platformKind: 'exchange',
              platformKey: 'coinbase',
              activityDatetime: new Date('2026-02-05T04:46:35.000Z'),
            }),
            makeCandidate({
              amount: '1',
              candidateId: 2,
              direction: 'target',
              ownerAccountId: 2,
              sourceActivityFingerprint: 'source_activity:v1:target',
              journalFingerprint: 'ledger_journal:v1:target',
              postingFingerprint: 'ledger_posting:v1:target',
              activityDatetime: new Date('2026-02-05T04:44:56.000Z'),
            }),
          ],
          assetIdentityResolver
        )
      ).matches
    ).toEqual([]);

    expect(
      assertOk(
        buildLedgerFeeAdjustedExactHashTransferRelationships(
          [
            makeCandidate({
              amount: '1',
              candidateId: 1,
              direction: 'source',
              ownerAccountId: 1,
              platformKind: 'exchange',
              platformKey: 'coinbase',
            }),
            makeCandidate({
              amount: '1',
              candidateId: 2,
              direction: 'target',
              ownerAccountId: 2,
              sourceActivityFingerprint: 'source_activity:v1:target',
              journalFingerprint: 'ledger_journal:v1:target',
              postingFingerprint: 'ledger_posting:v1:target',
            }),
          ],
          assetIdentityResolver
        )
      ).matches
    ).toEqual([]);
  });

  it('exposes partial claims through the deterministic recognizer boundary', () => {
    const recognizer = buildLedgerFeeAdjustedExactHashTransferRecognizer(
      makeAssetIdentityResolver([
        {
          assetIdA: 'blockchain:ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
          assetIdB: 'exchange:coinbase:aave',
          evidenceKind: 'exact_hash_observed',
          relationshipKind: 'internal_transfer',
        },
      ])
    );
    const result = assertOk(
      recognizer.recognize([
        makeCandidate({
          amount: '1.96664461',
          assetId: 'exchange:coinbase:aave',
          candidateId: 1,
          direction: 'source',
          ownerAccountId: 1,
          platformKind: 'exchange',
          platformKey: 'coinbase',
          postingFingerprint: 'ledger_posting:v1:coinbase-aave-withdrawal',
        }),
        makeCandidate({
          amount: '1.96490624',
          assetId: 'blockchain:ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
          candidateId: 2,
          direction: 'target',
          ownerAccountId: 2,
          platformKind: 'blockchain',
          platformKey: 'ethereum',
          sourceActivityFingerprint: 'source_activity:v1:ethereum-aave-deposit',
          journalFingerprint: 'ledger_journal:v1:ethereum-aave-deposit',
          postingFingerprint: 'ledger_posting:v1:ethereum-aave-deposit',
          activityDatetime: new Date('2026-02-05T04:46:35.000Z'),
        }),
      ])
    );

    expect(
      result.candidateClaims.map((claim) => ({ candidateId: claim.candidateId, quantity: claim.quantity.toFixed() }))
    ).toEqual([
      { candidateId: 1, quantity: '1.96490624' },
      { candidateId: 2, quantity: '1.96490624' },
    ]);
    expect(result.relationships).toHaveLength(1);
  });
});

function makeAssetIdentityResolver(assertions: Parameters<typeof buildLedgerLinkingAssetIdentityResolver>[0] = []) {
  return assertOk(buildLedgerLinkingAssetIdentityResolver(assertions));
}

function makeCandidate(
  overrides: Partial<Omit<LedgerTransferLinkingCandidate, 'amount'>> & {
    amount?: string | undefined;
  } = {}
): LedgerTransferLinkingCandidate {
  const { amount, ...candidateOverrides } = overrides;

  return {
    activityDatetime: new Date('2026-02-05T04:44:56.000Z'),
    amount: parseDecimal(amount ?? '1'),
    assetId: 'exchange:coinbase:aave',
    assetSymbol: AAVE,
    blockchainTransactionHash: '0xABC123',
    candidateId: 1,
    direction: 'source',
    fromAddress: '0xfrom',
    journalFingerprint: 'ledger_journal:v1:source',
    ownerAccountId: 1,
    platformKey: 'coinbase',
    platformKind: 'exchange',
    postingFingerprint: 'ledger_posting:v1:source',
    sourceActivityFingerprint: 'source_activity:v1:source',
    toAddress: '0xto',
    ...candidateOverrides,
  };
}
