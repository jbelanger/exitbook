import type { RawData } from '@exitbook/data';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney, parseDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';
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
export class KrakenProcessor extends BaseTransactionProcessor {
  constructor() {
    super('kraken');
  }

  protected processInternal(rawDataItems: RawData[]): Promise<Result<UniversalTransaction[], string>> {
    try {
      // Extract the raw ledger rows for batch processing
      // Handle ApiClientRawData format: { providerId: string, rawData: CsvKrakenLedgerRow }
      const rows = rawDataItems.map((item) => item.raw_data as CsvKrakenLedgerRow);
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
    const platformFee = createMoney(fee, row.asset);

    return {
      // Core fields
      id: row.txid,
      datetime: row.time,
      timestamp,
      source: 'kraken',
      status: this.mapStatus(),

      // Structured movements - deposit means we gained assets
      movements: {
        inflows: [
          {
            asset: row.asset,
            amount: createMoney(netAmount, row.asset),
          },
        ],
        outflows: [], // No outflows for deposit
        primary: {
          asset: row.asset,
          amount: createMoney(netAmount, row.asset),
          direction: 'in' as const,
        },
      },

      // Structured fees - exchange deposits have platform fees
      fees: {
        network: undefined, // No network fee for exchange deposits
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 10/10 confidence: deposit is transfer/deposit
      operation: {
        category: 'transfer',
        type: 'deposit',
      },

      // Minimal metadata
      metadata: {
        wallet: row.wallet,
        originalRow: row,
      },
    };
  }

  private convertSingleTradeToTransaction(trade: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(trade.time).getTime();
    const amount = trade.amount;
    const fee = trade.fee || '0';
    const platformFee = createMoney(fee, trade.asset);
    const isIncoming = parseDecimal(amount).isPositive();

    // Single trade row means we only have one side - classify conservatively
    return {
      // Core fields
      id: trade.txid,
      datetime: trade.time,
      timestamp,
      source: 'kraken',
      status: this.mapStatus(),

      // Structured movements
      movements: {
        inflows: isIncoming
          ? [
              {
                asset: trade.asset,
                amount: createMoney(amount, trade.asset),
              },
            ]
          : [],
        outflows: !isIncoming
          ? [
              {
                asset: trade.asset,
                amount: createMoney(Math.abs(parseFloat(amount)).toString(), trade.asset),
              },
            ]
          : [],
        primary: {
          asset: trade.asset,
          amount: createMoney(amount, trade.asset),
          direction: isIncoming ? ('in' as const) : ('out' as const),
        },
      },

      // Structured fees
      fees: {
        network: undefined,
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 7/10 confidence: single trade row is ambiguous
      operation: {
        category: 'trade',
        type: isIncoming ? 'buy' : 'sell',
      },
      note: {
        type: 'classification_uncertainty',
        severity: 'info',
        message: 'Single trade row without paired transaction - classification may be incomplete',
      },

      // Minimal metadata
      metadata: {
        originalRow: trade,
      },
    };
  }

  private convertTokenMigrationToTransaction(
    negative: CsvKrakenLedgerRow,
    positive: CsvKrakenLedgerRow
  ): UniversalTransaction {
    const timestamp = new Date(negative.time).getTime();
    const sentAmount = negative.amount;
    const receivedAmount = positive.amount;

    // Token migration: swapping one asset for another (e.g., token rebrand)
    return {
      // Core fields
      id: `${negative.txid}_${positive.txid}`,
      datetime: negative.time,
      timestamp,
      source: 'kraken',
      status: this.mapStatus(),

      // Structured movements - token migration is a swap
      movements: {
        outflows: [
          {
            asset: negative.asset,
            amount: createMoney(Math.abs(parseFloat(sentAmount)).toString(), negative.asset),
          },
        ],
        inflows: [
          {
            asset: positive.asset,
            amount: createMoney(receivedAmount, positive.asset),
          },
        ],
        primary: {
          asset: positive.asset, // What we received is primary
          amount: createMoney(receivedAmount, positive.asset),
          direction: 'in' as const,
        },
      },

      // Structured fees - no fees for token migrations
      fees: {
        network: undefined,
        platform: createMoney('0', positive.asset),
        total: createMoney('0', positive.asset),
      },

      // Operation classification - 10/10 confidence: token migration is a swap
      operation: {
        category: 'trade',
        type: 'swap',
      },

      // Minimal metadata
      metadata: {
        tokenMigration: true,
        fromAsset: negative.asset,
        toAsset: positive.asset,
        originalRows: { negative, positive },
      },
      price: createMoney(sentAmount, negative.asset),
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
    const isReceiveFee = receive.asset === feeAsset && !parseDecimal(receiveFee).isZero();
    const finalReceiveAmount = isReceiveFee ? String(parseDecimal(receiveAmount).minus(totalFee)) : receiveAmount;

    const platformFee = createMoney(totalFee, feeAsset);

    // Paired spend/receive is a trade: spent X, received Y
    return {
      // Core fields
      id: spend.txid,
      datetime: spend.time,
      timestamp,
      source: 'kraken',
      status: this.mapStatus(),

      // Structured movements - trade has both outflow (spend) and inflow (receive)
      movements: {
        outflows: [
          {
            asset: spend.asset,
            amount: createMoney(Math.abs(parseFloat(spendAmount)).toString(), spend.asset),
          },
        ],
        inflows: [
          {
            asset: receive.asset,
            amount: createMoney(finalReceiveAmount, receive.asset),
          },
        ],
        primary: {
          asset: receive.asset, // What we received is primary
          amount: createMoney(finalReceiveAmount, receive.asset),
          direction: 'in' as const,
        },
      },

      // Structured fees
      fees: {
        network: undefined,
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 10/10 confidence: paired spend/receive is a trade
      operation: {
        category: 'trade',
        type: 'swap', // Generic swap since we don't know if it's buy/sell
      },

      // Minimal metadata
      metadata: {
        originalRows: { spend, receive },
      },
      price: createMoney(spendAmount, spend.asset),
    };
  }

  private convertTransferToTransaction(transfer: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(transfer.time).getTime();
    const isIncoming = parseDecimal(transfer.amount).isPositive();
    const platformFee = createMoney(transfer.fee || '0', transfer.asset);
    const absAmount = Math.abs(parseFloat(transfer.amount)).toString();

    return {
      // Core fields
      id: transfer.txid,
      datetime: transfer.time,
      timestamp,
      source: 'kraken',
      status: this.mapStatus(),

      // Structured movements
      movements: {
        inflows: isIncoming
          ? [
              {
                asset: transfer.asset,
                amount: createMoney(absAmount, transfer.asset),
              },
            ]
          : [],
        outflows: !isIncoming
          ? [
              {
                asset: transfer.asset,
                amount: createMoney(absAmount, transfer.asset),
              },
            ]
          : [],
        primary: {
          asset: transfer.asset,
          amount: createMoney(transfer.amount, transfer.asset),
          direction: isIncoming ? ('in' as const) : ('out' as const),
        },
      },

      // Structured fees
      fees: {
        network: undefined,
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 9/10 confidence: transfer type is reliable
      operation: {
        category: 'transfer',
        type: isIncoming ? 'deposit' : 'withdrawal',
      },

      // Minimal metadata
      metadata: {
        isTransfer: true,
        transferType: transfer.subtype,
        wallet: transfer.wallet,
        originalRow: transfer,
      },
    };
  }

  private convertWithdrawalToTransaction(row: CsvKrakenLedgerRow): UniversalTransaction {
    const timestamp = new Date(row.time).getTime();
    const platformFee = createMoney(row.fee, row.asset);
    const absAmount = Math.abs(parseFloat(row.amount)).toString();

    return {
      // Core fields
      id: row.txid,
      datetime: row.time,
      timestamp,
      source: 'kraken',
      status: this.mapStatus(),

      // Structured movements - withdrawal means we lost assets
      movements: {
        inflows: [],
        outflows: [
          {
            asset: row.asset,
            amount: createMoney(absAmount, row.asset),
          },
        ],
        primary: {
          asset: row.asset,
          amount: createMoney(row.amount, row.asset),
          direction: 'out' as const,
        },
      },

      // Structured fees
      fees: {
        network: undefined,
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 10/10 confidence: withdrawal is transfer/withdrawal
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },

      // Minimal metadata
      metadata: {
        wallet: row.wallet,
        originalRow: row,
      },
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
            const receivePlatformFee = createMoney(receiveFee, receive.asset);

            const depositTransaction: UniversalTransaction = {
              // Core fields
              id: receive.txid,
              datetime: receive.time,
              timestamp: new Date(receive.time).getTime(),
              source: 'kraken',
              status: this.mapStatus(),

              // Structured movements - dustsweeping deposit
              movements: {
                inflows: [
                  {
                    asset: receive.asset,
                    amount: createMoney(netReceiveAmount, receive.asset),
                  },
                ],
                outflows: [],
                primary: {
                  asset: receive.asset,
                  amount: createMoney(netReceiveAmount, receive.asset),
                  direction: 'in' as const,
                },
              },

              // Structured fees
              fees: {
                network: undefined,
                platform: receivePlatformFee,
                total: receivePlatformFee,
              },

              // Operation classification - 9/10 confidence: dustsweeping is a deposit
              operation: {
                category: 'transfer',
                type: 'deposit',
              },
              note: {
                type: 'dustsweeping',
                severity: 'info',
                message: `Dustsweeping: multiple small amounts consolidated into ${netReceiveAmount} ${receive.asset}`,
              },

              // Minimal metadata
              metadata: {
                dustsweeping: true,
                relatedRefId: refId,
                wallet: receive.wallet,
                originalRow: receive,
              },
            };
            transactions.push(depositTransaction);

            // Create withdrawal transactions for each spend
            for (const spend of spends) {
              const spendAmount = parseDecimal(spend.amount);
              const spendFee = parseDecimal(spend.fee || '0');
              const spendPlatformFee = createMoney(spendFee, spend.asset);
              const absSpendAmount = spendAmount.abs().toString();

              const withdrawalTransaction: UniversalTransaction = {
                // Core fields
                id: spend.txid,
                datetime: spend.time,
                timestamp: new Date(spend.time).getTime(),
                source: 'kraken',
                status: this.mapStatus(),

                // Structured movements - dustsweeping withdrawal
                movements: {
                  inflows: [],
                  outflows: [
                    {
                      asset: spend.asset,
                      amount: createMoney(absSpendAmount, spend.asset),
                    },
                  ],
                  primary: {
                    asset: spend.asset,
                    amount: createMoney(spendAmount, spend.asset),
                    direction: 'out' as const,
                  },
                },

                // Structured fees
                fees: {
                  network: undefined,
                  platform: spendPlatformFee,
                  total: spendPlatformFee,
                },

                // Operation classification - 9/10 confidence: dustsweeping is a withdrawal
                operation: {
                  category: 'transfer',
                  type: 'withdrawal',
                },
                note: {
                  type: 'dustsweeping',
                  severity: 'info',
                  message: `Dustsweeping: small amount ${absSpendAmount} ${spend.asset} consolidated with others`,
                },

                // Minimal metadata
                metadata: {
                  dustsweeping: true,
                  relatedRefId: refId,
                  wallet: spend.wallet,
                  originalRow: spend,
                },
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
