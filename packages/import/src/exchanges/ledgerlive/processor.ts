import type { UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';

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

  protected canProcessAdapterType(adapterType: string): boolean {
    return adapterType === 'exchange';
  }

  async process(rawDataItems: StoredRawData<CsvLedgerLiveOperationRow>[]): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${rawDataItems.length} Ledger Live operation rows`);

    const transactions: UniversalTransaction[] = [];

    try {
      for (const rawDataItem of rawDataItems) {
        const row = rawDataItem.rawData.rawData;

        // Skip empty or invalid rows
        if (!row['Operation Date'] || !row['Currency Ticker'] || !row['Operation Amount']) {
          this.logger.warn(`Skipping invalid row with missing required fields - Row: ${JSON.stringify(row)}`);
          continue;
        }

        const transaction = this.convertOperationToTransaction(row);
        if (transaction) {
          transactions.push(transaction);
        }
      }

      this.logger.info(
        `Successfully processed ${transactions.length} Ledger Live transactions from ${rawDataItems.length} rows`
      );
      return transactions;
    } catch (error) {
      this.logger.error(`Failed to process Ledger Live data: ${error}`);
      throw error;
    }
  }

  async processSingle(rawData: StoredRawData<CsvLedgerLiveOperationRow>): Promise<UniversalTransaction | null> {
    try {
      const row = rawData.rawData.rawData;

      // Skip empty or invalid rows
      if (!row['Operation Date'] || !row['Currency Ticker'] || !row['Operation Amount']) {
        this.logger.warn(`Skipping invalid row with missing required fields - Row: ${JSON.stringify(row)}`);
        return null;
      }

      return this.convertOperationToTransaction(row);
    } catch (error) {
      this.handleProcessingError(error, rawData, 'single item processing');
    }
  }
}
