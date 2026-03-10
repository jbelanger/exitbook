import { Decimal } from 'decimal.js';

import type { PotentialMatch } from '../shared/types.js';

export function filterUnsupportedSameHashExternalPartials(matches: PotentialMatch[]): PotentialMatch[] {
  const groupedMatchIdsToDrop = new Set<string>();
  const groupedMatches = new Map<string, PotentialMatch[]>();

  for (const match of matches) {
    if (match.matchCriteria.hashMatch !== true) continue;
    if (match.sourceMovement.sourceType !== 'blockchain') continue;
    if (match.targetMovement.sourceType !== 'exchange') continue;
    if (!match.sourceMovement.blockchainTxHash) continue;

    const key = `${match.targetMovement.movementFingerprint}\u0000${match.sourceMovement.blockchainTxHash}`;
    const existing = groupedMatches.get(key) ?? [];
    existing.push(match);
    groupedMatches.set(key, existing);
  }

  for (const grouped of groupedMatches.values()) {
    const uniqueSourceTxIds = new Set(grouped.map((match) => match.sourceMovement.transactionId));
    if (uniqueSourceTxIds.size < 2) {
      continue;
    }

    const feeDiffs = grouped.map((match) => getSourceFeeDifference(match.sourceMovement));
    const feeBearingSourceCount = feeDiffs.filter((feeDiff) => feeDiff.gt(0)).length;
    const dedupedCapacity = grouped.reduce(
      (sum, match) => sum.plus(match.sourceMovement.grossAmount ?? match.sourceMovement.amount),
      new Decimal(0)
    );
    const maxFee = feeDiffs.reduce((largest, feeDiff) => (feeDiff.gt(largest) ? feeDiff : largest), new Decimal(0));
    const targetAmount = grouped[0]!.targetMovement.amount;

    if (feeBearingSourceCount > 1 || targetAmount.gt(dedupedCapacity.minus(maxFee))) {
      for (const match of grouped) {
        groupedMatchIdsToDrop.add(getMatchId(match));
      }
    }
  }

  return matches.filter((match) => !groupedMatchIdsToDrop.has(getMatchId(match)));
}

function getSourceFeeDifference(sourceMovement: PotentialMatch['sourceMovement']): Decimal {
  const grossAmount = sourceMovement.grossAmount;
  if (!grossAmount) {
    return new Decimal(0);
  }

  const feeDiff = grossAmount.minus(sourceMovement.amount);
  return feeDiff.gt(0) ? feeDiff : new Decimal(0);
}

function getMatchId(match: PotentialMatch): string {
  return `${match.sourceMovement.id}:${match.targetMovement.id}:${match.sourceMovement.assetId}`;
}
