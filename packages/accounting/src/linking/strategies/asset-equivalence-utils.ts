import type { LinkableMovement } from '../matching/linkable-movement.js';

function normalizeAssetSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function areLinkingAssetsEquivalent(source: LinkableMovement, target: LinkableMovement): boolean {
  if (source.assetId === target.assetId) {
    return true;
  }

  return normalizeAssetSymbol(source.assetSymbol) === normalizeAssetSymbol(target.assetSymbol);
}
