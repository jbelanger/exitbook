/**
 * Normalize Kraken asset symbols by removing X/Z prefixes.
 * Kraken uses X prefix for crypto (XXBT, XETH) and Z prefix for fiat (ZUSD, ZEUR).
 */
export function normalizeKrakenAsset(assetSymbol: string): string {
  const assetMappings: Record<string, string> = {
    XXBT: 'BTC',
    XBT: 'BTC',
    XETH: 'ETH',
    XXRP: 'XRP',
    XLTC: 'LTC',
    XXLM: 'XLM',
    XXMR: 'XMR',
    XZEC: 'ZEC',
    XXDG: 'DOGE',
    ZUSD: 'USD',
    ZEUR: 'EUR',
    ZCAD: 'CAD',
    ZGBP: 'GBP',
    ZJPY: 'JPY',
    ZCHF: 'CHF',
    ZAUD: 'AUD',
  };

  // Check exact match first
  if (assetMappings[assetSymbol]) {
    return assetMappings[assetSymbol];
  }

  // Remove X/Z prefix if present
  if (assetSymbol.startsWith('X') || assetSymbol.startsWith('Z')) {
    const withoutPrefix = assetSymbol.substring(1);
    // Check if the result is in mappings
    if (assetMappings[withoutPrefix]) {
      return assetMappings[withoutPrefix];
    }
    // Return without prefix if it looks reasonable (3+ chars)
    if (withoutPrefix.length >= 3) {
      return withoutPrefix;
    }
  }

  return assetSymbol;
}
