/**
 * Currency value object
 *
 * Represents a currency code (fiat or crypto)
 * Ensures consistent normalization and provides type safety
 *
 * Examples: USD, EUR, BTC, ETH
 */

export class Currency {
  /**
   * Create a Currency from a raw string
   * Normalizes to uppercase and trims whitespace
   */
  static create(code: string): Currency {
    const normalized = code.toUpperCase().trim();

    if (normalized.length === 0) {
      throw new Error('Currency code cannot be empty');
    }

    return new Currency(normalized);
  }

  private readonly code: string;

  private constructor(code: string) {
    this.code = code;
  }

  /**
   * Get the normalized uppercase currency code
   */
  toString(): string {
    return this.code;
  }

  /**
   * Get lowercase version for APIs that require it (e.g., CoinGecko)
   */
  toLowerCase(): string {
    return this.code.toLowerCase();
  }

  /**
   * Check equality with another Currency
   */
  equals(other: Currency): boolean {
    return this.code === other.code;
  }

  /**
   * For JSON serialization
   */
  toJSON(): string {
    return this.code;
  }
}
