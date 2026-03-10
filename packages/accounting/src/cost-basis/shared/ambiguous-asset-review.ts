import { err, ok, parseAssetId, type Result } from '@exitbook/core';

import type { AccountingScopedTransaction } from '../matching/build-cost-basis-scoped-transactions.js';

interface AmbiguousScopedAssetCandidate {
  assetId: string;
  assetSymbol: string;
  chain: string;
  movementCount: number;
  transactionCount: number;
  transactionIds: number[];
}

interface AmbiguousScopedAssetGroup {
  chain: string;
  displaySymbol: string;
  normalizedSymbol: string;
  assets: AmbiguousScopedAssetCandidate[];
}

interface MutableCandidate {
  assetId: string;
  assetSymbol: string;
  chain: string;
  movementCount: number;
  transactionIds: Set<number>;
}

function buildGroupKey(chain: string, normalizedSymbol: string): string {
  return `${chain}:${normalizedSymbol}`;
}

function formatCandidate(candidate: AmbiguousScopedAssetCandidate): string {
  return `${candidate.assetId} (${candidate.transactionCount} txs, ${candidate.movementCount} movements)`;
}

function formatAmbiguousAssetReviewMessage(groups: AmbiguousScopedAssetGroup[]): string {
  const lines = ['Ambiguous on-chain asset symbols require review before accounting can proceed:'];

  for (const group of groups) {
    lines.push(`- ${group.chain} / ${group.displaySymbol}: ${group.assets.map(formatCandidate).join(', ')}`);
  }

  lines.push("Review these assets and exclude unwanted contracts with 'exitbook assets exclude --asset-id <assetId>'.");

  return lines.join('\n');
}

export function collectAmbiguousScopedBlockchainSymbols(
  scopedTransactions: AccountingScopedTransaction[]
): Result<AmbiguousScopedAssetGroup[], Error> {
  const groups = new Map<string, Map<string, MutableCandidate>>();

  for (const scopedTransaction of scopedTransactions) {
    const movements = [...scopedTransaction.movements.inflows, ...scopedTransaction.movements.outflows];

    for (const movement of movements) {
      const parsedAssetIdResult = parseAssetId(movement.assetId);
      if (parsedAssetIdResult.isErr()) {
        continue;
      }

      const parsedAssetId = parsedAssetIdResult.value;
      if (parsedAssetId.namespace !== 'blockchain' || parsedAssetId.ref === 'native') {
        continue;
      }

      const normalizedSymbol = movement.assetSymbol.trim().toLowerCase();
      const chain = parsedAssetId.chain ?? 'unknown-chain';
      const groupKey = buildGroupKey(chain, normalizedSymbol);
      const byAssetId = groups.get(groupKey) ?? new Map<string, MutableCandidate>();
      const existing = byAssetId.get(movement.assetId);

      if (existing) {
        existing.movementCount += 1;
        existing.transactionIds.add(scopedTransaction.tx.id);
      } else {
        byAssetId.set(movement.assetId, {
          assetId: movement.assetId,
          assetSymbol: movement.assetSymbol,
          chain,
          movementCount: 1,
          transactionIds: new Set([scopedTransaction.tx.id]),
        });
      }

      groups.set(groupKey, byAssetId);
    }
  }

  const ambiguousGroups = [...groups.entries()]
    .filter(([, byAssetId]) => byAssetId.size > 1)
    .map(([groupKey, byAssetId]) => {
      const assets = [...byAssetId.values()]
        .map<AmbiguousScopedAssetCandidate>((candidate) => ({
          assetId: candidate.assetId,
          assetSymbol: candidate.assetSymbol,
          chain: candidate.chain,
          movementCount: candidate.movementCount,
          transactionCount: candidate.transactionIds.size,
          transactionIds: [...candidate.transactionIds].sort((left, right) => left - right),
        }))
        .sort(
          (left, right) =>
            right.transactionCount - left.transactionCount ||
            right.movementCount - left.movementCount ||
            left.assetId.localeCompare(right.assetId)
        );
      const chain = assets[0]?.chain ?? 'unknown-chain';

      return {
        chain,
        displaySymbol: assets[0]?.assetSymbol ?? groupKey.split(':').slice(1).join(':').toUpperCase(),
        normalizedSymbol: groupKey.split(':').slice(1).join(':'),
        assets,
      };
    })
    .sort(
      (left, right) => left.chain.localeCompare(right.chain) || left.displaySymbol.localeCompare(right.displaySymbol)
    );

  return ok(ambiguousGroups);
}

export function assertNoAmbiguousScopedBlockchainSymbols(
  scopedTransactions: AccountingScopedTransaction[]
): Result<void, Error> {
  const ambiguousGroupsResult = collectAmbiguousScopedBlockchainSymbols(scopedTransactions);
  if (ambiguousGroupsResult.isErr()) {
    return err(ambiguousGroupsResult.error);
  }

  if (ambiguousGroupsResult.value.length === 0) {
    return ok(undefined);
  }

  return err(new Error(formatAmbiguousAssetReviewMessage(ambiguousGroupsResult.value)));
}
