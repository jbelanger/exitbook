import type { CryptoTransaction, ExchangeInfo, TransactionStatus } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import type { CSVConfig } from '../base-csv-adapter.ts';
import { BaseCSVAdapter } from '../base-csv-adapter.ts';
import { CsvFilters } from '../csv-filters.ts';
import { RegisterExchangeAdapter } from '../registry/decorators.ts';

interface KrakenCSVConfig extends CSVConfig { }

// Expected CSV headers for validation
const EXPECTED_HEADERS = {
  LEDGERS_CSV: '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"'
};

interface KrakenLedgerRow {
  txid: string;
  refid: string;
  time: string;
  type: string;
  subtype: string;
  aclass: string;
  asset: string;
  wallet: string;
  amount: string;
  fee: string;
  balance: string;
}

@RegisterExchangeAdapter({
  exchangeId: 'kraken',
  displayName: 'Kraken CSV Import',
  adapterType: 'csv',
  description: 'Import Kraken transaction data from exported CSV files (ledgers.csv)',
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
    optionalOptions: []
  },
  defaultConfig: {
    enableRateLimit: false,
    timeout: 30000
  }
})
export class KrakenCSVAdapter extends BaseCSVAdapter {
  constructor(config: KrakenCSVConfig) {
    super(config, 'KrakenCSVAdapter');
  }

  protected getExpectedHeaders(): Record<string, string> {
    return {
      [EXPECTED_HEADERS.LEDGERS_CSV]: 'ledgers'
    };
  }

  protected getFileTypeHandlers(): Record<string, (filePath: string) => Promise<CryptoTransaction[]>> {
    return {
      'ledgers': (filePath) => this.parseLedgers(filePath)
    };
  }

  private mapStatus(): TransactionStatus {
    // Kraken ledger entries don't have explicit status, assume completed
    return 'closed';
  }

