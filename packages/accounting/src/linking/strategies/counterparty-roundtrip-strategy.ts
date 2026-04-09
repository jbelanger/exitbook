import type { NewTransactionLink } from '@exitbook/core';
import { ok, parseDecimal, type Result } from '@exitbook/foundation';

import { createTransactionLink } from '../matching/link-construction.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type { MatchingConfig, PotentialMatch } from '../shared/types.js';

import { areLinkingAssetsEquivalent } from './asset-equivalence-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

const MAX_COUNTERPARTY_ROUNDTRIP_HOURS = 30 * 24;
const FULL_CONFIDENCE = parseDecimal('1');

/**
 * Detect exact same-chain roundtrips where funds leave a wallet to one counterparty
 * and later return from that same counterparty unchanged.
 */
export class CounterpartyRoundtripStrategy implements ILinkingStrategy {
  readonly name = 'counterparty-roundtrip';

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    _config: MatchingConfig
  ): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();
    const now = new Date();
    const targetsByKey = new Map<string, LinkableMovement[]>();

    for (const target of targets) {
      if (!isRoundtripTargetCandidate(target)) {
        continue;
      }

      const key = buildRoundtripKey(target, 'target');
      const existing = targetsByKey.get(key);
      if (existing) {
        existing.push(target);
        continue;
      }

      targetsByKey.set(key, [target]);
    }

    for (const targetGroup of targetsByKey.values()) {
      targetGroup.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    }

    const eligibleSources = sources
      .filter((source) => isRoundtripSourceCandidate(source) && !consumedCandidateIds.has(source.id))
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

    for (const source of eligibleSources) {
      const key = buildRoundtripKey(source, 'source');
      const candidateTargets = targetsByKey.get(key);
      if (!candidateTargets) {
        continue;
      }

      const target = candidateTargets.find(
        (candidate) => !consumedCandidateIds.has(candidate.id) && isCounterpartyRoundtripPair(source, candidate)
      );
      if (!target) {
        continue;
      }

      const match = buildCounterpartyRoundtripMatch(source, target);
      const linkResult = createTransactionLink(match, 'confirmed', now);
      if (linkResult.isErr()) {
        continue;
      }

      const link = linkResult.value;
      link.metadata = {
        ...link.metadata,
        counterpartyRoundtrip: true,
        counterpartyRoundtripHours: match.matchCriteria.timingHours.toFixed(2),
      };

      links.push(link);
      consumedCandidateIds.add(source.id);
      consumedCandidateIds.add(target.id);
    }

    return ok({ links, consumedCandidateIds });
  }
}

function normalizeAddress(address: string | undefined): string | undefined {
  const normalized = address?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isRoundtripSourceCandidate(source: LinkableMovement): boolean {
  if (source.direction !== 'out' || source.platformKind !== 'blockchain') {
    return false;
  }

  const counterpartyAddress = normalizeAddress(source.toAddress);
  if (!counterpartyAddress) {
    return false;
  }

  return counterpartyAddress !== normalizeAddress(source.fromAddress);
}

function isRoundtripTargetCandidate(target: LinkableMovement): boolean {
  if (target.direction !== 'in' || target.platformKind !== 'blockchain') {
    return false;
  }

  const counterpartyAddress = normalizeAddress(target.fromAddress);
  if (!counterpartyAddress) {
    return false;
  }

  return counterpartyAddress !== normalizeAddress(target.toAddress);
}

function buildRoundtripKey(movement: LinkableMovement, role: 'source' | 'target'): string {
  const counterpartyAddress = normalizeAddress(role === 'source' ? movement.toAddress : movement.fromAddress);
  return [
    movement.platformKind,
    movement.platformKey,
    movement.accountId,
    movement.assetId,
    movement.amount.toFixed(),
    counterpartyAddress ?? '',
  ].join('\u0000');
}

function isCounterpartyRoundtripPair(source: LinkableMovement, target: LinkableMovement): boolean {
  if (source.transactionId === target.transactionId) {
    return false;
  }

  if (source.platformKey !== target.platformKey || source.accountId !== target.accountId) {
    return false;
  }

  if (!source.amount.eq(target.amount) || !areLinkingAssetsEquivalent(source, target)) {
    return false;
  }

  const sourceCounterparty = normalizeAddress(source.toAddress);
  const targetCounterparty = normalizeAddress(target.fromAddress);
  if (!sourceCounterparty || sourceCounterparty !== targetCounterparty) {
    return false;
  }

  const sourceUserAddress = normalizeAddress(source.fromAddress);
  const targetUserAddress = normalizeAddress(target.toAddress);
  if (sourceUserAddress && targetUserAddress && sourceUserAddress !== targetUserAddress) {
    return false;
  }

  const timingHours = (target.timestamp.getTime() - source.timestamp.getTime()) / (1000 * 60 * 60);
  return timingHours >= 0 && timingHours <= MAX_COUNTERPARTY_ROUNDTRIP_HOURS;
}

function buildCounterpartyRoundtripMatch(source: LinkableMovement, target: LinkableMovement): PotentialMatch {
  const timingHours = (target.timestamp.getTime() - source.timestamp.getTime()) / (1000 * 60 * 60);

  return {
    sourceMovement: source,
    targetMovement: target,
    confidenceScore: FULL_CONFIDENCE,
    linkType: 'blockchain_to_blockchain',
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: FULL_CONFIDENCE,
      timingValid: true,
      timingHours,
      addressMatch: true,
    },
  };
}
