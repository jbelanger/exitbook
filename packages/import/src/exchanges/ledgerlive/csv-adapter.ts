import type { CryptoTransaction, TransactionStatus } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { BaseCSVAdapter } from '../../adapters/universal/base-csv-adapter.js';
import type { AdapterInfo, Transaction } from '../../adapters/universal/types.js';
import type { ExchangeAdapterConfig } from '../../adapters/universal/config.js';

// Expected CSV headers for validation
const EXPECTED_HEADERS = {
  LEDGERLIVE_CSV: 'Operation Date,Status,Currency Ticker,Operation Type,Operation Amount,Operation Fees,Operation Hash,Account Name,Account xpub,Countervalue Ticker,Countervalue at Operation Date,Countervalue at CSV Export'
};

interface LedgerLiveOperationRow {
  'Operation Date': string;
  'Status': string;
  'Currency Ticker': string;
  'Operation Type': string;
  'Operation Amount': string;
  'Operation Fees': string;
  'Operation Hash': string;
  'Account Name': string;
  'Account xpub': string;
  'Countervalue Ticker': string;
  'Countervalue at Operation Date': string;
  'Countervalue at CSV Export': string;
}

export class LedgerLiveCSVAdapter extends BaseCSVAdapter {
  constructor(config: ExchangeAdapterConfig) {
    super(config);
  }

  async getInfo(): Promise<AdapterInfo> {
    return {
      id: 'ledgerlive',
      name: 'Ledger Live CSV',
      type: 'exchange',
      subType: 'csv',
      capabilities: {
        supportedOperations: ['fetchTransactions'],
        maxBatchSize: 1000,
        supportsHistoricalData: true,
        supportsPagination: false,
        requiresApiKey: false
      }
    };
  }

  protected convertToUniversalTransaction(cryptoTx: CryptoTransaction): Transaction {
    return {
      id: cryptoTx.id,
      timestamp: cryptoTx.timestamp,
      datetime: cryptoTx.datetime || new Date(cryptoTx.timestamp).toISOString(),
      type: cryptoTx.type,
      status: cryptoTx.status || 'closed',
      amount: cryptoTx.amount,
      fee: cryptoTx.fee,
      price: cryptoTx.price,
      from: cryptoTx.info?.from,
      to: cryptoTx.info?.to,
      symbol: cryptoTx.symbol,
      source: 'ledgerlive',
      network: 'exchange',
      metadata: cryptoTx.info || {}
    };
  }

  protected getExpectedHeaders(): Record<string, string> {
    return {
      [EXPECTED_HEADERS.LEDGERLIVE_CSV]: 'operations'
    };
  }

  protected getFileTypeHandlers(): Record<string, (filePath: string) => Promise<CryptoTransaction[]>> {
    return {
      'operations': (filePath) => this.parseOperations(filePath)
    };
  }

  private mapStatus(status: string): TransactionStatus {
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


  private async parseOperations(filePath: string): Promise<CryptoTransaction[]> {
    const rows = await this.parseCsvFile<LedgerLiveOperationRow>(filePath);
    const transactions: CryptoTransaction[] = [];

    this.logger.info(`Processing ${rows.length} LedgerLive operations from ${filePath}`);

    for (const row of rows) {
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

    this.logger.info(`Converted ${transactions.length} LedgerLive operations to transactions`);
    return transactions;
  }

  private convertOperationToTransaction(row: LedgerLiveOperationRow): CryptoTransaction | null {
    const operationType = this.mapOperationType(row['Operation Type']);

    // Skip transactions that don't map to standard types (like FEES, STAKE, etc.)
    if (!operationType) {
      this.logger.debug(`Skipping non-standard operation type - Type: ${row['Operation Type']}, Hash: ${row['Operation Hash']}`);
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
      id: row['Operation Hash'],
      type: operationType,
      timestamp,
      datetime: row['Operation Date'],
      symbol: undefined, // LedgerLive operations are single-currency
      side: undefined,
      amount: createMoney(netAmount.toNumber(), currency),
      price: undefined,
      fee: createMoney(fee.toNumber(), currency),
      status,
      info: {
        originalRow: row,
        operationType: row['Operation Type'],
        accountName: row['Account Name'],
        accountXpub: row['Account xpub'],
        countervalueTicker: row['Countervalue Ticker'],
        countervalueAtOperation: row['Countervalue at Operation Date'],
        countervalueAtExport: row['Countervalue at CSV Export'],
        grossAmount: amount.toNumber() // Store original amount before fee deduction
      }
    };
  }
}