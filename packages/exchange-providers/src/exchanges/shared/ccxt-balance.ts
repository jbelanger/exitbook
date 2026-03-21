/**
 * Normalize a CCXT balance response into a currency -> total string map.
 */
export function normalizeCCXTBalance(
  ccxtBalance: Record<string, unknown>,
  normalizeAsset?: (assetSymbol: string) => string
): Record<string, string> {
  const balances: Record<string, string> = {};
  const normalize = normalizeAsset ?? ((assetSymbol: string) => assetSymbol);

  for (const [currency, amounts] of Object.entries(ccxtBalance)) {
    if (currency === 'info' || currency === 'timestamp' || currency === 'datetime') {
      continue;
    }

    const total = (amounts as { total?: number }).total ?? 0;
    if (total !== 0) {
      balances[normalize(currency)] = total.toString();
    }
  }

  return balances;
}
