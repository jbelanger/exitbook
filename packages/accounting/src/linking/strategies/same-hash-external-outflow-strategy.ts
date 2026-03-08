import { parseDecimal } from '@exitbook/core';
import { ok, type Result } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import { createTransactionLink } from '../matching/link-construction.js';
import { shouldAutoConfirm } from '../matching/match-allocation.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type {
  MatchingConfig,
  NewTransactionLink,
  PotentialMatch,
  SameHashExternalSourceAllocation,
  TransactionLinkMetadata,
} from '../shared/types.js';

import { scoreAndFilterMatches } from './amount-timing-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

interface SameHashExternalOutflowGroup {
  assetId: string;
  hash: string;
  siblingInflows: LinkableMovement[];
  sources: LinkableMovement[];
  toAddress: string;
}

interface ResolvedGroupMatch {
  groupAmount: Decimal;
  groupMatch: PotentialMatch;
  linkedAmounts: Map<number, Decimal>;
  siblingInflowAmount: Decimal;
  status: 'confirmed' | 'suggested';
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

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    config: MatchingConfig
  ): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();
    const now = new Date();
    const exchangeTargets = targets.filter((target) => target.sourceType === 'exchange' && target.direction === 'in');

    for (const group of buildGroups(sources, targets)) {
      const dedupedFee = syntheticFee(group.sources);
      const sourceCapacities = deriveSourceCapacities(group.sources);
      const resolvedMatch = resolveGroupMatch(group, exchangeTargets, config, sourceCapacities);
      if (!resolvedMatch) continue;

      const allocations = buildSourceAllocations(group.sources, sourceCapacities, resolvedMatch.linkedAmounts);
      const feeBearingAllocation =
        allocations.find((allocation) => allocation.feeDeducted !== '0') ??
        allocations.sort((left, right) => left.sourceTransactionId - right.sourceTransactionId)[0];
      if (!feeBearingAllocation) continue;
      const expandedMatches = buildExpandedMatches(
        resolvedMatch.groupMatch,
        group.sources,
        sourceCapacities,
        resolvedMatch.linkedAmounts
      );

      for (const match of expandedMatches) {
        const linkResult = createTransactionLink(match, resolvedMatch.status, now);
        if (linkResult.isErr()) {
          continue;
        }

        const link = linkResult.value;
        const metadata: TransactionLinkMetadata = {
          ...link.metadata,
          dedupedSameHashFee: dedupedFee.toFixed(),
          sameHashExternalGroup: true,
          sameHashExternalGroupAmount: resolvedMatch.groupAmount.toFixed(),
          sameHashExternalGroupSize: group.sources.length,
          feeBearingSourceTransactionId: feeBearingAllocation.sourceTransactionId,
          sameHashExternalSourceAllocations: allocations,
          blockchainTxHash: group.hash,
          sharedToAddress: group.toAddress,
        };
        if (group.siblingInflows.length > 0) {
          metadata.sameHashMixedExternalGroup = true;
          metadata.sameHashTrackedSiblingInflowAmount = resolvedMatch.siblingInflowAmount.toFixed();
          metadata.sameHashTrackedSiblingInflowCount = group.siblingInflows.length;
          metadata.sameHashResidualAllocationPolicy = 'transaction_id_prefix';
        }
        link.metadata = metadata;

        links.push(link);
        consumedCandidateIds.add(match.sourceMovement.id);
      }

      consumedCandidateIds.add(resolvedMatch.groupMatch.targetMovement.id);
    }

    return ok({ links, consumedCandidateIds });
  }
}

function buildGroups(sources: LinkableMovement[], targets: LinkableMovement[]): SameHashExternalOutflowGroup[] {
  const candidateGroups = new Map<string, LinkableMovement[]>();

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

    const siblingInflows = targets.filter(
      (target) =>
        target.sourceType === 'blockchain' &&
        target.sourceName === groupSources[0]?.sourceName &&
        target.direction === 'in' &&
        target.blockchainTxHash === hash &&
        target.assetId === assetId
    );

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
      siblingInflows: siblingInflows.sort(
        (left, right) => left.transactionId - right.transactionId || left.id - right.id
      ),
      sources: groupSources.sort((left, right) => left.transactionId - right.transactionId || left.id - right.id),
      toAddress: [...toAddresses][0]!,
    });
  }

  return groups;
}

function resolveGroupMatch(
  group: SameHashExternalOutflowGroup,
  exchangeTargets: LinkableMovement[],
  config: MatchingConfig,
  sourceCapacities: Map<number, Decimal>
): ResolvedGroupMatch | undefined {
  const siblingInflowAmount = sumMovementGrossAmounts(group.siblingInflows);
  const totalSourceCapacity = sumDecimalMap(sourceCapacities);
  if (siblingInflowAmount.gt(totalSourceCapacity)) {
    return undefined;
  }

  const groupAmount = totalSourceCapacity.minus(siblingInflowAmount);
  if (groupAmount.lte(0)) {
    return undefined;
  }

  const linkedAmounts = allocateResidualAcrossSources(group.sources, sourceCapacities, groupAmount);
  if (!linkedAmounts) {
    return undefined;
  }

  const requireAddressMatch = group.siblingInflows.length > 0;
  const syntheticSource = buildSyntheticSource(group, groupAmount);
  const exactMatches = scoreAndFilterMatches(syntheticSource, exchangeTargets, config).filter((match) => {
    if (!match.targetMovement.amount.eq(groupAmount)) {
      return false;
    }

    if (!requireAddressMatch) {
      return match.matchCriteria.amountSimilarity.eq(1);
    }

    return targetEndpointMatchesAddress(group.toAddress, match.targetMovement);
  });

  if (exactMatches.length !== 1) {
    return undefined;
  }

  const groupMatch = exactMatches[0]!;
  return {
    groupAmount,
    groupMatch,
    linkedAmounts,
    siblingInflowAmount,
    status:
      group.siblingInflows.length > 0 ? 'suggested' : shouldAutoConfirm(groupMatch, config) ? 'confirmed' : 'suggested',
  };
}

