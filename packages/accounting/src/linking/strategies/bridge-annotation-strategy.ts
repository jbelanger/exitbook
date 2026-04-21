import type { NewTransactionLink } from '@exitbook/core';
import { ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { Decimal } from 'decimal.js';

import { createTransactionLink } from '../matching/link-construction.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type { MatchingConfig, ScoreComponent } from '../shared/types.js';

import { determineLinkType } from './amount-timing-utils.js';
import { areLinkingAssetsEquivalent } from './asset-equivalence-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

const BRIDGE_MAX_TIMING_WINDOW_HOURS = 24;
const BRIDGE_MAX_CLOCK_SKEW_HOURS = 0.25;
const BRIDGE_NATIVE_MIN_AMOUNT_SIMILARITY = parseDecimal('0.7');
const BRIDGE_TOKEN_MIN_AMOUNT_SIMILARITY = parseDecimal('0.995');
const BRIDGE_NATIVE_MAX_SOURCE_TO_TARGET_VARIANCE_PCT = parseDecimal('35');
const BRIDGE_TOKEN_MAX_SOURCE_TO_TARGET_VARIANCE_PCT = parseDecimal('2');

/**
 * Matches explicit bridge flows across blockchains when both sides carry
 * asserted bridge interpretation and the pair is uniquely safe.
 *
 * Safety constraints:
 * - blockchain -> blockchain only
 * - both sides must carry asserted `bridge_participant` interpretation
 * - assets must already be equivalent under existing linking semantics
 * - target must follow source within a conservative window
 * - source and target must be mutual unique candidates
 * - amount variance remains strict for token bridges, wider for native bridges
 *
 * Links are intentionally emitted as suggested, never confirmed.
 */
export class BridgeAnnotationStrategy implements ILinkingStrategy {
  readonly name = 'bridge-annotation';

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    config: MatchingConfig
  ): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();
    const now = new Date();

    const bridgeSources = sources.filter(isBridgeSourceCandidate);
    const bridgeTargets = targets.filter(isBridgeTargetCandidate);

    if (bridgeSources.length === 0 || bridgeTargets.length === 0) {
      return ok({ links, consumedCandidateIds });
    }

    const eligibleTargetsBySource = new Map<number, LinkableMovement[]>();
    const eligibleSourcesByTarget = new Map<number, LinkableMovement[]>();

    for (const source of bridgeSources) {
      const eligibleTargets = bridgeTargets.filter((target) => isSafeBridgePair(source, target, config));
      eligibleTargetsBySource.set(source.id, eligibleTargets);

      for (const target of eligibleTargets) {
        const existingSources = eligibleSourcesByTarget.get(target.id) ?? [];
        existingSources.push(source);
        eligibleSourcesByTarget.set(target.id, existingSources);
      }
    }

    for (const source of bridgeSources) {
      const eligibleTargets = eligibleTargetsBySource.get(source.id) ?? [];
      if (eligibleTargets.length !== 1) {
        continue;
      }

      const target = eligibleTargets[0]!;
      const reciprocalSources = eligibleSourcesByTarget.get(target.id) ?? [];
      if (reciprocalSources.length !== 1 || reciprocalSources[0]?.id !== source.id) {
        continue;
      }

      const sourceAnnotation = getBridgeAnnotation(source, 'source');
      const targetAnnotation = getBridgeAnnotation(target, 'target');
      if (!sourceAnnotation || !targetAnnotation) {
        continue;
      }

      const amountSimilarity = calculateBridgeAmountSimilarity(source.amount, target.amount);
      const isNativeBridge = isNativeAssetMovement(source) && isNativeAssetMovement(target);
      const maxVariancePct = isNativeBridge
        ? BRIDGE_NATIVE_MAX_SOURCE_TO_TARGET_VARIANCE_PCT
        : BRIDGE_TOKEN_MAX_SOURCE_TO_TARGET_VARIANCE_PCT;
      const alignedChainHints = hasAlignedChainHints(
        sourceAnnotation,
        targetAnnotation,
        source.platformKey,
        target.platformKey
      );
      const confidenceScore = calculateBridgeConfidenceScore(amountSimilarity, alignedChainHints);

      if (confidenceScore.lessThan(config.minConfidenceScore)) {
        continue;
      }

      const hoursDelta = calculateTimeDifferenceHours(source.timestamp, target.timestamp);
      const match = {
        sourceMovement: source,
        targetMovement: target,
        confidenceScore,
        matchCriteria: {
          assetMatch: true,
          amountSimilarity,
          timingValid: true,
          timingHours: hoursDelta,
          hashMatch: false,
        },
        linkType: determineLinkType(source.platformKind, target.platformKind),
        scoreBreakdown: buildBridgeScoreBreakdown(amountSimilarity, alignedChainHints),
      };

      const linkResult = createTransactionLink(match, 'suggested', now, {
        amountValidationConfig: { maxSourceToTargetVariancePct: maxVariancePct },
      });
      if (linkResult.isErr()) {
        continue;
      }

      links.push(linkResult.value);
      consumedCandidateIds.add(source.id);
      consumedCandidateIds.add(target.id);
    }

    return ok({ links, consumedCandidateIds });
  }
}

