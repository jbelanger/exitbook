import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * Branded string type for currency codes (e.g. 'USD', 'BTC', 'ETH')
 * Normalized to uppercase; created via parseCurrency() or cast with `'USD' as Currency`
 */
export type Currency = string & { readonly _brand: 'Currency' };

/**
 * Common fiat currencies
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

/**
 * Parse a raw string into a Currency, normalizing to uppercase.
 * Returns Err for empty or whitespace-only strings.
 */
export function parseCurrency(code: string): Result<Currency, Error> {
  const normalized = code.toUpperCase().trim();
  if (normalized.length === 0) {
    return err(new Error('Currency code cannot be empty'));
  }
  return ok(normalized as Currency);
}

/** True if the currency is a known fiat currency */
export const isFiat = (c: Currency): boolean => FIAT_CURRENCIES.has(c);

/** True if the currency is a known USD-pegged stablecoin */
export const isStablecoin = (c: Currency): boolean => STABLECOINS.has(c);

/** True if the currency is fiat or a stablecoin */
export const isFiatOrStablecoin = (c: Currency): boolean => isFiat(c) || isStablecoin(c);
