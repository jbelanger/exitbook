import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import type { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildMatchingConfig } from '../../matching/matching-config.js';
import { createLinkableMovement } from '../../shared/test-utils.js';
import { BridgeAnnotationStrategy } from '../bridge-annotation-strategy.js';

describe('BridgeAnnotationStrategy', () => {
  it('has name "bridge-annotation"', () => {
    const strategy = new BridgeAnnotationStrategy();
    expect(strategy.name).toBe('bridge-annotation');
  });

  it('suggests a unique explicit token bridge pair', () => {
    const strategy = new BridgeAnnotationStrategy();
    const sources = [
      createBlockchainBridgeMovement({
        id: 1,
        transactionId: 100,
        platformKey: 'ethereum',
        assetId: 'blockchain:ethereum:render',
        assetSymbol: 'RENDER' as Currency,
        amount: parseDecimal('80.61'),
        direction: 'out',
        timestamp: new Date('2024-07-30T22:36:00Z'),
        metadata: { destinationChain: 'solana' },
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createBlockchainBridgeMovement({
        id: 2,
        transactionId: 200,
        platformKey: 'solana',
        assetId: 'blockchain:solana:render',
        assetSymbol: 'RENDER' as Currency,
        amount: parseDecimal('80.61'),
        direction: 'in',
        timestamp: new Date('2024-07-30T22:53:00Z'),
        metadata: { sourceChain: 'ethereum' },
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(1);
    expect(result.consumedCandidateIds).toEqual(new Set([1, 2]));

    const link = result.links[0]!;
    expect(link.status).toBe('suggested');
    expect(link.linkType).toBe('blockchain_to_blockchain');
    expect(link.sourceTransactionId).toBe(100);
    expect(link.targetTransactionId).toBe(200);
    expect(link.confidenceScore.toFixed()).toBe('0.9');
    expect(link.metadata?.scoreBreakdown?.some((entry) => entry.signal === 'chain_hint_alignment')).toBe(true);
    expect(link.metadata?.scoreBreakdown?.some((entry) => entry.signal === 'bridge_annotation')).toBe(true);
  });

  it('suggests a native bridge pair with higher allowed variance', () => {
    const strategy = new BridgeAnnotationStrategy();
    const sources = [
      createBlockchainBridgeMovement({
        id: 1,
        transactionId: 100,
        platformKey: 'ethereum',
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('0.003'),
        direction: 'out',
        timestamp: new Date('2024-05-20T18:55:35Z'),
        metadata: { destinationChain: 'arbitrum' },
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createBlockchainBridgeMovement({
        id: 2,
        transactionId: 200,
        platformKey: 'arbitrum',
        assetId: 'blockchain:arbitrum:native',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('0.00221'),
        direction: 'in',
        timestamp: new Date('2024-05-20T19:09:53Z'),
        metadata: { sourceChain: 'ethereum' },
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(1);
    const link = result.links[0]!;
    expect(link.status).toBe('suggested');
    expect(link.impliedFeeAmount?.toFixed()).toBe('0.00079');
    expect(link.metadata).toMatchObject({
      variance: '0.00079',
      variancePct: '26.33',
    });
  });

  it('does not link when the source has multiple eligible bridge targets', () => {
    const strategy = new BridgeAnnotationStrategy();
    const sources = [
      createBlockchainBridgeMovement({
        id: 1,
        transactionId: 100,
        platformKey: 'ethereum',
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('5'),
        direction: 'out',
        timestamp: new Date('2024-05-20T18:55:35Z'),
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createBlockchainBridgeMovement({
        id: 2,
        transactionId: 200,
        platformKey: 'arbitrum',
        assetId: 'blockchain:arbitrum:native',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('4.8'),
        direction: 'in',
        timestamp: new Date('2024-05-20T19:09:53Z'),
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
      createBlockchainBridgeMovement({
        id: 3,
        transactionId: 300,
        platformKey: 'optimism',
        assetId: 'blockchain:optimism:native',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('4.85'),
        direction: 'in',
        timestamp: new Date('2024-05-20T19:10:00Z'),
        movementFingerprint: 'movement:test:300:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
    expect(result.consumedCandidateIds.size).toBe(0);
  });

  it('does not link when only one side carries bridge annotations', () => {
    const strategy = new BridgeAnnotationStrategy();
    const sources = [
      createBlockchainBridgeMovement({
        id: 1,
        transactionId: 100,
        platformKey: 'ethereum',
        assetId: 'blockchain:ethereum:render',
        assetSymbol: 'RENDER' as Currency,
        amount: parseDecimal('80.61'),
        direction: 'out',
        timestamp: new Date('2024-07-30T22:36:00Z'),
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 200,
        platformKey: 'solana',
        platformKind: 'blockchain',
        assetId: 'blockchain:solana:render',
        assetSymbol: 'RENDER' as Currency,
        amount: parseDecimal('80.61'),
        direction: 'in',
        timestamp: new Date('2024-07-30T22:53:00Z'),
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
  });

  it('does not link when explicit chain hints conflict with the candidate target', () => {
    const strategy = new BridgeAnnotationStrategy();
    const sources = [
      createBlockchainBridgeMovement({
        id: 1,
        transactionId: 100,
        platformKey: 'ethereum',
        assetId: 'blockchain:ethereum:inj',
        assetSymbol: 'INJ' as Currency,
        amount: parseDecimal('10'),
        direction: 'out',
        timestamp: new Date('2024-07-30T22:36:00Z'),
        metadata: { destinationChain: 'solana' },
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createBlockchainBridgeMovement({
        id: 2,
        transactionId: 200,
        platformKey: 'injective',
        assetId: 'blockchain:injective:inj',
        assetSymbol: 'INJ' as Currency,
        amount: parseDecimal('10'),
        direction: 'in',
        timestamp: new Date('2024-07-30T22:53:00Z'),
        metadata: { sourceChain: 'ethereum' },
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
  });
});

function createBridgeAnnotation(params: {
  direction: 'in' | 'out';
  metadata?: Record<string, unknown> | undefined;
  transactionId: number;
}): TransactionAnnotation {
  return {
    annotationFingerprint: `annotation:bridge:${params.transactionId}:${params.direction}`,
    accountId: 1,
    transactionId: params.transactionId,
    txFingerprint: `tx:${params.transactionId}`,
    kind: 'bridge_participant',
    tier: 'asserted',
    target: { scope: 'transaction' },
    role: params.direction === 'out' ? 'source' : 'target',
    protocolRef: { id: 'wormhole' },
    detectorId: 'bridge-participant',
    derivedFromTxIds: [params.transactionId],
    provenanceInputs: ['processor', 'diagnostic'],
    ...(params.metadata === undefined ? {} : { metadata: params.metadata }),
  };
}

function createBlockchainBridgeMovement(params: {
  amount: Decimal;
  assetId: string;
  assetSymbol: Currency;
  direction: 'in' | 'out';
  id: number;
  metadata?: Record<string, unknown> | undefined;
  movementFingerprint: string;
  platformKey: string;
  timestamp: Date;
  transactionId: number;
}) {
  return createLinkableMovement({
    id: params.id,
    transactionId: params.transactionId,
    platformKey: params.platformKey,
    platformKind: 'blockchain',
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    amount: params.amount,
    direction: params.direction,
    timestamp: params.timestamp,
    movementFingerprint: params.movementFingerprint,
    transactionAnnotations: [createBridgeAnnotation(params)],
  });
}
