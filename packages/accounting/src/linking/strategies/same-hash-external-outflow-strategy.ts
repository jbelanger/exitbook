import { parseDecimal } from '@exitbook/core';
import { ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import { createTransactionLink } from '../link-construction.js';
import { shouldAutoConfirm } from '../match-allocation.js';
import type { LinkCandidate } from '../pre-linking/types.js';
import type {
  MatchingConfig,
  NewTransactionLink,
  PotentialMatch,
  SameHashExternalSourceAllocation,
  TransactionLinkMetadata,
} from '../types.js';

import { scoreAndFilterMatches } from './amount-timing-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

interface SameHashExternalOutflowGroup {
  assetId: string;
  hash: string;
  sources: LinkCandidate[];
  toAddress: string;
}

/**
 * Handles multi-input UTXO sends that Exitbook stores as one blockchain outflow per tracked account.
 *
 * The persisted link model is still pairwise, so this strategy:
 * 1. reconstructs the same-hash outflow group amount using a single deduplicated fee
 * 2. finds one exact inbound match for the full group
 * 3. expands that group match back into pairwise partial links
 */
export class SameHashExternalOutflowStrategy implements ILinkingStrategy {
  readonly name = 'same-hash-external-outflow';

  execute(sources: LinkCandidate[], targets: LinkCandidate[], config: MatchingConfig): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();
    const now = new Date();
    const exchangeTargets = targets.filter((target) => target.sourceType === 'exchange' && target.direction === 'in');

    for (const group of buildGroups(sources, targets)) {
      const dedupedFee = syntheticFee(group.sources);
      const syntheticSource = buildSyntheticSource(group);
      const exactMatches = scoreAndFilterMatches(syntheticSource, exchangeTargets, config).filter((match) =>
        match.matchCriteria.amountSimilarity.eq(1)
      );

      if (exactMatches.length !== 1) {
        continue;
      }

      const groupMatch = exactMatches[0]!;
      const groupAmount = syntheticSource.amount;
      if (!groupMatch.targetMovement.amount.eq(groupAmount)) {
        continue;
      }

      const memberAmounts = deriveMemberAmounts(group.sources);
      const allocations = buildSourceAllocations(group.sources, memberAmounts);
      const feeBearingAllocation =
        allocations.find((allocation) => allocation.feeDeducted !== '0') ??
        allocations.sort((left, right) => left.sourceTransactionId - right.sourceTransactionId)[0];
      if (!feeBearingAllocation) continue;
      const expandedMatches = buildExpandedMatches(groupMatch, group.sources, memberAmounts);
      const status = shouldAutoConfirm(groupMatch, config) ? 'confirmed' : 'suggested';

      for (const match of expandedMatches) {
        const linkResult = createTransactionLink(match, status, now);
        if (linkResult.isErr()) {
          continue;
        }

        const link = linkResult.value;
        const metadata: TransactionLinkMetadata = {
          ...link.metadata,
          dedupedSameHashFee: dedupedFee.toFixed(),
          sameHashExternalGroup: true,
          sameHashExternalGroupAmount: groupAmount.toFixed(),
          sameHashExternalGroupSize: group.sources.length,
          feeBearingSourceTransactionId: feeBearingAllocation.sourceTransactionId,
          sameHashExternalSourceAllocations: allocations,
          blockchainTxHash: group.hash,
          sharedToAddress: group.toAddress,
        };
        link.metadata = metadata;

        links.push(link);
        consumedCandidateIds.add(match.sourceMovement.id);
      }

      consumedCandidateIds.add(groupMatch.targetMovement.id);
    }

    return ok({ links, consumedCandidateIds });
  }
}

