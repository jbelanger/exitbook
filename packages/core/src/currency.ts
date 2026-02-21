/**
 * Currency value object
 *
 * Represents a currency code (fiat or crypto)
 * Ensures consistent normalization and provides type safety
 *
 * Examples: USD, EUR, BTC, ETH
 */

/**
 * Common fiat currencies
 * Includes major currencies from around the world
 */
const FIAT_CURRENCIES = new Set([
  // Major currencies
  'USD', // United States Dollar
  'EUR', // Euro
  'GBP', // British Pound
  'JPY', // Japanese Yen
  'CHF', // Swiss Franc
  'CAD', // Canadian Dollar
  'AUD', // Australian Dollar
  'NZD', // New Zealand Dollar
  'CNY', // Chinese Yuan
  'HKD', // Hong Kong Dollar
  'SGD', // Singapore Dollar
  'KRW', // South Korean Won
  'INR', // Indian Rupee
  'MXN', // Mexican Peso
  'BRL', // Brazilian Real
  'ZAR', // South African Rand
  'RUB', // Russian Ruble
  'TRY', // Turkish Lira
  'SEK', // Swedish Krona
  'NOK', // Norwegian Krone
  'DKK', // Danish Krone
  'PLN', // Polish Zloty
  'THB', // Thai Baht
  'IDR', // Indonesian Rupiah
  'MYR', // Malaysian Ringgit
  'PHP', // Philippine Peso
  'CZK', // Czech Koruna
  'ILS', // Israeli New Shekel
  'CLP', // Chilean Peso
  'ARS', // Argentine Peso
  'COP', // Colombian Peso
  'SAR', // Saudi Riyal
  'AED', // UAE Dirham
  'TWD', // Taiwan Dollar
  'RON', // Romanian Leu
  'HUF', // Hungarian Forint
  'BGN', // Bulgarian Lev
  'HRK', // Croatian Kuna
  'ISK', // Icelandic Krona
  'VND', // Vietnamese Dong
  'PKR', // Pakistani Rupee
  'EGP', // Egyptian Pound
  'NGN', // Nigerian Naira
  'UAH', // Ukrainian Hryvnia
  'KES', // Kenyan Shilling
  'PEN', // Peruvian Sol
  'BDT', // Bangladeshi Taka
  'LKR', // Sri Lankan Rupee
  'QAR', // Qatari Riyal
  'KWD', // Kuwaiti Dinar
  'BHD', // Bahraini Dinar
  'OMR', // Omani Rial
  'JOD', // Jordanian Dinar
  'IRR', // Iranian Rial
  'UYU', // Uruguayan Peso
  'VES', // Venezuelan Bolívar
  'GHS', // Ghanaian Cedi
  'TZS', // Tanzanian Shilling
  'UGX', // Ugandan Shilling
  'MAD', // Moroccan Dirham
  'TND', // Tunisian Dinar
  'GEL', // Georgian Lari
  'KZT', // Kazakhstani Tenge
  'UZS', // Uzbekistani Som
  'AZN', // Azerbaijani Manat
]);

/**
 * USD-pegged stablecoins
 * Used for deriving prices from exchange trade data
 */
const STABLECOINS = new Set([
  'USDT', // Tether
  'USDC', // USD Coin
  'BUSD', // Binance USD
  'DAI', // MakerDAO
  'TUSD', // TrueUSD
  'USDP', // Pax Dollar
  'GUSD', // Gemini Dollar
  'FRAX', // Frax
  'LUSD', // Liquity USD
  'USDD', // Decentralized USD
  'USDJ', // JUST Stablecoin
  'USDN', // Neutrino USD
  'UST', // TerraUSD (historical)
  'USTC', // Terra Classic USD
  'FDUSD', // First Digital USD
  'PYUSD', // PayPal USD
  'USDE', // Ethena USDe
  'USDS', // USDS (Spark Protocol)
]);

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
   * Check if this currency is a fiat currency
   */
  isFiat(): boolean {
    return FIAT_CURRENCIES.has(this.code);
  }

  /**
   * Check if this currency is a stablecoin
   */
  isStablecoin(): boolean {
    return STABLECOINS.has(this.code);
  }

  /**
   * Check if this currency is either fiat or a stablecoin
   * Useful for determining if a price can be derived from trade data
   */
  isFiatOrStablecoin(): boolean {
    return this.isFiat() || this.isStablecoin();
  }

  /**
   * For JSON serialization
   */
  toJSON(): string {
    return this.code;
  }
}
