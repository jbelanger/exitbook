import { createMoney, parseDecimal, type UniversalTransaction } from '@exitbook/core';
import type { ExchangeLedgerEntry } from '@exitbook/exchanges';
import { type Result, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

/**
 * Processor for Coinbase exchange data.
 *
 * Handles Coinbase-specific ledger semantics:
 * - Processes individual ledger entries (no correlation needed)
 * - For withdrawals: fee is INCLUDED in amount, not separate
 * - For trades: fee is separate
 *
 * This differs from DefaultExchangeProcessor which:
 * - Groups correlated ledger entries (2 entries per swap)
 * - Always treats fees as separate deductions
 */
export class CoinbaseProcessor extends BaseTransactionProcessor {
  constructor() {
    super('coinbase');
  }

  protected async processInternal(
    normalizedData: unknown[],
    _sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    const allTransactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const ledgerEntry = item as ExchangeLedgerEntry;

      try {
        const transaction = this.convertLedgerEntryToTransaction(ledgerEntry);
        if (transaction) {
          allTransactions.push(transaction);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to process Coinbase ledger entry ${ledgerEntry.id}: ${errorMessage}`);
        continue;
      }
    }

    return Promise.resolve(ok(allTransactions));
  }

  /**
   * Convert Coinbase ledger entry to UniversalTransaction.
   * Each ledger entry represents an individual balance change.
   */
  private convertLedgerEntryToTransaction(entry: ExchangeLedgerEntry): UniversalTransaction | undefined {
    const timestamp = entry.timestamp;
    const datetime = new Date(timestamp).toISOString();

    const amount = parseDecimal(entry.amount);
    const absAmount = amount.abs();
    const currency = entry.asset;

    // Extract fee information
    const feeCost = entry.fee ? parseDecimal(entry.fee) : parseDecimal('0');
    const feeCurrency = entry.feeCurrency || currency;

    const status = entry.status;

    // Map ledger entry types to UniversalTransaction
    switch (entry.type.toLowerCase()) {
      case 'advanced_trade_fill':
        return this.processAdvancedTradeFill(
          entry,
          amount,
          absAmount,
          currency,
          feeCost,
          feeCurrency,
          timestamp,
          datetime,
          status
        );

      case 'trade':
      case 'buy':
      case 'sell':
        return this.processTrade(entry, amount, absAmount, currency, feeCost, feeCurrency, timestamp, datetime, status);

      case 'transaction':
      case 'send':
        return this.processTransaction(
          entry,
          amount,
          absAmount,
          currency,
          feeCost,
          feeCurrency,
          timestamp,
          datetime,
          status
        );

      case 'fiat_deposit':
      case 'fiat_withdrawal':
        return this.processFiatTransfer(
          entry,
          amount,
          absAmount,
          currency,
          feeCost,
          feeCurrency,
          timestamp,
          datetime,
          status
        );

      case 'fee':
        return this.processFee(entry, absAmount, currency, timestamp, datetime, status);

      case 'rebate':
        return this.processRebate(entry, absAmount, currency, timestamp, datetime, status);

      case 'interest':
        return this.processInterest(entry, absAmount, currency, timestamp, datetime, status);

      case 'retail_simple_dust':
        return this.processDustConversion(entry, amount, absAmount, currency, timestamp, datetime, status);

      case 'subscription':
        return this.processSubscription(entry, amount, absAmount, currency, timestamp, datetime, status);

      default:
        this.logger.warn(`Unknown Coinbase ledger entry type: ${entry.type}`);
        return undefined;
    }
  }

  private processAdvancedTradeFill(
    entry: ExchangeLedgerEntry,
    amount: ReturnType<typeof parseDecimal>,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    feeCost: ReturnType<typeof parseDecimal>,
    feeCurrency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    const isInflow = amount.isPositive();

    // Coinbase fee semantics (verified):
    // - For ALL transactions: amount is GROSS asset movement (what actually moved)
    // - Fees are ALWAYS subtracted separately from balance
    // - Balance change = amount - fee
    // Example: amount=-314.13 (what left), fee=1.88 → balance -= 314.13 + 1.88 = -316.01
    const movementAmount = absAmount;
    const feeForBalanceCalc = feeCost;

    return {
      id: entry.id,
      datetime,
      timestamp,
      source: 'coinbase',
      status,
      movements: {
        inflows: isInflow ? [{ asset: currency, amount: createMoney(movementAmount.toString(), currency) }] : [],
        outflows: !isInflow ? [{ asset: currency, amount: createMoney(movementAmount.toString(), currency) }] : [],
        primary: {
          asset: currency,
          amount: createMoney(isInflow ? movementAmount.toString() : movementAmount.negated().toString(), currency),
          direction: isInflow ? ('in' as const) : ('out' as const),
        },
      },
      fees: {
        network: undefined,
        platform: createMoney(feeForBalanceCalc.toString(), feeCurrency),
        total: createMoney(feeForBalanceCalc.toString(), feeCurrency),
      },
      operation: { category: 'trade', type: 'swap' },
      metadata: {
        ledgerId: entry.id,
        correlationId: entry.correlationId,
        ledgerType: 'advanced_trade_fill',
      },
    };
  }

  private processTrade(
    entry: ExchangeLedgerEntry,
    amount: ReturnType<typeof parseDecimal>,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    feeCost: ReturnType<typeof parseDecimal>,
    feeCurrency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    const isInflow = amount.isPositive();

    // Same fee semantics
    const movementAmount = absAmount;
    const feeForBalanceCalc = feeCost;

    return {
      id: entry.id,
      datetime,
      timestamp,
      source: 'coinbase',
      status,
      movements: {
        inflows: isInflow ? [{ asset: currency, amount: createMoney(movementAmount.toString(), currency) }] : [],
        outflows: !isInflow ? [{ asset: currency, amount: createMoney(movementAmount.toString(), currency) }] : [],
        primary: {
          asset: currency,
          amount: createMoney(isInflow ? movementAmount.toString() : movementAmount.negated().toString(), currency),
          direction: isInflow ? ('in' as const) : ('out' as const),
        },
      },
      fees: {
        network: undefined,
        platform: createMoney(feeForBalanceCalc.toString(), feeCurrency),
        total: createMoney(feeForBalanceCalc.toString(), feeCurrency),
      },
      operation: { category: 'trade', type: 'swap' },
      metadata: {
        ledgerId: entry.id,
        correlationId: entry.correlationId,
      },
    };
  }

  /**
   * Process transaction type (deposit or withdrawal).
   *
   * CRITICAL: For withdrawals, Coinbase includes the fee in the amount.
   * - entry.amount = total deducted from balance (e.g., 17.58425517)
   * - entry.fee = fee portion of that amount (e.g., 0.16425517)
   * - actual sent = amount - fee (e.g., 17.42 actually sent to external address)
   *
   * We need to:
   * - Record outflow as the NET amount sent (amount - fee)
   * - Record fee separately
   * - Total balance change = -amount (already includes fee)
   */
  private processTransaction(
    entry: ExchangeLedgerEntry,
    amount: ReturnType<typeof parseDecimal>,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    feeCost: ReturnType<typeof parseDecimal>,
    feeCurrency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    const isInflow = amount.isPositive();

    if (isInflow) {
      // Deposit - fees are typically zero
      return {
        id: entry.id,
        datetime,
        timestamp,
        source: 'coinbase',
        status,
        movements: {
          inflows: [{ asset: currency, amount: createMoney(absAmount.toString(), currency) }],
          outflows: [],
          primary: {
            asset: currency,
            amount: createMoney(absAmount.toString(), currency),
            direction: 'in' as const,
          },
        },
        fees: {
          network: undefined,
          platform: createMoney(feeCost.toString(), feeCurrency),
          total: createMoney(feeCost.toString(), feeCurrency),
        },
        operation: { category: 'transfer', type: 'deposit' },
        metadata: {
          ledgerId: entry.id,
          correlationId: entry.correlationId,
        },
      };
    } else {
      // Withdrawal - fee is INCLUDED in amount
      // The net amount that actually left Coinbase to external address
      const netAmount = absAmount.minus(feeCost);

      return {
        id: entry.id,
        datetime,
        timestamp,
        source: 'coinbase',
        status,
        movements: {
          inflows: [],
          outflows: [{ asset: currency, amount: createMoney(netAmount.toString(), currency) }],
          primary: {
            asset: currency,
            amount: createMoney(netAmount.negated().toString(), currency),
            direction: 'out' as const,
          },
        },
        fees: {
          network: undefined,
          platform: createMoney(feeCost.toString(), feeCurrency),
          total: createMoney(feeCost.toString(), feeCurrency),
        },
        operation: { category: 'transfer', type: 'withdrawal' },
        metadata: {
          ledgerId: entry.id,
          correlationId: entry.correlationId,
          grossAmount: absAmount.toString(),
        },
      };
    }
  }

  /**
   * Process fiat deposit or withdrawal (CAD/USD)
   */
  private processFiatTransfer(
    entry: ExchangeLedgerEntry,
    amount: ReturnType<typeof parseDecimal>,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    feeCost: ReturnType<typeof parseDecimal>,
    feeCurrency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    const isInflow = amount.isPositive();

    // Same fee semantics
    const movementAmount = absAmount;
    const feeForBalanceCalc = feeCost;

    return {
      id: entry.id,
      datetime,
      timestamp,
      source: 'coinbase',
      status,
      movements: {
        inflows: isInflow ? [{ asset: currency, amount: createMoney(movementAmount.toString(), currency) }] : [],
        outflows: !isInflow ? [{ asset: currency, amount: createMoney(movementAmount.toString(), currency) }] : [],
        primary: {
          asset: currency,
          amount: createMoney(isInflow ? movementAmount.toString() : movementAmount.negated().toString(), currency),
          direction: isInflow ? ('in' as const) : ('out' as const),
        },
      },
      fees: {
        network: undefined,
        platform: createMoney(feeForBalanceCalc.toString(), feeCurrency),
        total: createMoney(feeForBalanceCalc.toString(), feeCurrency),
      },
      operation: { category: 'transfer', type: isInflow ? 'deposit' : 'withdrawal' },
      metadata: {
        ledgerId: entry.id,
        correlationId: entry.correlationId,
      },
    };
  }

  private processFee(
    entry: ExchangeLedgerEntry,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    // Fee entry - record only as fee, not as both outflow and fee (to avoid double-counting)
    return {
      id: entry.id,
      datetime,
      timestamp,
      source: 'coinbase',
      status,
      movements: {
        inflows: [],
        outflows: [],
        primary: {
          asset: currency,
          amount: createMoney(absAmount.negated().toString(), currency),
          direction: 'out' as const,
        },
      },
      fees: {
        network: undefined,
        platform: createMoney(absAmount.toString(), currency),
        total: createMoney(absAmount.toString(), currency),
      },
      operation: { category: 'fee', type: 'fee' },
      metadata: {
        ledgerId: entry.id,
        correlationId: entry.correlationId,
      },
    };
  }

  private processRebate(
    entry: ExchangeLedgerEntry,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    // Rebate entry - always an inflow (fee refund or reward)
    return {
      id: entry.id,
      datetime,
      timestamp,
      source: 'coinbase',
      status,
      movements: {
        inflows: [{ asset: currency, amount: createMoney(absAmount.toString(), currency) }],
        outflows: [],
        primary: {
          asset: currency,
          amount: createMoney(absAmount.toString(), currency),
          direction: 'in' as const,
        },
      },
      fees: {
        network: undefined,
        platform: createMoney('0', currency),
        total: createMoney('0', currency),
      },
      operation: { category: 'fee', type: 'refund' },
      metadata: {
        ledgerId: entry.id,
        correlationId: entry.correlationId,
      },
    };
  }

  private processInterest(
    entry: ExchangeLedgerEntry,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    // Interest earned - always an inflow
    return {
      id: entry.id,
      datetime,
      timestamp,
      source: 'coinbase',
      status,
      movements: {
        inflows: [{ asset: currency, amount: createMoney(absAmount.toString(), currency) }],
        outflows: [],
        primary: {
          asset: currency,
          amount: createMoney(absAmount.toString(), currency),
          direction: 'in' as const,
        },
      },
      fees: {
        network: undefined,
        platform: createMoney('0', currency),
        total: createMoney('0', currency),
      },
      operation: { category: 'staking', type: 'reward' },
      metadata: {
        ledgerId: entry.id,
        correlationId: entry.correlationId,
        ledgerType: 'interest',
      },
    };
  }

  private processDustConversion(
    entry: ExchangeLedgerEntry,
    amount: ReturnType<typeof parseDecimal>,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    const isInflow = amount.isPositive();

    // Dust conversions typically don't have fees, but use amount directly
    return {
      id: entry.id,
      datetime,
      timestamp,
      source: 'coinbase',
      status,
      movements: {
        inflows: isInflow ? [{ asset: currency, amount: createMoney(absAmount.toString(), currency) }] : [],
        outflows: !isInflow ? [{ asset: currency, amount: createMoney(absAmount.toString(), currency) }] : [],
        primary: {
          asset: currency,
          amount: createMoney(amount.toString(), currency),
          direction: isInflow ? ('in' as const) : ('out' as const),
        },
      },
      fees: {
        network: undefined,
        platform: createMoney('0', currency),
        total: createMoney('0', currency),
      },
      operation: { category: 'trade', type: 'swap' },
      metadata: {
        ledgerId: entry.id,
        correlationId: entry.correlationId,
        ledgerType: 'retail_simple_dust',
      },
    };
  }

  private processSubscription(
    entry: ExchangeLedgerEntry,
    amount: ReturnType<typeof parseDecimal>,
    absAmount: ReturnType<typeof parseDecimal>,
    currency: string,
    timestamp: number,
    datetime: string,
    status: ExchangeLedgerEntry['status']
  ): UniversalTransaction {
    const isInflow = amount.isPositive();

    if (isInflow) {
      // Subscription credit - inflow
      return {
        id: entry.id,
        datetime,
        timestamp,
        source: 'coinbase',
        status,
        movements: {
          inflows: [{ asset: currency, amount: createMoney(absAmount.toString(), currency) }],
          outflows: [],
          primary: {
            asset: currency,
            amount: createMoney(absAmount.toString(), currency),
            direction: 'in' as const,
          },
        },
        fees: {
          network: undefined,
          platform: createMoney('0', currency),
          total: createMoney('0', currency),
        },
        operation: { category: 'fee', type: 'refund' },
        metadata: {
          ledgerId: entry.id,
          correlationId: entry.correlationId,
          ledgerType: 'subscription',
        },
      };
    } else {
      // Subscription payment - platform fee, not a transfer
      // Record only as fee, not as both outflow and fee (to avoid double-counting)
      return {
        id: entry.id,
        datetime,
        timestamp,
        source: 'coinbase',
        status,
        movements: {
          inflows: [],
          outflows: [],
          primary: {
            asset: currency,
            amount: createMoney(amount.toString(), currency),
            direction: 'out' as const,
          },
        },
        fees: {
          network: undefined,
          platform: createMoney(absAmount.toString(), currency),
          total: createMoney(absAmount.toString(), currency),
        },
        operation: { category: 'fee', type: 'fee' },
        metadata: {
          ledgerId: entry.id,
          correlationId: entry.correlationId,
          ledgerType: 'subscription',
        },
      };
    }
  }
}