function buildGroups(sources: LinkCandidate[], targets: LinkCandidate[]): SameHashExternalOutflowGroup[] {
  const candidateGroups = new Map<string, LinkCandidate[]>();

  for (const source of sources) {
    if (source.sourceType !== 'blockchain') continue;
    if (source.direction !== 'out') continue;
    if (!source.blockchainTxHash) continue;
    if (!source.toAddress) continue;

    const key = `${source.blockchainTxHash}\u0000${source.assetId}`;
    const existing = candidateGroups.get(key) ?? [];
    existing.push(source);
    candidateGroups.set(key, existing);
  }

  const groups: SameHashExternalOutflowGroup[] = [];
  for (const [key, groupSources] of candidateGroups) {
    if (groupSources.length < 2) continue;

    const distinctAccounts = new Set(groupSources.map((source) => source.accountId));
    if (distinctAccounts.size < 2) continue;

    const distinctTxIds = new Set(groupSources.map((source) => source.transactionId));
    if (distinctTxIds.size !== groupSources.length) continue;

    const toAddresses = new Set(
      groupSources.map((source) => source.toAddress).filter((value): value is string => !!value)
    );
    if (toAddresses.size !== 1) continue;

    const [hash, assetId] = key.split('\u0000');
    if (!hash || !assetId) continue;

    const hasSameHashBlockchainInflows = targets.some(
      (target) =>
        target.sourceType === 'blockchain' &&
        target.sourceName === groupSources[0]?.sourceName &&
        target.direction === 'in' &&
        target.blockchainTxHash === hash &&
        target.assetId === assetId
    );
    if (hasSameHashBlockchainInflows) continue;

    const hasExchangeTargets = targets.some(
      (target) =>
        target.sourceType === 'exchange' &&
        target.direction === 'in' &&
        target.assetSymbol === groupSources[0]?.assetSymbol
    );
    if (!hasExchangeTargets) continue;

    groups.push({
      hash,
      assetId,
      sources: groupSources.sort((left, right) => left.transactionId - right.transactionId || left.id - right.id),
      toAddress: [...toAddresses][0]!,
    });
  }

  return groups;
}

function buildSyntheticSource(group: SameHashExternalOutflowGroup): LinkCandidate {
  const representative = group.sources[0]!;
  const grossAmount = syntheticGross(group.sources);
  const amount = grossAmount.minus(syntheticFee(group.sources));

  return {
    ...representative,
    amount,
    grossAmount: grossAmount.eq(amount) ? undefined : grossAmount,
  };
}

function buildExpandedMatches(
  groupMatch: PotentialMatch,
  sources: LinkCandidate[],
  memberAmounts: Map<number, Decimal>
): PotentialMatch[] {
  return sources.map((source) => {
    const consumedAmount = memberAmounts.get(source.id)!;
    return {
      ...groupMatch,
      sourceMovement: {
        ...source,
        amount: consumedAmount,
      },
      consumedAmount,
    };
  });
}

function deriveMemberAmounts(sources: LinkCandidate[]): Map<number, Decimal> {
  const dedupedFee = syntheticFee(sources);
  const feeBearer = [...sources].sort((left, right) => {
    const feeComparison = sourceFee(right).comparedTo(sourceFee(left));
    if (feeComparison !== 0) return feeComparison;

    // Put the synthetic fee on the largest gross leg to minimize distortion in the expanded pairwise links.
    const grossComparison = sourceGross(right).comparedTo(sourceGross(left));
    if (grossComparison !== 0) return grossComparison;

    return left.transactionId - right.transactionId || left.id - right.id;
  })[0]!;

  const memberAmounts = new Map<number, Decimal>();
  for (const source of sources) {
    const grossAmount = sourceGross(source);
    const amount = source.id === feeBearer.id ? grossAmount.minus(dedupedFee) : grossAmount;
    memberAmounts.set(source.id, amount);
  }

  return memberAmounts;
}

function buildSourceAllocations(
  sources: LinkCandidate[],
  memberAmounts: Map<number, Decimal>
): SameHashExternalSourceAllocation[] {
  return sources.map((source) => {
    const grossAmount = sourceGross(source);
    const linkedAmount = memberAmounts.get(source.id)!;

    return {
      sourceTransactionId: source.transactionId,
      grossAmount: grossAmount.toFixed(),
      linkedAmount: linkedAmount.toFixed(),
      feeDeducted: grossAmount.minus(linkedAmount).toFixed(),
    };
  });
}

function sourceGross(source: LinkCandidate): Decimal {
  return source.grossAmount ?? source.amount;
}

function sourceFee(source: LinkCandidate): Decimal {
  return sourceGross(source).minus(source.amount);
}

function syntheticGross(sources: LinkCandidate[]): Decimal {
  return sources.reduce((sum, source) => sum.plus(sourceGross(source)), parseDecimal('0'));
}

function syntheticFee(sources: LinkCandidate[]): Decimal {
  return sources.reduce((maxFee, source) => {
    const fee = sourceFee(source);
    return fee.greaterThan(maxFee) ? fee : maxFee;
  }, parseDecimal('0'));
}
