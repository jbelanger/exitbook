import type { UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { ApiClientRawData } from '../../../app/ports/importers.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import { CsvFilters } from '../csv-filters.js';

import type { CsvKrakenLedgerRow } from './types.js';

/**
 * Processor for Kraken CSV ledger data.
 * Handles the complex processing logic for Kraken transactions including:
 * - Trade pairing (spend/receive pairs)
 * - Failed transaction detection and filtering
 * - Token migration detection
 * - Dustsweeping handling
 */
export class KrakenProcessor extends BaseProcessor {
  constructor() {
    super('kraken');
  }

  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'exchange';
  }

  protected processNormalizedInternal(rawDataItems: StoredRawData[]): Promise<Result<UniversalTransaction[], string>> {
    try {
      // Extract the raw ledger rows for batch processing
      // Handle ApiClientRawData format: { providerId: string, rawData: CsvKrakenLedgerRow }
      const rows = rawDataItems.map((item) => item.rawData as CsvKrakenLedgerRow);
      const transactions = this.parseLedgers(rows);
      return Promise.resolve(ok(transactions));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return Promise.resolve(err(`Failed to process Kraken data: ${errorMessage}`));
    }
  }

  private convertDepositToTransaction(row: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(row.time).getTime();
    const grossAmount = row.amount;
    const fee = row.fee || '0';

    // For Kraken deposits: amount is gross, user actually receives amount - fee
    const netAmount = String(parseDecimal(grossAmount).minus(fee));

    return {
      amount: createMoney(netAmount, row.asset),
      datetime: row.time,
      fee: createMoney(fee, row.asset),
      id: row.txid,
      metadata: {
        originalRow: row,
        txHash: undefined,
        wallet: row.wallet,
      },
      network: 'exchange',
      source: 'kraken',
      status: this.mapStatus(),
      symbol: row.asset,
      timestamp,
      type: 'deposit' as const,
    };
  }

  private convertSingleTradeToTransaction(trade: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(trade.time).getTime();
    const amount = trade.amount;
    const fee = trade.fee || '0';

    return {
      amount: createMoney(amount, trade.asset),
      datetime: trade.time,
      fee: createMoney(fee, trade.asset),
      id: trade.txid,
      metadata: {
        originalRow: trade,
      },
      network: 'exchange',
      source: 'kraken',
      status: this.mapStatus(),
      symbol: trade.asset,
      timestamp,
      type: 'trade' as const,
    };
  }

  private convertTokenMigrationToTransaction(
    negative: CsvKrakenLedgerRow,
    positive: CsvKrakenLedgerRow
  ): UniversalTransaction {
    const timestamp = new Date(negative.time).getTime();
    const sentAmount = negative.amount;
    const receivedAmount = positive.amount;

    return {
      amount: createMoney(receivedAmount, positive.asset),
      datetime: negative.time,
      fee: createMoney('0', positive.asset),
      id: `${negative.txid}_${positive.txid}`,
      metadata: {
        fromAsset: negative.asset,
        fromTransaction: negative,
        originalRows: { negative, positive },
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
    const spendAmount = spend.amount;
    const receiveAmount = receive.amount;

    // Check fees from both spend and receive transactions
    const spendFee = spend.fee || '0';
    const receiveFee = receive.fee || '0';

    // Determine fee source and amount
    let totalFee = '0';
    let feeAsset = spend.asset;

    if (!parseDecimal(spendFee).isZero()) {
      totalFee = spendFee;
      feeAsset = spend.asset;
    } else if (!parseDecimal(receiveFee).isZero()) {
      totalFee = receiveFee;
      feeAsset = receive.asset;
    }

    // For Kraken: fee is always additional to the shown amounts
    // Receive amount is always the net amount (no adjustment needed)
    //const finalReceiveAmount = receiveAmount;
    const isReceiveFee = receive.asset === feeAsset && !parseDecimal(receiveFee).isZero();
    const finalReceiveAmount = isReceiveFee ? String(parseDecimal(receiveAmount).minus(totalFee)) : receiveAmount;

    return {
      amount: createMoney(finalReceiveAmount, receive.asset),
      datetime: spend.time,
      fee: createMoney(totalFee, feeAsset),
      id: spend.txid,
      metadata: {
        originalRows: { receive, spend },
        receive,
        spend,
      },
      network: 'exchange',
      price: createMoney(spendAmount, spend.asset),
      source: 'kraken',
      status: this.mapStatus(),
      symbol: receive.asset,
      timestamp,
      type: 'trade' as const,
    };
  }

  private convertTransferToTransaction(transfer: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(transfer.time).getTime();
    const isIncoming = parseDecimal(transfer.amount).isPositive();

    return {
      amount: createMoney(transfer.amount, transfer.asset),
      datetime: transfer.time,
      fee: createMoney(transfer.fee || '0', transfer.asset),
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
      symbol: transfer.asset,
      timestamp,
      type: isIncoming ? ('deposit' as const) : ('withdrawal' as const),
    };
  }

  private convertWithdrawalToTransaction(row: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(row.time).getTime();

    return {
      amount: createMoney(row.amount, row.asset),
      datetime: row.time,
      fee: createMoney(row.fee, row.asset),
      id: row.txid,
      metadata: {
        originalRow: row,
        txHash: undefined,
        wallet: row.wallet,
      },
      network: 'exchange',
      source: 'kraken',
      status: this.mapStatus(),
      symbol: row.asset,
      timestamp,
      type: 'withdrawal' as const,
    };
  }

  private filterFailedTransactions(withdrawalRows: CsvKrakenLedgerRow[]): {
    failedTransactionRefIds: Set<string>;
    validWithdrawals: CsvKrakenLedgerRow[];
  } {
    const failedTransactionRefIds = new Set<string>();
    const validWithdrawals: CsvKrakenLedgerRow[] = [];

    const withdrawalsByRefId = CsvFilters.groupByField(withdrawalRows, 'refid');

    for (const [refId, group] of withdrawalsByRefId) {
      if (group.length === 2) {
        const negative = group.find((w) => parseDecimal(w.amount).lt(0));
        const positive = group.find((w) => parseDecimal(w.amount).gt(0));

        if (negative && positive && this.isFailedTransactionPair(negative, positive)) {
          failedTransactionRefIds.add(refId);
          this.logger.info(
            `Failed transaction detected and filtered: refid=${refId}, ` +
              `attempted=${negative.amount} ${negative.asset}, ` +
              `credited=${positive.amount} ${positive.asset}`
          );
          continue;
        }
      }

      validWithdrawals.push(...group);
    }

    return { failedTransactionRefIds, validWithdrawals };
  }

  private groupTransfersByDateAndAmount(transferRows: CsvKrakenLedgerRow[]): CsvKrakenLedgerRow[][] {
    const groups: CsvKrakenLedgerRow[][] = [];
    const processed = new Set<string>();

    for (const transfer of transferRows) {
      if (processed.has(transfer.txid)) continue;

      const amount = parseDecimal(transfer.amount);
      const transferDate = new Date(transfer.time).toDateString();

      const match = transferRows.find(
        (t) =>
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

  private isFailedTransactionPair(negative: CsvKrakenLedgerRow, positive: CsvKrakenLedgerRow): boolean {
    if (negative.asset !== positive.asset) {
      return false;
    }

    const negativeAmount = parseDecimal(negative.amount).abs();
    const positiveAmount = parseDecimal(positive.amount);
    const amountDiff = negativeAmount.minus(positiveAmount).abs();
    const relativeDiff = amountDiff.div(negativeAmount);

    if (relativeDiff.gt(0.001)) {
      return false;
    }

    const negativeFee = parseDecimal(negative.fee || '0');
    const positiveFee = parseDecimal(positive.fee || '0');
    const feesAreOpposite = negativeFee.gt(0) && positiveFee.lt(0) && negativeFee.plus(positiveFee).abs().lt(0.001);

    if (!feesAreOpposite) {
      return false;
    }

    const negativeTime = new Date(negative.time).getTime();
    const positiveTime = new Date(positive.time).getTime();
    const timeDiff = Math.abs(positiveTime - negativeTime);
    const maxTimeDiff = 24 * 60 * 60 * 1000;

    return timeDiff <= maxTimeDiff;
  }

  private mapStatus(): 'closed' {
    return 'closed';
  }

  /**
   * Main processing logic adapted from KrakenCSVAdapter.
   * Handles complex pairing and filtering logic specific to Kraken ledger data.
   */
  private parseLedgers(rows: CsvKrakenLedgerRow[]): UniversalTransaction[] {
    const transactions: UniversalTransaction[] = [];

    // Separate transactions by type
    const tradeRows = rows.filter((row) => row.type === 'trade');
    const depositRows = rows.filter((row) => row.type === 'deposit');
    const transferRows = rows.filter((row) => row.type === 'transfer');
    const spendRows = rows.filter((row) => row.type === 'spend');
    const receiveRows = rows.filter((row) => row.type === 'receive');

    // Filter out failed transactions and get valid withdrawals
    const { validWithdrawals } = this.filterFailedTransactions(rows.filter((row) => row.type === 'withdrawal'));

    // Process spend/receive/trade pairs by grouping by refid
    const spendReceiveRows = [...spendRows, ...receiveRows, ...tradeRows];
    const tradeGroups = CsvFilters.groupByField(spendReceiveRows, 'refid');
    const processedRefIds = new Set<string>();

    for (const [refId, group] of tradeGroups) {
      if (group.length === 2) {
        const spend = group.find((row) => parseDecimal(row.amount).lt(0) || row.type === 'spend');
        const receive = group.find((row) => parseDecimal(row.amount).gt(0) || row.type === 'receive');

        if (spend && receive) {
          const transaction = this.convertTradeToTransaction(spend, receive);
          transactions.push(transaction);
          processedRefIds.add(refId);
        }
      } else if (group.length > 2) {
        // Handle dustsweeping - multiple spends for one receive (small amounts)
        const receive = group.find(
          (row) => parseDecimal(row.amount).gt(0) && (row.type === 'receive' || row.type === 'trade')
        );
        const spends = group.filter(
          (row) => parseDecimal(row.amount).lt(0) && (row.type === 'spend' || row.type === 'trade')
        );

        if (receive && spends.length > 0) {
          const receiveAmountAbs = parseDecimal(receive.amount);

          // Kraken dustsweeping: small amounts (< 1) get converted, creating multiple spends for one receive
          if (receiveAmountAbs.lt(1)) {
            this.logger.warn(
              `Dustsweeping detected for refid ${refId}: ${receiveAmountAbs.toString()} ${receive.asset} with ${spends.length} spend transactions`
            );

            // Create deposit transaction for the received amount (net after fee deduction)
            const receiveAmount = receive.amount;
            const receiveFee = receive.fee || '0';
            const netReceiveAmount = String(parseDecimal(receiveAmount).minus(receiveFee));

            const depositTransaction: UniversalTransaction = {
              amount: createMoney(netReceiveAmount, receive.asset),
              datetime: receive.time,
              fee: createMoney(receiveFee, receive.asset),
              id: receive.txid,
              metadata: {
                dustsweeping: true,
                originalRow: receive,
                relatedRefId: refId,
                txHash: undefined,
                wallet: receive.wallet,
              },
              network: 'exchange',
              source: 'kraken',
              status: this.mapStatus(),
              symbol: receive.asset,
              timestamp: new Date(receive.time).getTime(),
              type: 'deposit' as const,
            };
            transactions.push(depositTransaction);

            // Create withdrawal transactions for each spend
            for (const spend of spends) {
              const spendAmount = parseDecimal(spend.amount);
              const spendFee = parseDecimal(spend.fee || '0');

              const withdrawalTransaction: UniversalTransaction = {
                amount: createMoney(spendAmount, spend.asset),
                datetime: spend.time,
                fee: createMoney(spendFee, spend.asset),
                id: spend.txid,
                metadata: {
                  dustsweeping: true,
                  originalRow: spend,
                  relatedRefId: refId,
                  txHash: undefined,
                  wallet: spend.wallet,
                },
                network: 'exchange',
                source: 'kraken',
                status: this.mapStatus(),
                symbol: spend.asset,
                timestamp: new Date(spend.time).getTime(),
                type: 'withdrawal' as const,
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

    // Process any remaining unpaired trade rows (genuine single trades)
    for (const trade of tradeRows) {
      if (!processedRefIds.has(trade.refid)) {
        const transaction = this.convertSingleTradeToTransaction(trade);
        transactions.push(transaction);
      }
    }

    return transactions;
  }

  private processTokenMigrations(transferRows: CsvKrakenLedgerRow[]): {
    processedRefIds: string[];
    transactions: UniversalTransaction[];
  } {
    const transactions: UniversalTransaction[] = [];
    const processedRefIds: string[] = [];

    const transfersByDate = this.groupTransfersByDateAndAmount(transferRows);

    for (const group of transfersByDate) {
      if (group.length === 2) {
        const negative = group.find((t) => parseDecimal(t.amount).lt(0));
        const positive = group.find((t) => parseDecimal(t.amount).gt(0));

        if (negative && positive && negative.asset !== positive.asset) {
          const negativeAmount = parseDecimal(negative.amount);
          const positiveAmount = parseDecimal(positive.amount);

          const amountDiff = negativeAmount.minus(positiveAmount);
          const relativeDiff = amountDiff.dividedBy(Decimal.max(negativeAmount, positiveAmount));

          if (relativeDiff.lt(0.001)) {
            this.logger.info(
              `Token migration detected: ${negativeAmount.toString()} ${negative.asset} -> ${positiveAmount.toString()} ${positive.asset}`
            );

            const migrationTransaction = this.convertTokenMigrationToTransaction(negative, positive);
            transactions.push(migrationTransaction);

            processedRefIds.push(negative.refid, positive.refid);
            continue;
          }
        }
      }

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
}
