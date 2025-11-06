// Interactive prompts for prices command
// Handles user input for manual price entry

import * as p from '@clack/prompts';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import { handleCancellation, isCancelled } from '../shared/prompts.js';

/**
 * Manual price entry data
 */
export interface ManualPriceEntry {
  /** Price value as decimal */
  price: Decimal;
  /** Currency of the price (e.g., 'USD') */
  currency: string;
  /** Source attribution for manual entry */
  source: string;
}

/**
 * Prompt user to provide manual price for an asset
 *
 * @param asset - Asset symbol (e.g., 'BTC', 'ETH')
 * @param timestamp - Transaction timestamp for context
 * @param suggestedCurrency - Suggested currency for price (default: 'USD')
 * @returns Manual price entry or undefined if user skips
 */
export async function promptManualPrice(
  asset: string,
  timestamp: Date,
  suggestedCurrency = 'USD'
): Promise<ManualPriceEntry | undefined> {
  // Ask if user wants to provide manual price
  const shouldProvide = await p.confirm({
    message: `Asset ${asset} not found in price providers. Would you like to provide the price manually?`,
    initialValue: false,
  });

  if (isCancelled(shouldProvide)) {
    handleCancellation();
  }

  if (!shouldProvide) {
    return undefined;
  }

  // Show timestamp context
  const formattedDate = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
  const formattedTime = timestamp.toISOString().split('T')[1]?.split('.')[0]; // HH:MM:SS

  p.note(
    `Transaction date: ${formattedDate} ${formattedTime}\n` + `This will help you find the correct historical price.`,
    'Context'
  );

  // Prompt for price value
  const priceValue = await p.text({
    message: `Price of ${asset} at ${formattedDate}:`,
    placeholder: `Enter price in ${suggestedCurrency} (e.g., 45000.50)`,
    validate: (value) => {
      if (!value) {
        return 'Please enter a price';
      }
      try {
        const decimal = parseDecimal(value);
        if (decimal.lte(0)) {
          return 'Price must be greater than 0';
        }
      } catch {
        return 'Please enter a valid number';
      }
    },
  });

  if (isCancelled(priceValue)) {
    handleCancellation();
  }

  // Prompt for currency (with default)
  const currency = await p.text({
    message: 'Currency:',
    placeholder: suggestedCurrency,
    initialValue: suggestedCurrency,
    validate: (value) => {
      if (!value) {
        return 'Please enter a currency';
      }
      if (!/^[A-Z]{3,10}$/i.test(value)) {
        return 'Currency should be 3-10 uppercase letters (e.g., USD, EUR)';
      }
    },
  });

  if (isCancelled(currency)) {
    handleCancellation();
  }

  // Prompt for source attribution (optional but recommended)
  const source = await p.text({
    message: 'Source (optional):',
    placeholder: 'e.g., CoinMarketCap, manual calculation',
    initialValue: 'manual',
  });

  if (isCancelled(source)) {
    handleCancellation();
  }

  return {
    price: parseDecimal(priceValue),
    currency: currency.toUpperCase(),
    source: source || 'manual',
  };
}

/**
 * Prompt user whether to continue after multiple failures
 *
 * @param failureCount - Number of consecutive failures
 * @param totalRemaining - Total transactions remaining
 * @returns true if user wants to continue, false otherwise
 */
export async function promptContinueAfterFailures(failureCount: number, totalRemaining: number): Promise<boolean> {
  const shouldContinue = await p.confirm({
    message:
      `${failureCount} consecutive failures detected. ` +
      `${totalRemaining} transactions remaining. Continue processing?`,
    initialValue: false,
  });

  if (isCancelled(shouldContinue)) {
    handleCancellation();
  }

  return shouldContinue;
}

/**
 * Show a summary of manual price entries
 *
 * @param manualEntries - Array of manual price entries with asset info
 */
export function showManualEntriesSummary(manualEntries: { asset: string; currency: string; price: string }[]): void {
  if (manualEntries.length === 0) {
    return;
  }

  const lines = manualEntries.map((entry) => `  • ${entry.asset}: ${entry.price} ${entry.currency}`);

  p.note(lines.join('\n'), `Manual prices provided (${manualEntries.length})`);
}

/**
 * Manual FX rate entry data
 */
export interface ManualFxRateEntry {
  /** FX rate as decimal (e.g., 1.08 for EUR→USD) */
  rate: Decimal;
  /** Source attribution for manual entry */
  source: string;
}

/**
 * Prompt user to provide manual FX rate
 *
 * @param sourceCurrency - Source currency (e.g., 'EUR', 'CAD')
 * @param targetCurrency - Target currency (always 'USD' currently)
 * @param timestamp - Transaction timestamp for context
 * @returns Manual FX rate entry or undefined if user skips
 */
export async function promptManualFxRate(
  sourceCurrency: string,
  targetCurrency: string,
  timestamp: Date
): Promise<ManualFxRateEntry | undefined> {
  // Ask if user wants to provide manual FX rate
  const shouldProvide = await p.confirm({
    message: `FX rate ${sourceCurrency}→${targetCurrency} not found in providers. Would you like to provide it manually?`,
    initialValue: false,
  });

  if (isCancelled(shouldProvide)) {
    handleCancellation();
  }

  if (!shouldProvide) {
    return undefined;
  }

  // Show timestamp context
  const formattedDate = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD

  p.note(
    `Transaction date: ${formattedDate}\n` + `Example: If 1 ${sourceCurrency} = 1.08 ${targetCurrency}, enter 1.08`,
    'Context'
  );

  // Prompt for FX rate value
  const rateValue = await p.text({
    message: `FX rate ${sourceCurrency}→${targetCurrency} on ${formattedDate}:`,
    placeholder: 'e.g., 1.08',
    validate: (value) => {
      if (!value) {
        return 'Please enter an FX rate';
      }
      try {
        const decimal = parseDecimal(value);
        if (decimal.lte(0)) {
          return 'FX rate must be greater than 0';
        }
      } catch {
        return 'Please enter a valid number';
      }
    },
  });

  if (isCancelled(rateValue)) {
    handleCancellation();
  }

  // Prompt for source attribution (optional but recommended)
  const source = await p.text({
    message: 'Source (optional):',
    placeholder: 'e.g., xe.com, bank website, manual calculation',
    initialValue: 'user-provided',
  });

  if (isCancelled(source)) {
    handleCancellation();
  }

  return {
    rate: parseDecimal(rateValue),
    source: source || 'user-provided',
  };
}
