import type { UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { StoredRawData } from '../../shared/processors/interfaces.ts';
import type { CsvLedgerLiveOperationRow } from './types.ts';

/**
 * Processor for Ledger Live CSV operation data.
 * Handles the processing logic for Ledger Live transactions including:
 * - Operation type mapping (IN/OUT/STAKE/DELEGATE/etc.)
 * - Status mapping
 * - Fee handling (including empty fees)
 */
export class LedgerLiveProcessor extends BaseProcessor<CsvLedgerLiveOperationRow> {
  constructor() {
    super('ledgerlive');
  }

  private convertOperationToTransaction(row: CsvLedgerLiveOperationRow): UniversalTransaction | null {
    const operationType = this.mapOperationType(row['Operation Type']);

    // Skip transactions that don't map to standard types (like FEES, STAKE, etc.)
    if (!operationType) {
      this.logger.debug(
        `Skipping non-standard operation type - Type: ${row['Operation Type']}, Hash: ${row['Operation Hash']}`
      );
      return null;
    }

    const timestamp = new Date(row['Operation Date']).getTime();
    const amount = parseDecimal(row['Operation Amount']).abs(); // Ensure positive amount
    const fee = parseDecimal(row['Operation Fees'] || '0');
    const currency = row['Currency Ticker'];
    const status = this.mapStatus(row['Status']);

    // For LedgerLive, negative amounts in OUT operations are normal
    // The mapOperationType already determines if it's deposit/withdrawal
    const netAmount = amount.minus(fee);

    return {
      amount: createMoney(netAmount.toNumber(), currency),
      datetime: row['Operation Date'],
      fee: createMoney(fee.toNumber(), currency),
      id: row['Operation Hash'],
      metadata: {
        accountName: row['Account Name'],
        accountXpub: row['Account xpub'],
        countervalueAtExport: row['Countervalue at CSV Export'],
        countervalueAtOperation: row['Countervalue at Operation Date'],
        countervalueTicker: row['Countervalue Ticker'],
        grossAmount: amount.toNumber(), // Store original amount before fee deduction
        operationType: row['Operation Type'],
        originalRow: row,
      },
      network: 'exchange',
      price: undefined,
      source: 'ledgerlive',
      status,
      symbol: undefined,
      timestamp,
      type: operationType,
    };
  }

  private mapOperationType(operationType: string): 'trade' | 'deposit' | 'withdrawal' | null {
    switch (operationType.toUpperCase()) {
      case 'IN':
        return 'deposit';
      case 'OUT':
        return 'withdrawal';
      case 'FEES':
        return null; // Fee-only transactions will be handled separately
      case 'STAKE':
      case 'DELEGATE':
      case 'UNDELEGATE':
      case 'WITHDRAW_UNBONDED':
      case 'OPT_OUT':
        return null; // These are special operations, handled as metadata
      default:
        return null;
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

  private processSingle(
    rawData: StoredRawData<CsvLedgerLiveOperationRow>
  ): Result<UniversalTransaction | null, string> {
    const row = rawData.rawData;

    // Skip empty or invalid rows
    if (!row['Operation Date'] || !row['Currency Ticker'] || !row['Operation Amount']) {
      return err(
        `Missing required fields - Operation Date: ${row['Operation Date']}, Currency Ticker: ${row['Currency Ticker']}, Operation Amount: ${row['Operation Amount']}`
      );
    }

    try {
      const transaction = this.convertOperationToTransaction(row);
      return ok(transaction);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(`Failed to convert operation to transaction: ${errorMessage}`);
    }
  }

  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'exchange';
  }

  protected async processInternal(
    rawDataItems: StoredRawData<CsvLedgerLiveOperationRow>[]
  ): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    for (const rawDataItem of rawDataItems) {
      const result = this.processSingle(rawDataItem);
      if (result.isErr()) {
        this.logger.warn(`Failed to process Ledger Live row ${rawDataItem.sourceTransactionId}: ${result.error}`);
        continue;
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return ok(transactions);
  }
}