function buildSyntheticSource(group: SameHashExternalOutflowGroup, amount: Decimal): LinkableMovement {
  const representative = group.sources[0]!;
  const grossAmount = syntheticGross(group.sources);

  return {
    ...representative,
    amount,
    grossAmount: grossAmount.eq(amount) ? undefined : grossAmount,
  };
}

function buildExpandedMatches(
  groupMatch: PotentialMatch,
  sources: LinkableMovement[],
  sourceCapacities: Map<number, Decimal>,
  linkedAmounts: Map<number, Decimal>
): PotentialMatch[] {
  return sources.flatMap((source) => {
    const consumedAmount = linkedAmounts.get(source.id)!;
    if (consumedAmount.lte(0)) {
      return [];
    }

    return [
      {
        ...groupMatch,
        sourceMovement: {
          ...source,
          amount: sourceCapacities.get(source.id)!,
        },
        consumedAmount,
      },
    ];
  });
}

function deriveSourceCapacities(sources: LinkableMovement[]): Map<number, Decimal> {
  const dedupedFee = syntheticFee(sources);
  const feeBearer = [...sources].sort((left, right) => {
    const feeComparison = sourceFee(right).comparedTo(sourceFee(left));
    if (feeComparison !== 0) return feeComparison;

    // Put the synthetic fee on the largest gross leg to minimize distortion in the expanded pairwise links.
    const grossComparison = sourceGross(right).comparedTo(sourceGross(left));
    if (grossComparison !== 0) return grossComparison;

    return left.transactionId - right.transactionId || left.id - right.id;
  })[0]!;

  const sourceCapacities = new Map<number, Decimal>();
  for (const source of sources) {
    const grossAmount = sourceGross(source);
    const amount = source.id === feeBearer.id ? grossAmount.minus(dedupedFee) : grossAmount;
    sourceCapacities.set(source.id, amount);
  }

  return sourceCapacities;
}

function buildSourceAllocations(
  sources: LinkableMovement[],
  sourceCapacities: Map<number, Decimal>,
  linkedAmounts: Map<number, Decimal>
): SameHashExternalSourceAllocation[] {
  return sources.map((source) => {
    const grossAmount = sourceGross(source);
    const sourceCapacity = sourceCapacities.get(source.id)!;
    const linkedAmount = linkedAmounts.get(source.id)!;
    const unlinkedAmount = sourceCapacity.minus(linkedAmount);

    return {
      sourceTransactionId: source.transactionId,
      grossAmount: grossAmount.toFixed(),
      linkedAmount: linkedAmount.toFixed(),
      feeDeducted: grossAmount.minus(sourceCapacity).toFixed(),
      ...(unlinkedAmount.gt(0) ? { unlinkedAmount: unlinkedAmount.toFixed() } : {}),
    };
  });
}

function allocateResidualAcrossSources(
  sources: LinkableMovement[],
  sourceCapacities: Map<number, Decimal>,
  targetAmount: Decimal
): Map<number, Decimal> | undefined {
  let remaining = targetAmount;
  const linkedAmounts = new Map<number, Decimal>();

  for (const source of sources) {
    const sourceCapacity = sourceCapacities.get(source.id);
    if (!sourceCapacity) {
      return undefined;
    }

    const linkedAmount = remaining.lte(0) ? parseDecimal('0') : Decimal.min(sourceCapacity, remaining);
    linkedAmounts.set(source.id, linkedAmount);
    remaining = remaining.minus(linkedAmount);
  }

  return remaining.eq(0) ? linkedAmounts : undefined;
}

function sourceGross(source: LinkableMovement): Decimal {
  return source.grossAmount ?? source.amount;
}

function sourceFee(source: LinkableMovement): Decimal {
  return sourceGross(source).minus(source.amount);
}

function syntheticGross(sources: LinkableMovement[]): Decimal {
  return sources.reduce((sum, source) => sum.plus(sourceGross(source)), parseDecimal('0'));
}

function sumMovementGrossAmounts(movements: LinkableMovement[]): Decimal {
  return movements.reduce((sum, movement) => sum.plus(sourceGross(movement)), parseDecimal('0'));
}

function sumDecimalMap(amounts: Map<number, Decimal>): Decimal {
  return [...amounts.values()].reduce((sum, amount) => sum.plus(amount), parseDecimal('0'));
}

function syntheticFee(sources: LinkableMovement[]): Decimal {
  return sources.reduce((maxFee, source) => {
    const fee = sourceFee(source);
    return fee.greaterThan(maxFee) ? fee : maxFee;
  }, parseDecimal('0'));
}

function targetEndpointMatchesAddress(expectedAddress: string, target: LinkableMovement): boolean {
  const normalizedAddress = expectedAddress.toLowerCase();

  return (
    target.toAddress?.toLowerCase() === normalizedAddress || target.fromAddress?.toLowerCase() === normalizedAddress
  );
}
