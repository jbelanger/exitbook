import type { CryptoTransaction, ExchangeInfo, TransactionStatus, TransactionType } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import type { CSVConfig } from '../base-csv-adapter.ts';
import { BaseCSVAdapter } from '../base-csv-adapter.ts';
import { RegisterExchangeAdapter } from '../registry/decorators.ts';

interface KuCoinCSVConfig extends CSVConfig { }

// Expected CSV headers for validation
const EXPECTED_HEADERS = {
  TRADING_CSV: 'UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status',
  DEPOSIT_CSV: 'UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Deposit Address,Transfer Network,Status,Remarks',
  WITHDRAWAL_CSV: 'UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Withdrawal Address/Account,Transfer Network,Status,Remarks',
  CONVERT_CSV: 'UID,Account Type,Payment Account,Sell,Buy,Price,Tax,Time of Update(UTC),Status', // Legacy - not used, we get converts from account history
  ACCOUNT_HISTORY_CSV: 'UID,Account Type,Currency,Side,Amount,Fee,Time(UTC),Remark,Type'
};

interface SpotOrderRow {
  UID: string;
  'Account Type': string;
  'Order ID': string;
  'Order Time(UTC)': string;
  Symbol: string;
  Side: string;
  'Order Type': string;
  'Order Price': string;
  'Order Amount': string;
  'Avg. Filled Price': string;
  'Filled Amount': string;
  'Filled Volume': string;
  'Filled Volume (USDT)': string;
  'Filled Time(UTC)': string;
  Fee: string;
  'Fee Currency': string;
  Tax?: string;
  Status: string;
}

interface DepositWithdrawalRow {
  UID: string;
  'Account Type': string;
  'Time(UTC)': string;
  Coin: string;
  Amount: string;
  Fee: string;
  Hash: string;
  'Deposit Address'?: string;
  'Transfer Network': string;
  Status: string;
  Remarks: string;
}

interface AccountHistoryRow {
  UID: string;
  'Account Type': string;
  Currency: string;
  Side: string;
  Amount: string;
  Fee: string;
  'Time(UTC)': string;
  Remark: string;
  Type: string;
}

@RegisterExchangeAdapter({
  exchangeId: 'kucoin',
  displayName: 'KuCoin CSV Import',
  adapterType: 'csv',
  description: 'Import KuCoin transaction data from exported CSV files (trading, deposits, withdrawals, account history)',
  capabilities: {
    supportedOperations: ['importTransactions', 'parseCSV'],
    supportsPagination: false,
    supportsBalanceVerification: false,
    supportsHistoricalData: true,
    requiresApiKey: false,
    supportsCsv: true,
    supportsCcxt: false,
    supportsNative: false
  },
  configValidation: {
    requiredCredentials: [],
    optionalCredentials: [],
    requiredOptions: ['csvDirectories'],
    optionalOptions: ['uid']
  },
  defaultConfig: {
    enableRateLimit: false,
    timeout: 30000
  }
})
export class KuCoinCSVAdapter extends BaseCSVAdapter {
  constructor(config: KuCoinCSVConfig) {
    super(config, 'KuCoinCSVAdapter');
  }

  protected getExpectedHeaders(): Record<string, string> {
    return {
      [EXPECTED_HEADERS.TRADING_CSV]: 'trading',
      [EXPECTED_HEADERS.DEPOSIT_CSV]: 'deposit',
      [EXPECTED_HEADERS.WITHDRAWAL_CSV]: 'withdrawal',
      [EXPECTED_HEADERS.CONVERT_CSV]: 'convert',
      [EXPECTED_HEADERS.ACCOUNT_HISTORY_CSV]: 'account_history'
    };
  }

  protected getFileTypeHandlers(): Record<string, (filePath: string) => Promise<CryptoTransaction[]>> {
    return {
      'trading': (filePath) => this.parseSpotOrders(filePath),
      'deposit': (filePath) => this.parseDepositHistory(filePath),
      'withdrawal': (filePath) => this.parseWithdrawalHistory(filePath),
      'convert': (filePath) => {
        this.logger.warn(`Skipping convert orders CSV file - using account history instead - File: ${filePath}`);
        return Promise.resolve([]);
      },
      'account_history': (filePath) => this.parseAccountHistory(filePath)
    };
  }

