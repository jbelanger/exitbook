import type { RawData } from '@exitbook/data';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney, parseDecimal } from '@exitbook/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { CsvLedgerLiveOperationRow } from './types.js';

/**
 * Processor for Ledger Live CSV operation data.
 * Handles the processing logic for Ledger Live transactions including:
 * - Operation type mapping (IN/OUT/STAKE/DELEGATE/etc.)
 * - Status mapping
 * - Fee handling (including empty fees)
 */
export class LedgerLiveProcessor extends BaseTransactionProcessor {
  constructor() {
    super('ledgerlive');
  }

  protected async processInternal(rawDataItems: RawData[]): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    for (const rawDataItem of rawDataItems) {
      const result = this.processSingle(rawDataItem);
      if (result.isErr()) {
        this.logger.warn(`Failed to process Ledger Live row ${rawDataItem.id}: ${result.error}`);
        continue;
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return Promise.resolve(ok(transactions));
  }

  private convertOperationToTransaction(row: CsvLedgerLiveOperationRow): UniversalTransaction | undefined {
    const operationMapping = this.mapOperationType(row['Operation Type']);

    // Skip transactions that don't map to standard types
    if (!operationMapping) {
      this.logger.debug(
        `Skipping unmapped operation type - Type: ${row['Operation Type']}, Hash: ${row['Operation Hash']}`
      );
      return undefined;
    }

    const timestamp = new Date(row['Operation Date']).getTime();
    const rawAmount = parseDecimal(row['Operation Amount']);
    const absAmount = rawAmount.abs();
    const fee = parseDecimal(row['Operation Fees'] || '0');
    const currency = row['Currency Ticker'];
    const status = this.mapStatus(row['Status']);

    // Network fees for blockchain operations (Ledger Live tracks blockchain txs)
    const networkFee = fee.isZero() ? undefined : createMoney(fee.toString(), currency);
    const totalFee = createMoney(fee.toString(), currency);

    // Determine movement direction and amounts based on operation type
    const { category, type, confidence } = operationMapping;

    // For outgoing operations (withdrawal, stake, fee), amount is spent
    // For incoming operations (deposit, reward, unstake, refund), amount is gained
    const isOutgoing = type === 'withdrawal' || type === 'stake' || type === 'fee';
    const isIncoming = type === 'deposit' || type === 'reward' || type === 'unstake' || type === 'refund';

    // Net amount after fees
    const netAmount = absAmount.minus(fee);

    return {
      // Core fields
      id: row['Operation Hash'],
      datetime: row['Operation Date'],
      timestamp,
      source: 'ledgerlive',
      status,

      // Structured movements
      movements: {
        inflows: isIncoming
          ? [
              {
                asset: currency,
                amount: createMoney(netAmount.toString(), currency),
              },
            ]
          : [],
        outflows: isOutgoing
          ? [
              {
                asset: currency,
                amount: createMoney(absAmount.toString(), currency),
              },
            ]
          : [],
        primary: {
          asset: currency,
          amount: createMoney(isOutgoing ? netAmount.neg().toString() : netAmount.toString(), currency),
          direction: isOutgoing ? ('out' as const) : isIncoming ? ('in' as const) : ('neutral' as const),
        },
      },

      // Structured fees - blockchain operations have network fees
      fees: {
        network: networkFee,
        platform: undefined, // Ledger Live tracks blockchain txs, not exchange fees
        total: totalFee,
      },

      // Operation classification - 9-10/10 confidence based on mapping
      operation: {
        category,
        type,
      },

      // Add note for lower confidence operations
      note:
        confidence === 9
          ? {
              type: 'classification_uncertainty',
              severity: 'info' as const,
              message: `Operation type '${row['Operation Type']}' classified with 9/10 confidence`,
            }
          : undefined,

      // Minimal metadata
      metadata: {
        accountName: row['Account Name'],
        accountXpub: row['Account xpub'],
        operationType: row['Operation Type'],
        countervalueAtExport: row['Countervalue at CSV Export'],
        countervalueAtOperation: row['Countervalue at Operation Date'],
        countervalueTicker: row['Countervalue Ticker'],
        originalRow: row,
      },
    };
  }

  private mapOperationType(operationType: string):
    | {
        category: 'transfer' | 'staking' | 'fee' | 'governance';
        confidence: 9 | 10;
        type: 'deposit' | 'withdrawal' | 'stake' | 'unstake' | 'reward' | 'fee' | 'refund';
      }
    | undefined {
    switch (operationType.toUpperCase()) {
      case 'IN':
        return { category: 'transfer', type: 'deposit', confidence: 10 };
      case 'OUT':
        return { category: 'transfer', type: 'withdrawal', confidence: 10 };
      case 'FEES':
        return { category: 'fee', type: 'fee', confidence: 10 };
      case 'STAKE':
      case 'DELEGATE':
        return { category: 'staking', type: 'stake', confidence: 10 };
      case 'UNDELEGATE':
      case 'WITHDRAW_UNBONDED':
        return { category: 'staking', type: 'unstake', confidence: 10 };
      case 'REWARD':
      case 'REWARD_PAYOUT':
        return { category: 'staking', type: 'reward', confidence: 10 };
      case 'OPT_OUT':
        return { category: 'governance', type: 'refund', confidence: 9 };
      default:
        return undefined; // Unknown operation types - skip them
    }
  }

  private mapStatus(status: string): 'closed' | 'open' | 'canceled' {
    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'closed';
      case 'pending':
        return 'open';
      case 'failed':
        return 'canceled';
      default:
        return 'closed'; // Default to closed for unknown statuses
    }
  }

  private processSingle(rawData: RawData): Result<UniversalTransaction | undefined, string> {
    const row = rawData.raw_data as CsvLedgerLiveOperationRow;

    try {
      const transaction = this.convertOperationToTransaction(row);
      return ok(transaction);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(`Failed to convert operation to transaction: ${errorMessage}`);
    }
  }
}
