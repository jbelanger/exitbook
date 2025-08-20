import type { CryptoTransaction, ExchangeInfo, TransactionStatus } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import type { CSVConfig } from './base-csv-adapter.ts';
import { BaseCSVAdapter } from './index.ts';


interface LedgerLiveCSVConfig extends CSVConfig { }

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
  constructor(config: LedgerLiveCSVConfig) {
    super(config, 'LedgerLiveCSVAdapter');
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

  public async getExchangeInfo(): Promise<ExchangeInfo> {
    return {
      id: 'ledgerlive',
      name: 'Ledger Live CSV',
      version: '1.0.0',
      capabilities: {
        fetchMyTrades: false, // LedgerLive doesn't have traditional trades
        fetchDeposits: true,
        fetchWithdrawals: true,
        fetchLedger: true,
        fetchClosedOrders: false,
        fetchBalance: false, // CSV doesn't provide current balances
        fetchOrderBook: false,
        fetchTicker: false
      }
    };
  }

  private async parseOperations(filePath: string): Promise<CryptoTransaction[]> {
    const rows = await this.parseCsvFile<LedgerLiveOperationRow>(filePath);
    const transactions: CryptoTransaction[] = [];

    this.logger.info(`Processing ${rows.length} LedgerLive operations from ${filePath}`);

    for (const row of rows) {
      // Skip empty or invalid rows
      if (!row['Operation Date'] || !row['Currency Ticker'] || !row['Operation Amount']) {
        this.logger.warn('Skipping invalid row with missing required fields', { row });
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
      this.logger.debug('Skipping non-standard operation type', {
        type: row['Operation Type'],
        hash: row['Operation Hash']
      });
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