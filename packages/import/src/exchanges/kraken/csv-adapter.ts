import type {
  Balance,
  TransactionStatus,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalExchangeAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from '@crypto/core';
import type { Database } from '@crypto/data';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import fs from 'fs/promises';
import path from 'path';

import { BaseAdapter } from '../../shared/adapters/base-adapter.ts';
import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { TransactionIngestionService } from '../../shared/ingestion/ingestion-service.ts';
import { ExternalDataStore } from '../../shared/storage/external-data-store.ts';
import { CsvFilters } from '../csv-filters.ts';
import { CsvParser } from '../csv-parser.ts';
import type { CsvKrakenLedgerRow } from './types.ts';

// Expected CSV headers for validation
const EXPECTED_HEADERS = {
  LEDGERS_CSV: '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"',
};

export class KrakenCSVAdapter extends BaseAdapter {
  private cachedTransactions: CsvKrakenLedgerRow[] | null = null;
  private ingestionService: TransactionIngestionService | null = null;

  constructor(config: UniversalExchangeAdapterConfig, database?: Database) {
    super(config);

    // Create ingestion service if database is provided (for new ETL workflow)
    if (database) {
      const dependencies: IDependencyContainer = {
        database,
        externalDataStore: new ExternalDataStore(database),
        logger: this.logger,
      };
      this.ingestionService = new TransactionIngestionService(dependencies);
    }
  }

  private convertDepositToTransaction(row: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(row.time).getTime();
    const amount = parseDecimal(row.amount).toNumber();
    const fee = parseDecimal(row.fee || '0').toNumber();

    return {
      amount: createMoney(amount, row.asset), // Net amount after fee
      datetime: row.time,
      fee: createMoney(fee, row.asset),
      id: row.txid,
      metadata: {
        originalRow: row,
        txHash: undefined, // Kraken ledgers don't include tx hash
        wallet: row.wallet,
      },
      network: 'exchange',
      source: 'kraken',
      status: this.mapStatus(),
      timestamp,
      type: 'deposit' as const,
    };
  }

  private convertSingleTradeToTransaction(trade: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(trade.time).getTime();
    const amount = parseDecimal(trade.amount).abs().toNumber();
    const fee = parseDecimal(trade.fee || '0').toNumber();

    return {
      amount: createMoney(amount, trade.asset),
      datetime: trade.time,
      fee: createMoney(fee, trade.asset),
      id: trade.txid,
      metadata: {
        originalRow: trade,
        side: parseDecimal(trade.amount).isPositive() ? 'buy' : 'sell',
      },
      network: 'exchange',
      source: 'kraken',
      status: this.mapStatus(),
      symbol: trade.asset, // Single trade records may not have clear symbol
      timestamp,
      type: 'trade' as const,
    };
  }

  private convertTokenMigrationToTransaction(
    negative: CsvKrakenLedgerRow,
    positive: CsvKrakenLedgerRow
  ): UniversalTransaction {
    const timestamp = new Date(negative.time).getTime();
    const sentAmount = parseDecimal(negative.amount).abs().toNumber();
    const receivedAmount = parseDecimal(positive.amount).toNumber();

    return {
      amount: createMoney(receivedAmount, positive.asset),
      datetime: negative.time,
      fee: createMoney(0, positive.asset), // Token migrations typically have no fees
      id: `${negative.txid}_${positive.txid}`,
      metadata: {
        fromAsset: negative.asset,
        fromTransaction: negative,
        originalRows: { negative, positive },
        side: 'buy',
        toAsset: positive.asset,
        tokenMigration: true,
        toTransaction: positive,
      },
      network: 'exchange',
      price: createMoney(sentAmount, negative.asset),
      source: 'kraken',
      status: this.mapStatus(),
      symbol: `${positive.asset}/${negative.asset}`,
      timestamp,
      type: 'trade' as const,
    };
  }

  private convertTradeToTransaction(spend: CsvKrakenLedgerRow, receive: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(spend.time).getTime();
    const spendAmount = parseDecimal(spend.amount).abs().toNumber();
    const receiveAmount = parseDecimal(receive.amount).toNumber();

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
      amount: createMoney(receiveAmount, receive.asset),
      datetime: spend.time,
      fee: createMoney(totalFee, feeAsset),
      id: spend.txid,
      metadata: {
        feeAdjustment: receiveFee > 0 ? 'receive_adjusted' : 'spend_fee',
        originalRows: { receive, spend },
        receive,
        side: 'buy',
        spend,
      },
      network: 'exchange',
      price: createMoney(spendAmount, spend.asset),
      source: 'kraken',
      status: this.mapStatus(),
      symbol: `${receive.asset}/${spend.asset}`,
      timestamp,
      type: 'trade' as const,
    };
  }

  private convertTransferToTransaction(transfer: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(transfer.time).getTime();
    const isIncoming = parseDecimal(transfer.amount).isPositive();

    return {
      amount: createMoney(parseDecimal(transfer.amount).abs().toNumber(), transfer.asset),
      datetime: transfer.time,
      fee: createMoney(parseDecimal(transfer.fee || '0').toNumber(), transfer.asset),
      id: transfer.txid,
      metadata: {
        isTransfer: true,
        originalRow: transfer,
        transferType: transfer.subtype,
        wallet: transfer.wallet,
      },
      network: 'exchange',
      source: 'kraken',
      status: this.mapStatus(),
      timestamp,
      type: isIncoming ? ('deposit' as const) : ('withdrawal' as const),
    };
  }

  private convertWithdrawalToTransaction(row: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(row.time).getTime();
    const amount = parseDecimal(row.amount).abs().toNumber();
    const fee = parseDecimal(row.fee || '0').toNumber();

    return {
      amount: createMoney(amount, row.asset), // Net amount after fee
      datetime: row.time,
      fee: createMoney(fee, row.asset),
      id: row.txid,
      metadata: {
        originalRow: row,
        txHash: undefined, // Kraken ledgers don't include tx hash
        wallet: row.wallet,
      },
      network: 'exchange',
      source: 'kraken',
      status: this.mapStatus(),
      timestamp,
      type: 'withdrawal' as const,
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
  private filterFailedTransactions(withdrawalRows: CsvKrakenLedgerRow[]): {
    failedTransactionRefIds: Set<string>;
    validWithdrawals: CsvKrakenLedgerRow[];
  } {
    const failedTransactionRefIds = new Set<string>();
    const validWithdrawals: CsvKrakenLedgerRow[] = [];

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
          this.logger.info(
            `Failed transaction detected and filtered: refid=${refId}, ` +
              `attempted=${negative.amount} ${negative.asset}, ` +
              `credited=${positive.amount} ${positive.asset}`
          );
          continue;
        }
      }

      // Not a failed transaction pair - add all entries to valid withdrawals
      validWithdrawals.push(...group);
    }

    this.logger.info(
      `Withdrawal filtering: ${withdrawalRows.length} total, ` +
        `${validWithdrawals.length} valid, ` +
        `${failedTransactionRefIds.size} failed transaction pairs filtered`
    );

    return { failedTransactionRefIds, validWithdrawals };
  }

  private groupTransfersByDateAndAmount(transferRows: CsvKrakenLedgerRow[]): CsvKrakenLedgerRow[][] {
    const groups: CsvKrakenLedgerRow[][] = [];
    const processed = new Set<string>();

    for (const transfer of transferRows) {
      if (processed.has(transfer.txid)) continue;

      const amount = parseDecimal(transfer.amount).abs().toNumber();
      const transferDate = new Date(transfer.time).toDateString();

      // Find potential matching transfer (opposite sign, same amount, same date)
      const match = transferRows.find(
        t =>
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
  private isFailedTransactionPair(negative: CsvKrakenLedgerRow, positive: CsvKrakenLedgerRow): boolean {
    // Must be same asset
    if (negative.asset !== positive.asset) {
      return false;
    }

    // Amounts should be approximately equal but opposite
    const negativeAmount = parseDecimal(negative.amount).abs();
    const positiveAmount = parseDecimal(positive.amount);
    const amountDiff = negativeAmount.minus(positiveAmount).abs();
    const relativeDiff = amountDiff.div(negativeAmount);

    if (relativeDiff.gt(0.001)) {
      // More than 0.1% difference
      return false;
    }

    // Check fees - they should be opposite (negative fee = refund)
    const negativeFee = parseDecimal(negative.fee || '0');
    const positiveFee = parseDecimal(positive.fee || '0');

    // For failed transactions, the fee pattern should be: positive fee, then negative fee (refund)
    const feesAreOpposite = negativeFee.gt(0) && positiveFee.lt(0) && negativeFee.plus(positiveFee).abs().lt(0.001);

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

  /**
   * Load all transactions from CSV directories
   */
  private async loadAllTransactions(): Promise<CsvKrakenLedgerRow[]> {
    if (this.cachedTransactions) {
      this.logger.debug('Returning cached transactions');
      return this.cachedTransactions;
    }

    const config = this.config as UniversalExchangeAdapterConfig;
    this.logger.info(`Starting to load CSV transactions - CsvDirectories: ${config.csvDirectories}`);

    const transactions: CsvKrakenLedgerRow[] = [];

    try {
      // Process each directory in order
      for (const csvDirectory of config.csvDirectories || []) {
        this.logger.info(`Processing CSV directory - CsvDirectory: ${csvDirectory}`);

        try {
          const files = await fs.readdir(csvDirectory);
          this.logger.debug(`Found CSV files in directory - CsvDirectory: ${csvDirectory}, Files: ${files}`);

          // Process all CSV files with proper header validation
          const csvFiles = files.filter(f => f.endsWith('.csv'));

          for (const file of csvFiles) {
            const filePath = path.join(csvDirectory, file);
            const fileType = await this.validateCSVHeaders(filePath);

            if (fileType === 'ledgers') {
              this.logger.info(`Processing ${fileType} CSV file - File: ${file}, Directory: ${csvDirectory}`);
              const fileTransactions = await this.parseCsvFile<CsvKrakenLedgerRow>(filePath);
              this.logger.info(
                `Parsed ${fileType} transactions - File: ${file}, Directory: ${csvDirectory}, Count: ${fileTransactions.length}`
              );
              transactions.push(...fileTransactions);
            } else if (fileType === 'unknown') {
              this.logger.warn(`Skipping unrecognized CSV file - File: ${file}, Directory: ${csvDirectory}`);
            } else {
              this.logger.warn(`No handler for file type: ${fileType} - File: ${file}, Directory: ${csvDirectory}`);
            }
          }
        } catch (dirError) {
          this.logger.error(`Failed to process CSV directory - Error: ${dirError}, Directory: ${csvDirectory}`);
          // Continue processing other directories
          continue;
        }
      }

      // Sort by timestamp
      transactions.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      this.cachedTransactions = transactions;
      this.logger.info(
        `Loaded ${transactions.length} transactions from ${config.csvDirectories?.length || 0} CSV directories`
      );

      return transactions;
    } catch (error) {
      this.logger.error(`Failed to load CSV transactions - Error: ${error}`);
      throw error;
    }
  }

  private mapStatus(): TransactionStatus {
    // Kraken ledger entries don't have explicit status, assume completed
    return 'closed';
  }

  /**
   * Parse a CSV file using the common parsing logic
   */
  private async parseCsvFile<T>(filePath: string): Promise<T[]> {
    return CsvParser.parseFile<T>(filePath);
  }

  private parseLedgers(rows: CsvKrakenLedgerRow[]): UniversalTransaction[] {
    const transactions: UniversalTransaction[] = [];

    // Separate transactions by type
    const tradeRows = rows.filter(row => row.type === 'trade');
    const depositRows = rows.filter(row => row.type === 'deposit');
    const transferRows = rows.filter(row => row.type === 'transfer');
    const spendRows = rows.filter(row => row.type === 'spend');
    const receiveRows = rows.filter(row => row.type === 'receive');

    // Filter out failed transactions and get valid withdrawals
    const { failedTransactionRefIds, validWithdrawals } = this.filterFailedTransactions(
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
        const receive = group.find(
          row => parseDecimal(row.amount).gt(0) && (row.type === 'receive' || row.type === 'trade')
        );
        const spends = group.filter(
          row => parseDecimal(row.amount).lt(0) && (row.type === 'spend' || row.type === 'trade')
        );

        if (receive && spends.length > 0) {
          const receiveAmount = parseDecimal(receive.amount).abs().toNumber();

          // Kraken dustsweeping: small amounts (< 1) get converted, creating multiple spends for one receive
          if (receiveAmount < 1) {
            this.logger.warn(
              `Dustsweeping detected for refid ${refId}: ${receiveAmount} ${receive.asset} with ${spends.length} spend transactions`
            );

            // Create deposit transaction for the received amount
            const depositTransaction = this.convertDepositToTransaction(receive);
            depositTransaction.metadata = {
              ...depositTransaction.metadata,
              dustsweeping: true,
              relatedRefId: refId,
            };
            transactions.push(depositTransaction);

            // Create withdrawal transactions for each spend
            for (const spend of spends) {
              const withdrawalTransaction = this.convertWithdrawalToTransaction(spend);
              withdrawalTransaction.metadata = {
                ...withdrawalTransaction.metadata,
                dustsweeping: true,
                relatedRefId: refId,
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
      depositRows,
      failedTransactionRefIds,
      processedRefIds,
      receiveRows,
      spendRows,
      tradeRows,
      transferRows,
      validWithdrawals,
    });

    return transactions;
  }

  /**
   * Process the loaded ledger rows into universal transactions
   */
  private processLedgerRows(rows: CsvKrakenLedgerRow[]): UniversalTransaction[] {
    return this.parseLedgers(rows);
  }

  private processTokenMigrations(transferRows: CsvKrakenLedgerRow[]): {
    processedRefIds: string[];
    transactions: UniversalTransaction[];
  } {
    const transactions: UniversalTransaction[] = [];
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

          if (relativeDiff < 0.001) {
            // Less than 0.1% difference
            this.logger.info(
              `Token migration detected: ${negativeAmount} ${negative.asset} -> ${positiveAmount} ${positive.asset}`
            );

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

    return { processedRefIds, transactions };
  }

  /**
   * Query processed transactions from the database for backward compatibility
   * with the existing adapter interface.
   */
  private async queryProcessedTransactions(params: UniversalFetchParams): Promise<UniversalTransaction[]> {
    if (!this.ingestionService) {
      return [];
    }

    // For now, return empty array since we don't have a transaction service yet
    // TODO: Implement proper transaction querying when TransactionService is available
    this.logger.warn('Transaction querying not yet implemented for ETL workflow');
    return [];
  }

  private validateAllRecordsProcessed(
    allRows: CsvKrakenLedgerRow[],
    processed: {
      depositRows: CsvKrakenLedgerRow[];
      failedTransactionRefIds: Set<string>;
      processedRefIds: Set<string>;
      receiveRows: CsvKrakenLedgerRow[];
      spendRows: CsvKrakenLedgerRow[];
      tradeRows: CsvKrakenLedgerRow[];
      transferRows: CsvKrakenLedgerRow[];
      validWithdrawals: CsvKrakenLedgerRow[];
    }
  ): void {
    const {
      depositRows,
      failedTransactionRefIds,
      processedRefIds,
      receiveRows,
      spendRows,
      tradeRows,
      transferRows,
      validWithdrawals,
    } = processed;

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
    const processedTradeRecords =
      spendRows.filter(row => processedRefIds.has(row.refid)).length +
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
      this.logger.warn(
        `Found ${unprocessedRows.length} unprocessed CSV records with types: ${unprocessedTypes.join(', ')}`
      );

      // Log details of unprocessed records for debugging
      for (const row of unprocessedRows.slice(0, 5)) {
        // Show first 5
        this.logger.warn(
          `Unprocessed record: txid=${row.txid}, type=${row.type}, refid=${row.refid}, asset=${row.asset}, amount=${row.amount}`
        );
      }

      if (unprocessedRows.length > 5) {
        this.logger.warn(`... and ${unprocessedRows.length - 5} more unprocessed records`);
      }
    }

    this.logger.info(
      `CSV processing summary: ${allRows.length} total records, ${expectedProcessed} processed, ${unprocessedRows.length} unprocessed, ${failedTransactionRefIds.size} failed transaction pairs filtered`
    );
  }

  /**
   * Validate CSV headers and determine file type
   */
  private async validateCSVHeaders(filePath: string): Promise<string> {
    const expectedHeaders = {
      [EXPECTED_HEADERS.LEDGERS_CSV]: 'ledgers',
    };
    const fileType = await CsvParser.validateHeaders(filePath, expectedHeaders);

    if (fileType === 'unknown') {
      const headers = await CsvParser.getHeaders(filePath);
      this.logger.warn(`Unrecognized CSV headers in ${filePath} - Headers: ${headers}`);
    }

    return fileType;
  }

  async close(): Promise<void> {
    this.cachedTransactions = null;
  }

  protected async fetchRawBalances(): Promise<Balance> {
    throw new Error('Balance fetching not supported for CSV adapter - CSV files do not contain current balance data');
  }

  protected async fetchRawTransactions(): Promise<CsvKrakenLedgerRow[]> {
    return this.loadAllTransactions();
  }

  /**
   * Override fetchTransactions to use ingestion service when available.
   * Falls back to legacy behavior for backward compatibility.
   */
  async fetchTransactions(params: UniversalFetchParams): Promise<UniversalTransaction[]> {
    if (this.ingestionService) {
      // New ETL workflow using ingestion service
      this.logger.info('Using new ETL workflow with ingestion service');

      const csvDirectories = (this.config as UniversalExchangeAdapterConfig).csvDirectories;
      if (!csvDirectories?.length) {
        throw new Error('CSV directories are required for Kraken adapter');
      }

      const importParams = {
        csvDirectories,
        since: params.since,
        until: params.until,
      };

      const result = await this.ingestionService.importAndProcess('kraken', 'exchange', importParams);

      this.logger.info(`ETL workflow completed: ${result.imported} imported, ${result.processed} processed`);

      // Query and return the processed transactions for backward compatibility
      const processedTransactions = await this.queryProcessedTransactions(params);
      return processedTransactions;
    } else {
      // Legacy workflow using existing BaseAdapter implementation
      this.logger.info('Using legacy workflow');
      return super.fetchTransactions(params);
    }
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      capabilities: {
        maxBatchSize: 1000,
        requiresApiKey: false,
        supportedOperations: ['fetchTransactions'],
        supportsHistoricalData: true,
        supportsPagination: false,
      },
      id: 'kraken',
      name: 'Kraken CSV',
      subType: 'csv',
      type: 'exchange',
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const config = this.config as UniversalExchangeAdapterConfig;
      for (const csvDirectory of config.csvDirectories || []) {
        try {
          const stats = await fs.stat(csvDirectory);
          if (!stats.isDirectory()) {
            continue;
          }

          const files = await fs.readdir(csvDirectory);
          const csvFiles = files.filter(f => f.endsWith('.csv'));

          if (csvFiles.length > 0) {
            return true;
          }
        } catch (dirError) {
          this.logger.warn(`CSV directory test failed for directory - Error: ${dirError}, Directory: ${csvDirectory}`);
          continue;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(`CSV directories test failed - Error: ${error}`);
      return false;
    }
  }

  protected async transformBalances(): Promise<UniversalBalance[]> {
    throw new Error('Balance fetching not supported for CSV adapter');
  }

  protected async transformTransactions(
    rawTxs: CsvKrakenLedgerRow[],
    params: UniversalFetchParams
  ): Promise<UniversalTransaction[]> {
    const transactions = this.processLedgerRows(rawTxs);

    return transactions
      .filter(tx => !params.since || tx.timestamp >= params.since)
      .filter(tx => !params.until || tx.timestamp <= params.until);
  }
}