  private mapStatus(status: string, type: 'spot' | 'deposit_withdrawal'): TransactionStatus {
    if (!status) return 'pending';

    const statusLower = status.toLowerCase();

    if (type === 'spot') {
      switch (statusLower) {
        case 'deal': return 'closed';
        case 'part_deal': return 'open';
        case 'cancel': return 'canceled';
        default: return 'pending';
      }
    } else { // deposit_withdrawal
      switch (statusLower) {
        case 'success': return 'ok';
        case 'pending': return 'pending';
        case 'failed': return 'failed';
        case 'canceled': return 'canceled';
        default: return 'pending';
      }
    }
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    return {
      id: 'kucoin',
      name: 'KuCoin CSV',
      version: '1.0.0',
      capabilities: {
        fetchMyTrades: true,
        fetchDeposits: true,
        fetchWithdrawals: true,
        fetchLedger: false, // Ledger entries removed to prevent double-counting
        fetchClosedOrders: true,
        fetchBalance: false, // CSV doesn't provide current balances
        fetchOrderBook: false,
        fetchTicker: false
      }
    };
  }


  private async parseSpotOrders(filePath: string): Promise<CryptoTransaction[]> {
    const rows = await this.parseCsvFile<SpotOrderRow>(filePath);
    return this.filterByUid(rows).map(row => this.convertSpotOrderToTransaction(row));
  }

  private async parseDepositHistory(filePath: string): Promise<CryptoTransaction[]> {
    const rows = await this.parseCsvFile<DepositWithdrawalRow>(filePath);
    return this.filterByUid(rows).map(row => this.convertDepositToTransaction(row));
  }

  private async parseWithdrawalHistory(filePath: string): Promise<CryptoTransaction[]> {
    const rows = await this.parseCsvFile<DepositWithdrawalRow>(filePath);
    return this.filterByUid(rows).map(row => this.convertWithdrawalToTransaction(row));
  }

  private async parseAccountHistory(filePath: string): Promise<CryptoTransaction[]> {
    const rows = await this.parseCsvFile<AccountHistoryRow>(filePath);
    const filteredRows = this.filterByUid(rows);

    // Find Convert Market transactions and pair them
    const convertTransactions: CryptoTransaction[] = [];
    const convertMarketRows = filteredRows.filter(row => row.Type === 'Convert Market');

    // Group convert market entries by timestamp
    const convertGroups = new Map<string, AccountHistoryRow[]>();

    for (const row of convertMarketRows) {
      const timestamp = row['Time(UTC)'];
      if (!convertGroups.has(timestamp)) {
        convertGroups.set(timestamp, []);
      }
      convertGroups.get(timestamp)!.push(row);
    }

    // Process each group of convert transactions
    for (const [timestamp, group] of convertGroups) {
      if (group.length === 2) {
        // Should be one deposit and one withdrawal
        const deposit = group.find(row => row.Side === 'Deposit');
        const withdrawal = group.find(row => row.Side === 'Withdrawal');

        if (deposit && withdrawal) {
          const convertTx = this.convertAccountHistoryConvertToTransaction(deposit, withdrawal, timestamp);
          convertTransactions.push(convertTx);
        } else {
          this.logger.warn(`Convert Market group missing deposit/withdrawal pair - Timestamp: ${timestamp}, Group: ${JSON.stringify(group)}`);
        }
      } else {
        this.logger.warn(`Convert Market group has unexpected number of entries - Timestamp: ${timestamp}, Count: ${group.length}, Group: ${JSON.stringify(group)}`);
      }
    }

    return convertTransactions;
  }

