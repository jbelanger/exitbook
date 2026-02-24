import { type Result, errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';

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

  // KuCoin CSV rows are a heterogeneous union dispatched at runtime via _rowType.
  // No single Zod schema covers all variants; input is validated per-row in transformNormalizedData.
  protected get inputSchema() {
    return z.unknown();
  }

  protected async transformNormalizedData(rawDataItems: unknown[]): Promise<Result<ProcessedTransaction[], string>> {
    const allTransactions: ProcessedTransaction[] = [];
    const accountHistoryRows: CsvAccountHistoryRow[] = [];
    const failures: { error: string; rowType: string }[] = [];
    let unknownRowCount = 0;

    for (const rawDataItem of rawDataItems) {
      const row = (rawDataItem as { raw: unknown }).raw as { _rowType?: string };

      switch (row._rowType) {
        case 'spot_order': {
          const result = convertKucoinSpotOrderToTransaction(row as CsvSpotOrderRow);
          if (result.isErr()) {
            this.logger.warn({ error: result.error }, `Failed to process KuCoin spot order: ${result.error.message}`);
            failures.push({ rowType: 'spot_order', error: result.error.message });
            continue;
          }
          allTransactions.push(result.value);
          break;
        }
        case 'order_splitting': {
          const result = convertKucoinOrderSplittingToTransaction(row as CsvOrderSplittingRow);
          if (result.isErr()) {
            this.logger.warn(
              { error: result.error },
              `Failed to process KuCoin order splitting: ${result.error.message}`
            );
            failures.push({ rowType: 'order_splitting', error: result.error.message });
            continue;
          }
          allTransactions.push(result.value);
          break;
        }
        case 'deposit': {
          const result = convertKucoinDepositToTransaction(row as CsvDepositWithdrawalRow);
          if (result.isErr()) {
            this.logger.warn({ error: result.error }, `Failed to process KuCoin deposit: ${result.error.message}`);
            failures.push({ rowType: 'deposit', error: result.error.message });
            continue;
          }
          allTransactions.push(result.value);
          break;
        }
        case 'withdrawal': {
          const result = convertKucoinWithdrawalToTransaction(row as CsvDepositWithdrawalRow);
          if (result.isErr()) {
            this.logger.warn({ error: result.error }, `Failed to process KuCoin withdrawal: ${result.error.message}`);
            failures.push({ rowType: 'withdrawal', error: result.error.message });
            continue;
          }
          allTransactions.push(result.value);
          break;
        }
        case 'account_history': {
          // Collect account history rows for batch processing (convert market grouping)
          accountHistoryRows.push(row as CsvAccountHistoryRow);
          break;
        }
        case 'trading_bot': {
          const result = convertKucoinTradingBotToTransaction(row as CsvTradingBotRow);
          if (result.isErr()) {
            this.logger.warn({ error: result.error }, `Failed to process KuCoin trading bot: ${result.error.message}`);
            failures.push({ rowType: 'trading_bot', error: result.error.message });
            continue;
          }
          allTransactions.push(result.value);
          break;
        }
        default:
          this.logger.warn(`Unknown row type: ${row._rowType}`);
          unknownRowCount++;
      }
    }

    // Process account history rows (handles convert market grouping)
    if (accountHistoryRows.length > 0) {
      const result = processKucoinAccountHistory(accountHistoryRows, this.logger);
      if (result.isErr()) {
        this.logger.warn({ error: result.error }, `Failed to process KuCoin account history: ${result.error.message}`);
        failures.push({ rowType: 'account_history', error: result.error.message });
      } else {
        allTransactions.push(...result.value);
      }
    }

    // Log summary of processing results
    const totalRows = rawDataItems.length;
    const transactionCount = allTransactions.length;
    const failureCount = failures.length;
    const accountHistoryRowCount = accountHistoryRows.length;

    // Build summary message
    const parts: string[] = [];
    parts.push(`KuCoin CSV processing completed: ${totalRows} row(s) → ${transactionCount} transaction(s)`);

    if (accountHistoryRowCount > 0) {
      parts.push(`${accountHistoryRowCount} account history row(s) grouped and processed`);
    }

    if (failureCount > 0) {
      parts.push(`${failureCount} conversion failure(s)`);
    }

    if (unknownRowCount > 0) {
      parts.push(`${unknownRowCount} unknown row type(s) skipped`);
    }

    const summaryMessage = parts.join(', ');

    if (failureCount > 0 || unknownRowCount > 0) {
      this.logger.error(
        { failures, transactionCount, failureCount, totalRows, accountHistoryRowCount, unknownRowCount },
        summaryMessage
      );

      // Fail fast on conversion errors - never silently ignore failures
      const errorDetails = failures.map((f) => `${f.rowType}: ${f.error}`).join('; ');
      return errAsync(
        `KuCoin CSV processing failed: ${failureCount} conversion error(s), ${unknownRowCount} unknown row type(s). Details: ${errorDetails}`
      );
    } else {
      this.logger.info(summaryMessage);
    }

    return okAsync(allTransactions);
  }
}
