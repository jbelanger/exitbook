import { createMoney, getErrorMessage, parseDecimal } from '@exitbook/core';
import type { KuCoinLedgerEntry } from '@exitbook/exchanges';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { type Result, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

/**
 * Processor for KuCoin exchange data.
 * Handles processing logic for KuCoin transactions including:
 * - Trade processing (buy/sell spot trades)
 * - Deposit handling (transaction type with direction in)
 * - Withdrawal handling (transaction type with direction out)
 * - Fee processing
 * - Rebate handling
 */
export class KuCoinProcessor extends BaseTransactionProcessor {
  constructor() {
    super('kucoin');
  }

  protected processInternal(
    normalizedData: unknown[],
    _sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    const allTransactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const ledgerEntry = item as KuCoinLedgerEntry;

      try {
        // Process ledger entry
        const transaction = this.convertLedgerEntryToTransaction(ledgerEntry);
        if (transaction) {
          allTransactions.push(transaction);
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.warn(`Failed to process KuCoin ledger entry: ${errorMessage}`);
        continue;
      }
    }

    return Promise.resolve(ok(allTransactions));
  }

  /**
   * Convert KuCoin ledger entry to UniversalTransaction
   * Ledger entries represent individual balance changes
   */
  private convertLedgerEntryToTransaction(entry: KuCoinLedgerEntry): UniversalTransaction | undefined {
    const timestamp = entry.timestamp;
    const datetime = entry.datetime;

    const amount = parseDecimal(entry.amount.toString());
    const absAmount = amount.abs();
    const currency = entry.currency;

    // Extract fee information
    const feeCost = entry.fee?.cost ? parseDecimal(entry.fee.cost.toString()) : parseDecimal('0');
    const feeCurrency = entry.fee?.currency || currency;

    // Determine status
    const status = this.mapStatus(entry.status);

    // Map ledger entry types to our transaction types
    switch (entry.type.toLowerCase()) {
      case 'trade':
        // Trade entries - direction determines buy vs sell
        if (entry.direction === 'in') {
          // Buy - received asset
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kucoin',
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
            operation: { category: 'trade', type: 'buy' },
            metadata: {
              ledgerId: entry.id,
              referenceId: entry.referenceId,
              referenceAccount: entry.referenceAccount,
              account: entry.account,
              balanceBefore: entry.before,
              balanceAfter: entry.after,
            },
          };
        } else {
          // Sell - spent asset
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kucoin',
            status,
            movements: {
              inflows: [],
              outflows: [{ asset: currency, amount: createMoney(absAmount.toString(), currency) }],
              primary: {
                asset: currency,
                amount: createMoney((-absAmount.toNumber()).toString(), currency),
                direction: 'out' as const,
              },
            },
            fees: {
              network: undefined,
              platform: createMoney(feeCost.toString(), feeCurrency),
              total: createMoney(feeCost.toString(), feeCurrency),
            },
            operation: { category: 'trade', type: 'sell' },
            metadata: {
              ledgerId: entry.id,
              referenceId: entry.referenceId,
              referenceAccount: entry.referenceAccount,
              account: entry.account,
              balanceBefore: entry.before,
              balanceAfter: entry.after,
            },
          };
        }

      case 'transaction':
        // Transaction type with direction determines deposit vs withdrawal
        if (entry.direction === 'in') {
          // Deposit
          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kucoin',
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
              referenceId: entry.referenceId,
              account: entry.account,
              balanceBefore: entry.before,
              balanceAfter: entry.after,
            },
          };
        } else {
          // Withdrawal - amount includes fee, so outflow is amount minus fee
          const netAmount = absAmount.minus(feeCost);

          return {
            id: entry.id,
            datetime,
            timestamp,
            source: 'kucoin',
            status,
            movements: {
              inflows: [],
              outflows: [{ asset: currency, amount: createMoney(netAmount.toString(), currency) }],
              primary: {
                asset: currency,
                amount: createMoney((-netAmount.toNumber()).toString(), currency),
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
              referenceId: entry.referenceId,
              account: entry.account,
              balanceBefore: entry.before,
              balanceAfter: entry.after,
              grossAmount: absAmount.toString(),
            },
          };
        }

      case 'fee':
        // Fee entry - record only as fee, not as both outflow and fee (to avoid double-counting)
        return {
          id: entry.id,
          datetime,
          timestamp,
          source: 'kucoin',
          status,
          movements: {
            inflows: [],
            outflows: [],
            primary: {
              asset: currency,
              amount: createMoney((-absAmount.toNumber()).toString(), currency),
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
            referenceId: entry.referenceId,
            account: entry.account,
            balanceBefore: entry.before,
            balanceAfter: entry.after,
          },
        };

      case 'rebate':
        // Rebate entry - always an inflow (fee refund or reward)
        return {
          id: entry.id,
          datetime,
          timestamp,
          source: 'kucoin',
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
            referenceId: entry.referenceId,
            account: entry.account,
            balanceBefore: entry.before,
            balanceAfter: entry.after,
          },
        };

      default:
        this.logger.warn(`Unknown ledger entry type: ${entry.type}`);
        return;
    }
  }

  /**
   * Map KuCoin status to our transaction status
   */
  private mapStatus(status: string | undefined): 'pending' | 'ok' | 'canceled' | 'failed' {
    if (!status) return 'ok';

    switch (status.toLowerCase()) {
      case 'pending':
        return 'pending';
      case 'ok':
      case 'completed':
      case 'success':
        return 'ok';
      case 'canceled':
      case 'cancelled':
        return 'canceled';
      case 'failed':
        return 'failed';
      default:
        return 'ok';
    }
  }
}
