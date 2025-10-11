/**
 * AssetSymbol value object
 *
 * Ensures consistent normalization of asset symbols (e.g., BTC, ETH)
 * Always stored in uppercase with common aliases handled
 */

export class AssetSymbol {
  /**
   * Create an AssetSymbol from a raw string
   * Normalizes to uppercase and handles common aliases
   */
  static create(symbol: string): AssetSymbol {
    const normalized = symbol.toUpperCase().trim();

    // Handle common aliases
    const aliases: Record<string, string> = {
      WETH: 'ETH',
      WBTC: 'BTC',
    };

    const resolved = aliases[normalized] ?? normalized;
    return new AssetSymbol(resolved);
  }

  private readonly value: string;

  private constructor(symbol: string) {
    this.value = symbol;
  }

  /**
   * Get the normalized uppercase symbol
   */
  toString(): string {
    return this.value;
  }

  /**
   * Check equality with another AssetSymbol
   */
  equals(other: AssetSymbol): boolean {
    return this.value === other.value;
  }

  /**
   * For JSON serialization
   */
  toJSON(): string {
    return this.value;
  }
}
