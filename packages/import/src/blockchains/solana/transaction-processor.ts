import type { TransactionType, UniversalTransaction } from '@crypto/core';
// Import processors to trigger registration
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, ImportSessionMetadata } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../shared/types.ts';
import type { SolanaRawTransactionData } from './clients/HeliusApiClient.ts';
import './processors/index.ts';

/**
 * Solana transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors (Helius, SolanaRPC, Solscan) based on data provenance.
 */
export class SolanaTransactionProcessor extends BaseProcessor<ApiClientRawData<SolanaRawTransactionData>> {
  constructor() {
    super('solana');
  }

  private processSingle(
    rawDataItem: StoredRawData<ApiClientRawData<SolanaRawTransactionData>>,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalTransaction[], string> {
    const apiClientRawData = rawDataItem.rawData;
    const { providerId, rawData } = apiClientRawData;

    // Get the appropriate processor for this provider
    const processor = ProcessorFactory.create(providerId);
    if (!processor) {
      return err(`No processor found for provider: ${providerId}`);
    }

    // Transform the full batch using the provider-specific processor
    const transformResult = processor.transform(rawData, sessionContext);

    if (transformResult.isErr()) {
      return err(`Transform failed for ${providerId}: ${transformResult.error}`);
    }

    const blockchainTransactions = transformResult.value;
    const transactions: UniversalTransaction[] = [];

    // Convert each UniversalBlockchainTransaction to UniversalTransaction
    for (const blockchainTransaction of blockchainTransactions) {
      // Determine proper transaction type based on Solana transaction flow
      const transactionType = this.mapTransactionType(blockchainTransaction, sessionContext);

      // Convert UniversalBlockchainTransaction to UniversalTransaction
      const universalTransaction: UniversalTransaction = {
        amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
        datetime: new Date(blockchainTransaction.timestamp).toISOString(),
        fee: blockchainTransaction.feeAmount
          ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'SOL')
          : createMoney(0, 'SOL'),
        from: blockchainTransaction.from,
        id: blockchainTransaction.id,
        metadata: {
          blockchain: 'solana',
          blockHeight: blockchainTransaction.blockHeight,
          blockId: blockchainTransaction.blockId,
          providerId: blockchainTransaction.providerId,
          tokenAddress: blockchainTransaction.tokenAddress,
          tokenDecimals: blockchainTransaction.tokenDecimals,
          tokenSymbol: blockchainTransaction.tokenSymbol,
        },
        source: 'solana',
        status: blockchainTransaction.status === 'success' ? 'ok' : 'failed',
        symbol: blockchainTransaction.currency,
        timestamp: blockchainTransaction.timestamp,
        to: blockchainTransaction.to,
        type: transactionType,
      };

      // Log the transaction before adding to validation
      this.logger.debug(
        `Created UniversalTransaction - ID: ${universalTransaction.id}, Amount: ${JSON.stringify(universalTransaction.amount)}, Timestamp: ${universalTransaction.timestamp}, Status: ${universalTransaction.status}, Type: ${universalTransaction.type}, From: ${universalTransaction.from}, To: ${universalTransaction.to}`
      );

      transactions.push(universalTransaction);
      this.logger.debug(`Successfully processed transaction ${universalTransaction.id} from ${providerId}`);
    }

    return ok(transactions);
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  /**
   * Override the base transaction type mapping to handle Solana-specific cases.
   * Specifically handles self-transfers that represent staking rewards/penalties.
   */
  protected mapTransactionType(
    blockchainTransaction: UniversalBlockchainTransaction,
    sessionContext: ImportSessionMetadata
  ): TransactionType {
    const { amount, from, to, type } = blockchainTransaction;
    const allWalletAddresses = new Set([
      ...(sessionContext.addresses || []),
      ...(sessionContext.derivedAddresses || []),
    ]);

    const isFromWallet = from && allWalletAddresses.has(from);
    const isToWallet = to && allWalletAddresses.has(to);

    // Handle token transfers - they should follow standard direction logic
    if (type === 'token_transfer') {
      if (!isFromWallet && isToWallet) {
        return 'deposit';
      } else if (isFromWallet && !isToWallet) {
        return 'withdrawal';
      }
      return 'transfer';
    }

    // Handle staking operations
    if (type === 'delegate') {
      return 'withdrawal'; // Staking delegation - funds leaving active balance
    } else if (type === 'undelegate') {
      return 'deposit'; // Unstaking - funds returning to active balance
    }

    // Handle directional transfers from processor
    if (type === 'transfer_in') {
      return 'deposit';
    } else if (type === 'transfer_out') {
      return 'withdrawal';
    }

    // For SOL transfers, handle self-transfers specially for staking rewards
    if (isFromWallet && isToWallet && from === to) {
      // Self-transfer: determine type based on value change
      // Positive value = staking rewards, airdrops, etc. = deposit
      // Negative value = staking delegation, burns, etc. = withdrawal
      const transactionAmount = parseFloat(amount || '0');
      return transactionAmount > 0 ? 'deposit' : transactionAmount < 0 ? 'withdrawal' : 'transfer';
    }

    // Use base class logic for everything else
    return super.mapTransactionType(blockchainTransaction, sessionContext);
  }

  protected async processInternal(
    rawDataItems: StoredRawData<ApiClientRawData<SolanaRawTransactionData>>[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    // Use session metadata directly - no fallback logic
    const sessionContext: ImportSessionMetadata = sessionMetadata || {};

    for (const item of rawDataItems) {
      const result = this.processSingle(item, sessionContext);
      if (result.isErr()) {
        this.logger.warn(`Failed to process transaction batch ${item.sourceTransactionId}: ${result.error}`);
        continue; // Continue processing other transaction batches
      }

      const batchTransactions = result.value;
      if (batchTransactions && batchTransactions.length > 0) {
        transactions.push(...batchTransactions);
      }
    }

    return ok(transactions);
  }
}
