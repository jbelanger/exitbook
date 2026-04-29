export function normalizeLedgerTransactionHashForGrouping(value: string | undefined): string | undefined {
  const stripped = value?.trim().replace(/-\d+$/, '');
  if (stripped === undefined || stripped.length === 0) {
    return undefined;
  }

  return isHexTransactionHash(stripped) ? normalizeHexTransactionHash(stripped) : stripped;
}

export function ledgerTransactionHashesMatch(
  sourceHash: string | undefined,
  targetHash: string | undefined
): boolean | undefined {
  const normalizedSource = normalizeOptionalHash(sourceHash);
  const normalizedTarget = normalizeOptionalHash(targetHash);

  if (normalizedSource === undefined || normalizedTarget === undefined) {
    return undefined;
  }

  const sourceHasLogIndex = hasLogIndexSuffix(normalizedSource);
  const targetHasLogIndex = hasLogIndexSuffix(normalizedTarget);
  const comparableSource =
    sourceHasLogIndex && targetHasLogIndex ? normalizedSource : stripLogIndexSuffix(normalizedSource);
  const comparableTarget =
    sourceHasLogIndex && targetHasLogIndex ? normalizedTarget : stripLogIndexSuffix(normalizedTarget);

  if (isHexTransactionHash(comparableSource) || isHexTransactionHash(comparableTarget)) {
    return normalizeHexTransactionHash(comparableSource) === normalizeHexTransactionHash(comparableTarget);
  }

  return comparableSource === comparableTarget;
}

function normalizeOptionalHash(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function hasLogIndexSuffix(value: string): boolean {
  return /-\d+$/.test(value);
}

function stripLogIndexSuffix(value: string): string {
  return value.replace(/-\d+$/, '');
}

function isHexTransactionHash(value: string): boolean {
  return /^(?:0x)?[0-9a-fA-F]+$/.test(value);
}

function normalizeHexTransactionHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}
