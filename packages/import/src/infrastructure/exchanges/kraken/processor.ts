import { createMoney, getErrorMessage, parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { KrakenLedgerEntry } from '@exitbook/exchanges';
import { type Result, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

/**
 * Processor for Kraken exchange data.
 * Handles processing logic for Kraken transactions including:
 * - Trade processing (buy/sell spot trades)
 * - Deposit handling
 * - Withdrawal handling
 * - Order processing
 */
export class KrakenProcessor extends BaseTransactionProcessor {
  constructor() {
    super('kraken');
  }

  protected processInternal(
    normalizedData: unknown[],
    _sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    const allTransactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const ledgerEntry = item as KrakenLedgerEntry;

      try {
        // Process ledger entry
        const transaction = this.convertLedgerEntryToTransaction(ledgerEntry);
        if (transaction) {
          allTransactions.push(transaction);
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.warn(`Failed to process Kraken ledger entry: ${errorMessage}`);
        continue;
      }
    }

    return Promise.resolve(ok(allTransactions));
  }

  /**
   * Normalize Kraken asset symbols by removing X/Z prefixes
   * Kraken uses X prefix for crypto (XXBT, XETH) and Z prefix for fiat (ZUSD, ZEUR)
   */
  private normalizeAsset(asset: string): string {
    // Map of Kraken symbols to standard symbols
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
    if (assetMappings[asset]) {
      return assetMappings[asset];
    }

    // Remove X/Z prefix if present
    if (asset.startsWith('X') || asset.startsWith('Z')) {
      const withoutPrefix = asset.substring(1);
      // Check if the result is in mappings
      if (assetMappings[withoutPrefix]) {
        return assetMappings[withoutPrefix];
      }
      // Return without prefix if it looks reasonable (3+ chars)
      if (withoutPrefix.length >= 3) {
        return withoutPrefix;
      }
    }

    return asset;
  }

  /**
   * Infer blockchain name from asset symbol
   * This is a best-effort mapping
   */
  private inferBlockchainFromAsset(asset: string): string {
    const assetUpper = asset.toUpperCase();

    // Common mappings
    const blockchainMappings: Record<string, string> = {
      BTC: 'bitcoin',
      XBT: 'bitcoin',
      ETH: 'ethereum',
      MATIC: 'polygon',
      SOL: 'solana',
      ADA: 'cardano',
      DOT: 'polkadot',
      AVAX: 'avalanche',
    };

    return blockchainMappings[assetUpper] || assetUpper.toLowerCase();
  }

  /**
   * Convert Kraken ledger entry to UniversalTransaction
   * Ledger entries represent individual balance changes
   */
  private convertLedgerEntryToTransaction(entry: KrakenLedgerEntry): UniversalTransaction | undefined {
    const timestamp = Math.floor(entry.time * 1000);
    const datetime = new Date(timestamp).toISOString();

    const amount = parseDecimal(entry.amount);
    const fee = entry.fee ? parseDecimal(entry.fee) : parseDecimal('0');
    const normalizedAsset = this.normalizeAsset(entry.asset);

    // Determine direction and operation based on entry type
    const isPositive = amount.isPositive();
    const absAmount = amount.abs();

    // Map ledger entry types to our transaction types
    switch (entry.type) {
      case 'deposit':
        // Negative amount = reversal/cancellation, positive amount = actual deposit
        if (isPositive) {
          // Normal deposit
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              outflows: [],
              primary: {
                asset: normalizedAsset,
                amount: createMoney(absAmount.toString(), normalizedAsset),
                direction: 'in' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'transfer', type: 'deposit' },
            metadata: { refid: entry.refid, ledgerId: entry.id, balance: entry.balance },
          };
        } else {
          // Deposit reversal - money goes back
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [],
              outflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              primary: {
                asset: normalizedAsset,
                amount: createMoney((-absAmount.toNumber()).toString(), normalizedAsset),
                direction: 'out' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset), // Negative fee = refund
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'transfer', type: 'withdrawal' },
            metadata: { refid: entry.refid, ledgerId: entry.id, balance: entry.balance, isReversal: true },
          };
        }

      case 'withdrawal':
        // Positive amount = reversal/refund, negative amount = actual withdrawal
        if (isPositive) {
          // Withdrawal reversal - money comes back
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              outflows: [],
              primary: {
                asset: normalizedAsset,
                amount: createMoney(absAmount.toString(), normalizedAsset),
                direction: 'in' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset), // Negative fee = refund
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'transfer', type: 'deposit' },
            metadata: { refid: entry.refid, ledgerId: entry.id, balance: entry.balance, isReversal: true },
          };
        } else {
          // Normal withdrawal
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [],
              outflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              primary: {
                asset: normalizedAsset,
                amount: createMoney((-absAmount.toNumber()).toString(), normalizedAsset),
                direction: 'out' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'transfer', type: 'withdrawal' },
            metadata: { refid: entry.refid, ledgerId: entry.id, balance: entry.balance },
          };
        }

      case 'trade':
        // Trade entries are conversions (e.g., CAD->USD)
        // Positive amount = received, negative = spent
        if (isPositive) {
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              outflows: [],
              primary: {
                asset: normalizedAsset,
                amount: createMoney(absAmount.toString(), normalizedAsset),
                direction: 'in' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'trade', type: 'buy' },
            metadata: { refid: entry.refid, subtype: entry.subtype, ledgerId: entry.id, balance: entry.balance },
          };
        } else {
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [],
              outflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              primary: {
                asset: normalizedAsset,
                amount: createMoney((-absAmount.toNumber()).toString(), normalizedAsset),
                direction: 'out' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'trade', type: 'sell' },
            metadata: { refid: entry.refid, subtype: entry.subtype, ledgerId: entry.id, balance: entry.balance },
          };
        }

      case 'spend':
      case 'receive':
        // These are parts of buy/sell trades
        // We'll create individual transactions for each
        if (isPositive || entry.type === 'receive') {
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              outflows: [],
              primary: {
                asset: normalizedAsset,
                amount: createMoney(absAmount.toString(), normalizedAsset),
                direction: 'in' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'trade', type: 'buy' },
            metadata: { refid: entry.refid, ledgerType: entry.type, ledgerId: entry.id, balance: entry.balance },
          };
        } else {
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [],
              outflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              primary: {
                asset: normalizedAsset,
                amount: createMoney((-absAmount.toNumber()).toString(), normalizedAsset),
                direction: 'out' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'trade', type: 'sell' },
            metadata: { refid: entry.refid, ledgerType: entry.type, ledgerId: entry.id, balance: entry.balance },
          };
        }

      case 'transfer':
        // Internal transfers (e.g., spot<->futures, token migrations like RNDR->RENDER)
        if (isPositive) {
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              outflows: [],
              primary: {
                asset: normalizedAsset,
                amount: createMoney(absAmount.toString(), normalizedAsset),
                direction: 'in' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'transfer', type: 'deposit' },
            metadata: { refid: entry.refid, subtype: entry.subtype, ledgerId: entry.id, balance: entry.balance },
          };
        } else {
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kraken',
            status: 'ok',
            movements: {
              inflows: [],
              outflows: [{ asset: normalizedAsset, amount: createMoney(absAmount.toString(), normalizedAsset) }],
              primary: {
                asset: normalizedAsset,
                amount: createMoney((-absAmount.toNumber()).toString(), normalizedAsset),
                direction: 'out' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(fee.toString(), normalizedAsset),
              total: createMoney(fee.toString(), normalizedAsset),
            },
            operation: { category: 'transfer', type: 'withdrawal' },
            metadata: { refid: entry.refid, subtype: entry.subtype, ledgerId: entry.id, balance: entry.balance },
          };
        }

      default:
        this.logger.warn(`Unknown ledger entry type: ${entry.type}`);
        return;
    }
  }
}