function isBridgeSourceCandidate(movement: LinkableMovement): boolean {
  return (
    movement.platformKind === 'blockchain' &&
    movement.direction === 'out' &&
    getBridgeAnnotation(movement, 'source') !== undefined
  );
}

function isBridgeTargetCandidate(movement: LinkableMovement): boolean {
  return (
    movement.platformKind === 'blockchain' &&
    movement.direction === 'in' &&
    getBridgeAnnotation(movement, 'target') !== undefined
  );
}

function isSafeBridgePair(source: LinkableMovement, target: LinkableMovement, config: MatchingConfig): boolean {
  if (source.transactionId === target.transactionId) {
    return false;
  }

  if (source.platformKey === target.platformKey) {
    return false;
  }

  if (!areLinkingAssetsEquivalent(source, target)) {
    return false;
  }

  const hoursDelta = calculateTimeDifferenceHours(source.timestamp, target.timestamp);
  const maxWindowHours = Math.min(config.maxTimingWindowHours, BRIDGE_MAX_TIMING_WINDOW_HOURS);
  if (hoursDelta < -BRIDGE_MAX_CLOCK_SKEW_HOURS || hoursDelta > maxWindowHours) {
    return false;
  }

  const amountSimilarity = calculateBridgeAmountSimilarity(source.amount, target.amount);
  const minSimilarity =
    isNativeAssetMovement(source) && isNativeAssetMovement(target)
      ? BRIDGE_NATIVE_MIN_AMOUNT_SIMILARITY
      : BRIDGE_TOKEN_MIN_AMOUNT_SIMILARITY;

  if (amountSimilarity.lessThan(minSimilarity)) {
    return false;
  }

  const sourceAnnotation = getBridgeAnnotation(source, 'source');
  const targetAnnotation = getBridgeAnnotation(target, 'target');
  if (!sourceAnnotation || !targetAnnotation) {
    return false;
  }

  return chainHintsAreCompatible(sourceAnnotation, targetAnnotation, source.platformKey, target.platformKey);
}

function getBridgeAnnotation(
  movement: LinkableMovement,
  role: Extract<NonNullable<TransactionAnnotation['role']>, 'source' | 'target'>
): TransactionAnnotation | undefined {
  return movement.transactionAnnotations?.find(
    (annotation) =>
      annotation.kind === 'bridge_participant' && annotation.tier === 'asserted' && annotation.role === role
  );
}

function calculateTimeDifferenceHours(sourceTime: Date, targetTime: Date): number {
  const diffMs = targetTime.getTime() - sourceTime.getTime();
  return diffMs / (1000 * 60 * 60);
}

function calculateBridgeAmountSimilarity(sourceAmount: Decimal, targetAmount: Decimal): Decimal {
  if (sourceAmount.lte(0) || targetAmount.lte(0)) {
    return parseDecimal('0');
  }

  if (targetAmount.greaterThan(sourceAmount)) {
    const percentDiff = targetAmount.minus(sourceAmount).dividedBy(sourceAmount).abs();
    if (percentDiff.lessThanOrEqualTo(0.001)) {
      return parseDecimal('0.99');
    }

    return parseDecimal('0');
  }

  return Decimal.min(Decimal.max(targetAmount.dividedBy(sourceAmount), parseDecimal('0')), parseDecimal('1'));
}