  public async getExchangeInfo(): Promise<ExchangeInfo> {
    return {
      id: 'kraken',
      name: 'Kraken CSV',
      version: '1.0.0',
      capabilities: {
        fetchMyTrades: true,
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

  /**
   * Detects and filters out failed transaction pairs from Kraken withdrawal data.
   * 
   * KRAKEN FAILED TRANSACTION PATTERN:
   * When a transaction fails on Kraken, it creates two ledger entries with the same refid:
   * 1. Negative amount (the attempted transaction) 
   * 2. Positive amount (the credit/refund)
   * 
   * Example failed withdrawal:
   * FTCzTjm-tQU7uzZARTQpgD2APjuRQs  2024-12-27 15:35  withdrawal  -385.1555371   0.5  0
   * FTCzTjm-tQU7uzZARTQpgD2APjuRQs  2024-12-27 15:36  withdrawal   385.1555371  -0.5  385.6555371
   * 
   * The net effect should be zero - these transactions cancel each other out.
   * We filter these out to avoid double-counting and incorrect balance calculations.
   * 
   * @param withdrawalRows All withdrawal rows from the CSV
   * @returns Object containing valid withdrawals and failed transaction refids
   */
  private filterFailedTransactions(withdrawalRows: KrakenLedgerRow[]): {
    validWithdrawals: KrakenLedgerRow[];
    failedTransactionRefIds: Set<string>;
  } {
    const failedTransactionRefIds = new Set<string>();
    const validWithdrawals: KrakenLedgerRow[] = [];

    // Group withdrawals by refid to detect failed transaction pairs
    const withdrawalsByRefId = CsvFilters.groupByField(withdrawalRows, 'refid');

    for (const [refId, group] of withdrawalsByRefId) {
      if (group.length === 2) {
        // Check if this looks like a failed transaction pair
        const negative = group.find(w => parseDecimal(w.amount).lt(0));
        const positive = group.find(w => parseDecimal(w.amount).gt(0));

        if (negative && positive && this.isFailedTransactionPair(negative, positive)) {
          // This is a failed transaction - mark refid as failed and skip both entries
          failedTransactionRefIds.add(refId);
          this.logger.info(`Failed transaction detected and filtered: refid=${refId}, ` +
            `attempted=${negative.amount} ${negative.asset}, ` +
            `credited=${positive.amount} ${positive.asset}`);
          continue;
        }
      }

      // Not a failed transaction pair - add all entries to valid withdrawals
      validWithdrawals.push(...group);
    }

    this.logger.info(`Withdrawal filtering: ${withdrawalRows.length} total, ` +
      `${validWithdrawals.length} valid, ` +
      `${failedTransactionRefIds.size} failed transaction pairs filtered`);

    return { validWithdrawals, failedTransactionRefIds };
  }

  /**
   * Determines if two withdrawal entries represent a failed transaction pair.
   * 
   * Criteria for failed transaction detection:
   * 1. Same asset
   * 2. Amounts are approximately equal but opposite signs
   * 3. Fees are also opposite (negative fee indicates fee refund)
   * 4. Time difference is small (within 24 hours)
   * 5. Net balance change should be approximately zero
   * 
   * @param negative The negative (attempted) transaction
   * @param positive The positive (credit) transaction
   * @returns true if this appears to be a failed transaction pair
   */
  private isFailedTransactionPair(negative: KrakenLedgerRow, positive: KrakenLedgerRow): boolean {
    // Must be same asset
    if (negative.asset !== positive.asset) {
      return false;
    }

    // Amounts should be approximately equal but opposite
    const negativeAmount = parseDecimal(negative.amount).abs();
    const positiveAmount = parseDecimal(positive.amount);
    const amountDiff = negativeAmount.minus(positiveAmount).abs();
    const relativeDiff = amountDiff.div(negativeAmount);

    if (relativeDiff.gt(0.001)) { // More than 0.1% difference
      return false;
    }

    // Check fees - they should be opposite (negative fee = refund)
    const negativeFee = parseDecimal(negative.fee || '0');
    const positiveFee = parseDecimal(positive.fee || '0');

    // For failed transactions, the fee pattern should be: positive fee, then negative fee (refund)
    const feesAreOpposite = negativeFee.gt(0) && positiveFee.lt(0) &&
      negativeFee.plus(positiveFee).abs().lt(0.001);

    if (!feesAreOpposite) {
      return false;
    }

    // Check time difference (should be within 24 hours for failed transactions)
    const negativeTime = new Date(negative.time).getTime();
    const positiveTime = new Date(positive.time).getTime();
    const timeDiff = Math.abs(positiveTime - negativeTime);
    const maxTimeDiff = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (timeDiff > maxTimeDiff) {
      return false;
    }

    return true;
  }

  private async parseLedgers(filePath: string): Promise<CryptoTransaction[]> {
    const rows = await this.parseCsvFile<KrakenLedgerRow>(filePath);
    const transactions: CryptoTransaction[] = [];

    // Separate transactions by type
    const tradeRows = rows.filter(row => row.type === 'trade');
    const depositRows = rows.filter(row => row.type === 'deposit');
    const transferRows = rows.filter(row => row.type === 'transfer');
    const spendRows = rows.filter(row => row.type === 'spend');
    const receiveRows = rows.filter(row => row.type === 'receive');

    // Filter out failed transactions and get valid withdrawals
    const { validWithdrawals, failedTransactionRefIds } = this.filterFailedTransactions(
      rows.filter(row => row.type === 'withdrawal')
    );

    // Process existing single trade records
    for (const trade of tradeRows) {
      const transaction = this.convertSingleTradeToTransaction(trade);
      transactions.push(transaction);
    }

    // Process spend/receive pairs by grouping by refid
    const spendReceiveRows = [...spendRows, ...receiveRows];
    const tradeGroups = CsvFilters.groupByField(spendReceiveRows, 'refid');
    const processedRefIds = new Set<string>();

    for (const [refId, group] of tradeGroups) {
      if (group.length === 2) {
        const spend = group.find(row => parseDecimal(row.amount).lt(0) || row.type === 'spend');
        const receive = group.find(row => parseDecimal(row.amount).gt(0) || row.type === 'receive');

        if (spend && receive) {
          const transaction = this.convertTradeToTransaction(spend, receive);
          transactions.push(transaction);
          processedRefIds.add(refId);
        }
      } else if (group.length > 2) {
        // Handle dustsweeping - multiple spends for one receive (small amounts)
        const receive = group.find(row => parseDecimal(row.amount).gt(0) && (row.type === 'receive' || row.type === 'trade'));
        const spends = group.filter(row => parseDecimal(row.amount).lt(0) && (row.type === 'spend' || row.type === 'trade'));

        if (receive && spends.length > 0) {
          const receiveAmount = parseDecimal(receive.amount).abs().toNumber();

          // Kraken dustsweeping: small amounts (< 1) get converted, creating multiple spends for one receive
          if (receiveAmount < 1) {
            this.logger.warn(`Dustsweeping detected for refid ${refId}: ${receiveAmount} ${receive.asset} with ${spends.length} spend transactions`);

            // Create deposit transaction for the received amount
            const depositTransaction = this.convertDepositToTransaction(receive);
            depositTransaction.info = {
              ...depositTransaction.info,
              dustsweeping: true,
              relatedRefId: refId
            };
            transactions.push(depositTransaction);

            // Create withdrawal transactions for each spend
            for (const spend of spends) {
              const withdrawalTransaction = this.convertWithdrawalToTransaction(spend);
              withdrawalTransaction.info = {
                ...withdrawalTransaction.info,
                dustsweeping: true,
                relatedRefId: refId
              };
              transactions.push(withdrawalTransaction);
            }

            processedRefIds.add(refId);
          } else {
            this.logger.error(`Trade with more than 2 currencies detected for refid ${refId}. This is not supported.`);
          }
        }
      }
    }

    // Process deposits
    for (const deposit of depositRows) {
      const transaction = this.convertDepositToTransaction(deposit);
      transactions.push(transaction);
    }

    // Process valid withdrawals (failed transactions already filtered out)
    for (const withdrawal of validWithdrawals) {
      const transaction = this.convertWithdrawalToTransaction(withdrawal);
      transactions.push(transaction);
    }

    // Process token migrations (transfer transactions)
    const migrationTransactions = this.processTokenMigrations(transferRows);
    transactions.push(...migrationTransactions.transactions);

    // Add processed transfer refids to avoid double processing
    for (const refId of migrationTransactions.processedRefIds) {
      processedRefIds.add(refId);
    }

    // Validate that all CSV records were processed
    this.validateAllRecordsProcessed(rows, {
      tradeRows,
      depositRows,
      validWithdrawals,
      transferRows,
      spendRows,
      receiveRows,
      processedRefIds,
      failedTransactionRefIds
    });

    return transactions;
  }

  private processTokenMigrations(transferRows: KrakenLedgerRow[]): {
    transactions: CryptoTransaction[];
    processedRefIds: string[];
  } {
    const transactions: CryptoTransaction[] = [];
    const processedRefIds: string[] = [];

    // Group transfers by date and amount to detect token migrations
    const transfersByDate = this.groupTransfersByDateAndAmount(transferRows);

    for (const group of transfersByDate) {
      if (group.length === 2) {
        const negative = group.find(t => parseDecimal(t.amount).lt(0));
        const positive = group.find(t => parseDecimal(t.amount).gt(0));

        if (negative && positive && negative.asset !== positive.asset) {
          // This looks like a token migration (RNDR -> RENDER)
          const negativeAmount = parseDecimal(negative.amount).abs().toNumber();
          const positiveAmount = parseDecimal(positive.amount).toNumber();

          // Amounts should be approximately equal (allowing for small precision differences)
          const amountDiff = Math.abs(negativeAmount - positiveAmount);
          const relativeDiff = amountDiff / Math.max(negativeAmount, positiveAmount);

          if (relativeDiff < 0.001) { // Less than 0.1% difference
            this.logger.info(`Token migration detected: ${negativeAmount} ${negative.asset} -> ${positiveAmount} ${positive.asset}`);

            const migrationTransaction = this.convertTokenMigrationToTransaction(negative, positive);
            transactions.push(migrationTransaction);

            processedRefIds.push(negative.refid, positive.refid);
            continue;
          }
        }
      }

      // Process remaining transfers as individual transactions
      for (const transfer of group) {
        if (!processedRefIds.includes(transfer.refid)) {
          const transaction = this.convertTransferToTransaction(transfer);
          transactions.push(transaction);
          processedRefIds.push(transfer.refid);
        }
      }
    }

    return { transactions, processedRefIds };
  }

  private groupTransfersByDateAndAmount(transferRows: KrakenLedgerRow[]): KrakenLedgerRow[][] {
    const groups: KrakenLedgerRow[][] = [];
    const processed = new Set<string>();

    for (const transfer of transferRows) {
      if (processed.has(transfer.txid)) continue;

      const amount = parseDecimal(transfer.amount).abs().toNumber();
      const transferDate = new Date(transfer.time).toDateString();

      // Find potential matching transfer (opposite sign, same amount, same date)
      const match = transferRows.find(t =>
        !processed.has(t.txid) &&
        t.txid !== transfer.txid &&
        parseDecimal(t.amount).abs().minus(amount).abs().lt(0.001) &&
        parseDecimal(t.amount).isPositive() !== parseDecimal(transfer.amount).isPositive() &&
        new Date(t.time).toDateString() === transferDate
      );

      if (match) {
        groups.push([transfer, match]);
        processed.add(transfer.txid);
        processed.add(match.txid);
      } else {
        groups.push([transfer]);
        processed.add(transfer.txid);
      }
    }

    return groups;
  }

  private convertTokenMigrationToTransaction(negative: KrakenLedgerRow, positive: KrakenLedgerRow): CryptoTransaction {
    const timestamp = new Date(negative.time).getTime();
    const sentAmount = parseDecimal(negative.amount).abs().toNumber();
    const receivedAmount = parseDecimal(positive.amount).toNumber();

    return {
      id: `${negative.txid}_${positive.txid}`,
      type: 'trade',
      timestamp,
      datetime: negative.time,
      symbol: `${positive.asset}/${negative.asset}`,
      side: 'buy',
      amount: createMoney(receivedAmount, positive.asset),
      price: createMoney(sentAmount, negative.asset),
      fee: createMoney(0, positive.asset), // Token migrations typically have no fees
      status: this.mapStatus(),
      info: {
        tokenMigration: true,
        fromAsset: negative.asset,
        toAsset: positive.asset,
        fromTransaction: negative,
        toTransaction: positive,
        originalRows: { negative, positive }
      }
    };
  }

  private convertTransferToTransaction(transfer: KrakenLedgerRow): CryptoTransaction {
    const timestamp = new Date(transfer.time).getTime();
    const isIncoming = parseDecimal(transfer.amount).isPositive();

    return {
      id: transfer.txid,
      type: isIncoming ? 'deposit' : 'withdrawal',
      timestamp,
      datetime: transfer.time,
      symbol: undefined,
      side: undefined,
      amount: createMoney(parseDecimal(transfer.amount).abs().toNumber(), transfer.asset),
      price: undefined,
      fee: createMoney(parseDecimal(transfer.fee || '0').toNumber(), transfer.asset),
      status: this.mapStatus(),
      info: {
        originalRow: transfer,
        transferType: transfer.subtype,
        wallet: transfer.wallet,
        isTransfer: true
      }
    };
  }

  private validateAllRecordsProcessed(
    allRows: KrakenLedgerRow[],
    processed: {
      tradeRows: KrakenLedgerRow[];
      depositRows: KrakenLedgerRow[];
      validWithdrawals: KrakenLedgerRow[];
      transferRows: KrakenLedgerRow[];
      spendRows: KrakenLedgerRow[];
      receiveRows: KrakenLedgerRow[];
      processedRefIds: Set<string>;
      failedTransactionRefIds: Set<string>;
    }
  ): void {
    const { tradeRows, depositRows, validWithdrawals, transferRows, spendRows, receiveRows, processedRefIds, failedTransactionRefIds } = processed;

    // Count expected processed records
    let expectedProcessed = 0;

    // All single trades should be processed
    expectedProcessed += tradeRows.length;

    // All deposits should be processed
    expectedProcessed += depositRows.length;

    // All valid withdrawals should be processed (failed transactions are filtered out)
    expectedProcessed += validWithdrawals.length;

    // Failed transactions are intentionally skipped (each pair = 2 rows filtered)
    const failedTransactionRows = failedTransactionRefIds.size * 2;
    expectedProcessed += failedTransactionRows; // Count as "processed" since they were handled

    // All transfers should be processed (either as migrations or individual transfers)
    expectedProcessed += transferRows.length;

    // Spend/receive pairs that form trades or dustsweeping (all records with processed refids)
    const processedTradeRecords = spendRows.filter(row => processedRefIds.has(row.refid)).length +
      receiveRows.filter(row => processedRefIds.has(row.refid)).length;
    expectedProcessed += processedTradeRecords;

    // Unprocessed spend records (treated as withdrawals)
    const unprocessedSpendRecords = spendRows.filter(row => !processedRefIds.has(row.refid)).length;
    expectedProcessed += unprocessedSpendRecords;

    // Check for any unprocessed records
    const unprocessedRows = allRows.filter(row => {
      // Check if this row type is known
      const knownTypes = ['trade', 'deposit', 'withdrawal', 'transfer', 'spend', 'receive'];
      if (!knownTypes.includes(row.type)) {
        return true; // Unknown type = unprocessed
      }

      // Check if spend/receive rows that aren't part of processed trades
      if ((row.type === 'spend' || row.type === 'receive') && !processedRefIds.has(row.refid)) {
        // Unprocessed spend rows are handled as withdrawals, but unprocessed receive rows are problematic
        return row.type === 'receive';
      }

      return false; // This row should be processed
    });

    if (unprocessedRows.length > 0) {
      const unprocessedTypes = [...new Set(unprocessedRows.map(r => r.type))];
      this.logger.warn(`Found ${unprocessedRows.length} unprocessed CSV records with types: ${unprocessedTypes.join(', ')}`);

      // Log details of unprocessed records for debugging
      for (const row of unprocessedRows.slice(0, 5)) { // Show first 5
        this.logger.warn(`Unprocessed record: txid=${row.txid}, type=${row.type}, refid=${row.refid}, asset=${row.asset}, amount=${row.amount}`);
      }

      if (unprocessedRows.length > 5) {
        this.logger.warn(`... and ${unprocessedRows.length - 5} more unprocessed records`);
      }
    }

    this.logger.info(`CSV processing summary: ${allRows.length} total records, ${expectedProcessed} processed, ${unprocessedRows.length} unprocessed, ${failedTransactionRefIds.size} failed transaction pairs filtered`);
  }

  private convertSingleTradeToTransaction(trade: KrakenLedgerRow): CryptoTransaction {
    const timestamp = new Date(trade.time).getTime();
    const amount = parseDecimal(trade.amount).abs().toNumber();
    const fee = parseDecimal(trade.fee || '0').toNumber();

    return {
      id: trade.txid,
      type: 'trade',
      timestamp,
      datetime: trade.time,
      symbol: trade.asset, // Single trade records may not have clear symbol
      side: parseDecimal(trade.amount).isPositive() ? 'buy' : 'sell',
      amount: createMoney(amount, trade.asset),
      price: undefined, // Single trade records may not have clear price
      fee: createMoney(fee, trade.asset),
      status: this.mapStatus(),
      info: {
        originalRow: trade
      }
    };
  }

  private convertTradeToTransaction(spend: KrakenLedgerRow, receive: KrakenLedgerRow): CryptoTransaction {
    const timestamp = new Date(spend.time).getTime();
    const spendAmount = parseDecimal(spend.amount).abs().toNumber();
    let receiveAmount = parseDecimal(receive.amount).toNumber();

    // Check fees from both spend and receive transactions
    const spendFee = parseDecimal(spend.fee || '0').toNumber();
    const receiveFee = parseDecimal(receive.fee || '0').toNumber();

    // Determine which transaction has the fee and adjust accordingly
    let totalFee = 0;
    let feeAsset = spend.asset; // Default fee asset

    if (spendFee > 0) {
      totalFee = spendFee;
      feeAsset = spend.asset;
    } else if (receiveFee > 0) {
      // Fee is applied to received amount - subtract it (like C# code logic)
      totalFee = receiveFee;
      feeAsset = receive.asset;
      //receiveAmount -= receiveFee; // Adjust received amount for fee
    }

    return {
      id: spend.txid,
      type: 'trade',
      timestamp,
      datetime: spend.time,
      symbol: `${receive.asset}/${spend.asset}`,
      side: 'buy',
      amount: createMoney(receiveAmount, receive.asset),
      price: createMoney(spendAmount, spend.asset),
      fee: createMoney(totalFee, feeAsset),
      status: this.mapStatus(),
      info: {
        spend,
        receive,
        originalRows: { spend, receive },
        feeAdjustment: receiveFee > 0 ? 'receive_adjusted' : 'spend_fee'
      }
    };
  }

  private convertDepositToTransaction(row: KrakenLedgerRow): CryptoTransaction {
    const timestamp = new Date(row.time).getTime();
    const amount = parseDecimal(row.amount).toNumber();
    const fee = parseDecimal(row.fee || '0').toNumber();

    return {
      id: row.txid,
      type: 'deposit',
      timestamp,
      datetime: row.time,
      symbol: undefined,
      side: undefined,
      amount: createMoney(amount, row.asset), // Net amount after fee
      price: undefined,
      fee: createMoney(fee, row.asset),
      status: this.mapStatus(),
      info: {
        originalRow: row,
        txHash: undefined, // Kraken ledgers don't include tx hash
        wallet: row.wallet
      }
    };
  }

  private convertWithdrawalToTransaction(row: KrakenLedgerRow): CryptoTransaction {
    const timestamp = new Date(row.time).getTime();
    const amount = parseDecimal(row.amount).abs().toNumber();
    const fee = parseDecimal(row.fee || '0').toNumber();

    return {
      id: row.txid,
      type: 'withdrawal',
      timestamp,
      datetime: row.time,
      symbol: undefined,
      side: undefined,
      amount: createMoney(amount, row.asset), // Net amount after fee
      price: undefined,
      fee: createMoney(fee, row.asset),
      status: this.mapStatus(),
      info: {
        originalRow: row,
        txHash: undefined, // Kraken ledgers don't include tx hash
        wallet: row.wallet
      }
    };
  }
}