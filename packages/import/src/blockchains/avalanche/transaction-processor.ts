import type { UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData, ValidationResult } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './processors/index.ts';
import {
  SnowtraceInternalTransactionSchema,
  SnowtraceTokenTransferSchema,
  SnowtraceTransactionSchema,
} from './schemas.ts';
import type { AvalancheRawTransactionData } from './transaction-importer.ts';
import type {
  SnowtraceInternalTransaction,
  SnowtraceTokenTransfer,
  SnowtraceTransaction,
  TransactionGroup,
} from './types.ts';
import { AvalancheUtils } from './utils.ts';

/**
 * Avalanche transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format using correlation system for smart classification.
 */
export class AvalancheTransactionProcessor extends BaseProcessor<ApiClientRawData<AvalancheRawTransactionData>> {
  private correlationLogger = getLogger('AvalancheCorrelation');

  constructor(_dependencies: IDependencyContainer) {
    super('avalanche');
  }

  private transformInternalTransaction(
    rawData: SnowtraceInternalTransaction,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    const userAddress = walletAddresses[0] || '';
    const isFromUser = rawData.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = rawData.to.toLowerCase() === userAddress.toLowerCase();

    let type: UniversalTransaction['type'];
    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'withdrawal';
    } else {
      type = 'deposit';
    }

    const valueWei = new Decimal(rawData.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return ok({
      amount: createMoney(valueAvax.toString(), 'AVAX'),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney('0', 'AVAX'),
      from: rawData.from,
      id: rawData.hash,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: parseInt(rawData.blockNumber),
        rawData,
        transactionType: 'internal',
      },
      source: 'avalanche',
      status: rawData.isError === '0' ? 'ok' : 'failed',
      symbol: 'AVAX',
      timestamp,
      to: rawData.to,
      type,
    });
  }

  private transformNormalTransaction(
    rawData: SnowtraceTransaction,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    // Use the existing normal transaction processor logic
    const processor = ProcessorFactory.create('snowtrace');
    if (!processor) {
      return err('Normal transaction processor not found');
    }

    return processor.transform(rawData, walletAddresses);
  }

  private transformTokenTransfer(
    rawData: SnowtraceTokenTransfer,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    const userAddress = walletAddresses[0] || '';
    const isFromUser = rawData.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = rawData.to.toLowerCase() === userAddress.toLowerCase();

    let type: UniversalTransaction['type'];
    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'withdrawal';
    } else {
      type = 'deposit';
    }

    const decimals = parseInt(rawData.tokenDecimal);
    const valueRaw = new Decimal(rawData.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return ok({
      amount: createMoney(value.toString(), rawData.tokenSymbol),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney('0', 'AVAX'),
      from: rawData.from,
      id: rawData.hash,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: parseInt(rawData.blockNumber),
        rawData,
        transactionType: 'token',
      },
      source: 'avalanche',
      status: 'ok',
      symbol: rawData.tokenSymbol,
      timestamp,
      to: rawData.to,
      type,
    });
  }

  private validateInternalTransaction(rawData: SnowtraceInternalTransaction): ValidationResult {
    const result = SnowtraceInternalTransactionSchema.safeParse(rawData);

    if (result.success) {
      return { isValid: true };
    }

    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });

    return { errors, isValid: false };
  }

  private validateNormalTransaction(rawData: SnowtraceTransaction): ValidationResult {
    const result = SnowtraceTransactionSchema.safeParse(rawData);

    if (result.success) {
      return { isValid: true };
    }

    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });

    return { errors, isValid: false };
  }

  private validateTokenTransfer(rawData: SnowtraceTokenTransfer): ValidationResult {
    const result = SnowtraceTokenTransferSchema.safeParse(rawData);

    if (result.success) {
      return { isValid: true };
    }

    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });

    return { errors, isValid: false };
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  /**
   * Implement the template method to use correlation system
   */
  protected async processInternal(
    rawDataItems: StoredRawData<ApiClientRawData<AvalancheRawTransactionData>>[]
  ): Promise<Result<UniversalTransaction[], string>> {
    if (rawDataItems.length === 0) {
      return ok([]);
    }

    this.correlationLogger.info(`Processing ${rawDataItems.length} Avalanche transactions using correlation system`);

    // Group raw data by source address for correlation
    const addressGroups = new Map<
      string,
      {
        internal: SnowtraceInternalTransaction[];
        normal: SnowtraceTransaction[];
        tokens: SnowtraceTokenTransfer[];
      }
    >();

    // Separate transactions by type and address
    for (const rawDataItem of rawDataItems) {
      const apiClientRawData = rawDataItem.rawData;
      const sourceAddress = apiClientRawData.sourceAddress;

      if (!sourceAddress) {
        this.correlationLogger.warn('Skipping transaction without source address');
        continue;
      }

      if (!addressGroups.has(sourceAddress)) {
        addressGroups.set(sourceAddress, {
          internal: [],
          normal: [],
          tokens: [],
        });
      }

      const group = addressGroups.get(sourceAddress)!;
      const { rawData, transactionType } = apiClientRawData;

      // Sort transactions by transaction type
      if (transactionType === 'normal') {
        group.normal.push(rawData as SnowtraceTransaction);
      } else if (transactionType === 'internal') {
        group.internal.push(rawData as SnowtraceInternalTransaction);
      } else if (transactionType === 'token') {
        group.tokens.push(rawData as SnowtraceTokenTransfer);
      }
    }

    // Process each address group using correlation
    const allTransactions: UniversalTransaction[] = [];

    for (const [sourceAddress, transactionData] of addressGroups) {
      this.correlationLogger.debug(
        `Correlating transactions for address ${sourceAddress.substring(0, 10)}... - Normal: ${transactionData.normal.length}, Internal: ${transactionData.internal.length}, Token: ${transactionData.tokens.length}`
      );

      // Group transactions by hash
      const transactionGroups = AvalancheUtils.groupTransactionsByHash(
        transactionData.normal,
        transactionData.internal,
        transactionData.tokens,
        sourceAddress
      );

      this.correlationLogger.debug(
        `Created ${transactionGroups.length} correlation groups for address ${sourceAddress.substring(0, 10)}...`
      );

      // Process each correlated group
      const correlationProcessor = ProcessorFactory.create('avalanche-correlation');
      if (!correlationProcessor) {
        return err('Correlation processor not found');
      }

      for (const group of transactionGroups) {
        const validationResult = correlationProcessor.validate(group);
        if (!validationResult.isValid) {
          this.correlationLogger.warn(
            `Invalid transaction group ${group.hash}: ${validationResult.errors?.join(', ')}`
          );
          continue;
        }

        const transformResult = correlationProcessor.transform(group, [sourceAddress]);
        if (transformResult.isErr()) {
          this.correlationLogger.error(`Failed to transform group ${group.hash}: ${transformResult.error}`);
          continue;
        }

        const universalTransaction = transformResult.value;
        allTransactions.push(universalTransaction);

        this.correlationLogger.debug(
          `Successfully processed correlated transaction ${universalTransaction.id}: ${universalTransaction.type} of ${universalTransaction.amount.amount.toString()} ${universalTransaction.symbol}`
        );
      }
    }

    this.correlationLogger.info(
      `Correlation processing complete: ${rawDataItems.length} raw transactions → ${allTransactions.length} correlated transactions`
    );
    return ok(allTransactions);
  }
}