function isNativeAssetMovement(movement: LinkableMovement): boolean {
  return movement.assetId.endsWith(':native');
}

function chainHintsAreCompatible(
  sourceAnnotation: TransactionAnnotation,
  targetAnnotation: TransactionAnnotation,
  sourcePlatformKey: string,
  targetPlatformKey: string
): boolean {
  return (
    matchesOptionalChainHint(sourceAnnotation.metadata?.['sourceChain'], sourcePlatformKey) &&
    matchesOptionalChainHint(sourceAnnotation.metadata?.['destinationChain'], targetPlatformKey) &&
    matchesOptionalChainHint(targetAnnotation.metadata?.['sourceChain'], sourcePlatformKey) &&
    matchesOptionalChainHint(targetAnnotation.metadata?.['destinationChain'], targetPlatformKey)
  );
}

function hasAlignedChainHints(
  sourceAnnotation: TransactionAnnotation,
  targetAnnotation: TransactionAnnotation,
  sourcePlatformKey: string,
  targetPlatformKey: string
): boolean {
  const hints = [
    chainHintMatches(sourceAnnotation.metadata?.['sourceChain'], sourcePlatformKey),
    chainHintMatches(sourceAnnotation.metadata?.['destinationChain'], targetPlatformKey),
    chainHintMatches(targetAnnotation.metadata?.['sourceChain'], sourcePlatformKey),
    chainHintMatches(targetAnnotation.metadata?.['destinationChain'], targetPlatformKey),
  ];

  return hints.some((hint) => hint === true);
}

function matchesOptionalChainHint(rawHint: unknown, platformKey: string): boolean {
  const match = chainHintMatches(rawHint, platformKey);
  return match !== false;
}

function chainHintMatches(rawHint: unknown, platformKey: string): boolean | undefined {
  if (typeof rawHint !== 'string' || rawHint.trim() === '') {
    return undefined;
  }

  const normalizedHint = normalizeChainHint(rawHint);
  const normalizedPlatformKey = normalizeChainHint(platformKey);

  return (
    normalizedHint === normalizedPlatformKey ||
    normalizedHint.includes(normalizedPlatformKey) ||
    normalizedPlatformKey.includes(normalizedHint)
  );
}

function normalizeChainHint(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function calculateBridgeConfidenceScore(amountSimilarity: Decimal, hasChainHintAlignment: boolean): Decimal {
  let score = parseDecimal('0.45');
  score = score.plus(amountSimilarity.times(parseDecimal('0.25')));
  score = score.plus(parseDecimal('0.08'));
  score = score.plus(parseDecimal('0.07'));

  if (hasChainHintAlignment) {
    score = score.plus(parseDecimal('0.05'));
  }

  return Decimal.min(score, parseDecimal('0.9')).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

function buildBridgeScoreBreakdown(amountSimilarity: Decimal, hasChainHintAlignment: boolean): ScoreComponent[] {
  const breakdown: ScoreComponent[] = [
    {
      signal: 'bridge_annotation',
      weight: parseDecimal('0.45'),
      value: parseDecimal('1'),
      contribution: parseDecimal('0.45'),
    },
    {
      signal: 'amount_similarity',
      weight: parseDecimal('0.25'),
      value: amountSimilarity,
      contribution: amountSimilarity.times(parseDecimal('0.25')).toDecimalPlaces(6, Decimal.ROUND_HALF_UP),
    },
    {
      signal: 'timing_valid',
      weight: parseDecimal('0.08'),
      value: parseDecimal('1'),
      contribution: parseDecimal('0.08'),
    },
    {
      signal: 'unique_counterpart',
      weight: parseDecimal('0.07'),
      value: parseDecimal('1'),
      contribution: parseDecimal('0.07'),
    },
  ];

  if (hasChainHintAlignment) {
    breakdown.push({
      signal: 'chain_hint_alignment',
      weight: parseDecimal('0.05'),
      value: parseDecimal('1'),
      contribution: parseDecimal('0.05'),
    });
  }

  return breakdown;
}