  private convertSpotOrderToTransaction(row: SpotOrderRow): CryptoTransaction {
    const timestamp = new Date(row['Filled Time(UTC)']).getTime();
    const [baseCurrency, quoteCurrency] = row.Symbol.split('-');

    return {
      id: row['Order ID'],
      type: 'trade' as TransactionType,
      timestamp,
      datetime: row['Filled Time(UTC)'],
      symbol: `${baseCurrency}/${quoteCurrency}`,
      amount: createMoney(row['Filled Amount'], baseCurrency || 'unknown'),
      side: row.Side.toLowerCase() as 'buy' | 'sell',
      price: createMoney(row['Filled Volume'], quoteCurrency || 'unknown'),
      fee: createMoney(row.Fee, row['Fee Currency']),
      status: this.mapStatus(row.Status, 'spot'),
      info: {
        originalRow: row,
        orderType: row['Order Type'],
        filledVolume: parseDecimal(row['Filled Volume']).toNumber(),
        filledVolumeUSDT: parseDecimal(row['Filled Volume (USDT)']).toNumber(),
        orderTime: row['Order Time(UTC)'],
        orderPrice: parseDecimal(row['Order Price']).toNumber(),
        orderAmount: parseDecimal(row['Order Amount']).toNumber()
      }
    };
  }

  private convertDepositToTransaction(row: DepositWithdrawalRow): CryptoTransaction {
    const timestamp = new Date(row['Time(UTC)']).getTime();

    return {
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
      type: 'deposit' as TransactionType,
      timestamp,
      datetime: row['Time(UTC)'],
      symbol: undefined,
      amount: createMoney(row.Amount, row.Coin),
      side: undefined,
      price: undefined,
      fee: row.Fee ? createMoney(row.Fee, row.Coin) : undefined,
      status: this.mapStatus(row.Status, 'deposit_withdrawal'),
      info: {
        originalRow: row,
        hash: row.Hash,
        network: row['Transfer Network'],
        address: row['Deposit Address'],
        remarks: row.Remarks
      }
    };
  }

  private convertWithdrawalToTransaction(row: DepositWithdrawalRow): CryptoTransaction {
    const timestamp = new Date(row['Time(UTC)']).getTime();

    return {
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
      type: 'withdrawal' as TransactionType,
      timestamp,
      datetime: row['Time(UTC)'],
      symbol: undefined,
      amount: createMoney(row.Amount, row.Coin),
      side: undefined,
      price: undefined,
      fee: row.Fee ? createMoney(row.Fee, row.Coin) : undefined,
      status: this.mapStatus(row.Status, 'deposit_withdrawal'),
      info: {
        originalRow: row,
        hash: row.Hash,
        network: row['Transfer Network'],
        remarks: row.Remarks
      }
    };
  }


  private convertAccountHistoryConvertToTransaction(deposit: AccountHistoryRow, withdrawal: AccountHistoryRow, timestamp: string): CryptoTransaction {
    const timestampMs = new Date(timestamp).getTime();

    const sellCurrency = withdrawal.Currency;
    const sellAmount = withdrawal.Amount;
    const buyCurrency = deposit.Currency;
    const buyAmount = deposit.Amount;

    // Create a synthetic symbol for the conversion
    const symbol = `${sellCurrency}/${buyCurrency}`;

    // Calculate total fees (both deposit and withdrawal fees)
    const withdrawalFee = withdrawal.Fee ? parseDecimal(withdrawal.Fee).toNumber() : 0;
    const depositFee = deposit.Fee ? parseDecimal(deposit.Fee).toNumber() : 0;

    return {
      id: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
      type: 'trade' as TransactionType,
      timestamp: timestampMs,
      datetime: timestamp,
      symbol,
      amount: createMoney(sellAmount, sellCurrency),
      side: 'sell' as 'sell',
      price: createMoney(buyAmount, buyCurrency),
      fee: withdrawalFee + depositFee > 0 ? createMoney((withdrawalFee + depositFee).toString(), sellCurrency) : undefined,
      status: 'closed' as TransactionStatus, // Account history entries are completed transactions
      info: {
        type: 'convert_market',
        sellAmount: parseDecimal(sellAmount).toNumber(),
        sellCurrency,
        buyAmount: parseDecimal(buyAmount).toNumber(),
        buyCurrency,
        withdrawalRow: withdrawal,
        depositRow: deposit,
        withdrawalFee,
        depositFee
      }
    };
  }
}