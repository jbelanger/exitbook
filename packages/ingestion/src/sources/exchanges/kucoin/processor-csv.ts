import { getErrorMessage } from '@exitbook/core';
import { type Result, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { ProcessedTransaction } from '../../../shared/types/processors.js';

import {
  convertKucoinDepositToTransaction,
  convertKucoinOrderSplittingToTransaction,
  convertKucoinSpotOrderToTransaction,
  convertKucoinTradingBotToTransaction,
  convertKucoinWithdrawalToTransaction,
  processKucoinAccountHistory,
} from './processor-utils.js';
import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvOrderSplittingRow,
  CsvSpotOrderRow,
  CsvTradingBotRow,
} from './types.js';

/**
 * Processor for KuCoin CSV data.
 * Handles processing logic for KuCoin transactions including:
 * - Spot order processing
 * - Deposit and withdrawal handling
 * - Convert market transaction processing from account history
 */
export class KucoinProcessor extends BaseTransactionProcessor {
  constructor() {
    super('kucoin');
  }

  protected async processInternal(rawDataItems: unknown[]): Promise<Result<ProcessedTransaction[], string>> {
    const allTransactions: ProcessedTransaction[] = [];
    const accountHistoryRows: CsvAccountHistoryRow[] = [];

    for (const rawDataItem of rawDataItems) {
      // For exchanges, rawDataItem is wrapped in a dataPackage with {raw, normalized, externalId, cursor}
      // Extract the normalized data which contains the _rowType field
      const dataPackage = rawDataItem as { normalized?: unknown };
      const row = (dataPackage.normalized || rawDataItem) as { _rowType?: string };

      try {
        switch (row._rowType) {
          case 'spot_order': {
            const transaction = convertKucoinSpotOrderToTransaction(row as CsvSpotOrderRow);
            allTransactions.push(transaction);
            break;
          }
          case 'order_splitting': {
            const transaction = convertKucoinOrderSplittingToTransaction(row as CsvOrderSplittingRow);
            allTransactions.push(transaction);
            break;
          }
          case 'deposit': {
            const transaction = convertKucoinDepositToTransaction(row as CsvDepositWithdrawalRow);
            allTransactions.push(transaction);
            break;
          }
          case 'withdrawal': {
            const transaction = convertKucoinWithdrawalToTransaction(row as CsvDepositWithdrawalRow);
            allTransactions.push(transaction);
            break;
          }
          case 'account_history': {
            // Collect account history rows for batch processing (convert market grouping)
            accountHistoryRows.push(row as CsvAccountHistoryRow);
            break;
          }
          case 'trading_bot': {
            const transaction = convertKucoinTradingBotToTransaction(row as CsvTradingBotRow);
            allTransactions.push(transaction);
            break;
          }
          default:
            this.logger.warn(`Unknown row type: ${row._rowType}`);
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.warn(`Failed to process KuCoin row: ${errorMessage}`);
        continue;
      }
    }

    // Process account history rows (handles convert market grouping)
    if (accountHistoryRows.length > 0) {
      const convertTransactions = processKucoinAccountHistory(accountHistoryRows, this.logger);
      allTransactions.push(...convertTransactions);
    }

    return okAsync(allTransactions);
  }
}
