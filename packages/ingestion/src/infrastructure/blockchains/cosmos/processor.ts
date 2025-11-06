import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { CosmosChainConfig, CosmosTransaction } from '@exitbook/providers';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import {
  analyzeFundFlowFromNormalized,
  deduplicateByTransactionId,
  determineOperationFromFundFlow,
} from './processor-utils.ts';

/**
 * Generic Cosmos SDK transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Works with any Cosmos SDK-based chain (Injective, Osmosis, etc.)
 * Uses ProcessorFactory to dispatch to provider-specific processors based on data provenance.
 * Enhanced with sophisticated fund flow analysis.
 */
export class CosmosProcessor extends BaseTransactionProcessor {
  private chainConfig: CosmosChainConfig;

  constructor(chainConfig: CosmosChainConfig, _transactionRepository?: ITransactionRepository) {
    super(chainConfig.chainName);
    this.chainConfig = chainConfig;
  }

  /**
   * Process normalized CosmosTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata?.address || typeof sessionMetadata.address !== 'string') {
      return err('No address provided in session metadata');
    }

    // Normalize user address to lowercase for case-insensitive matching
    // (normalized data addresses are already lowercase via CosmosAddressSchema)
    const userAddress = sessionMetadata.address.toLowerCase();

    // Deduplicate by transaction ID (handles cases like Peggy deposits where multiple validators
    // submit the same deposit claim with different tx hashes but same event_nonce-based ID)
    const deduplicatedData = deduplicateByTransactionId(normalizedData as CosmosTransaction[]);
    if (deduplicatedData.length < normalizedData.length) {
      this.logger.info(
        `Deduplicated ${normalizedData.length - deduplicatedData.length} transactions by ID (${normalizedData.length} → ${deduplicatedData.length})`
      );
    }

    const universalTransactions: UniversalTransaction[] = [];

    for (const transaction of deduplicatedData) {
      const normalizedTx = transaction;
      try {
        // Analyze fund flow for sophisticated transaction classification
        const fundFlow = analyzeFundFlowFromNormalized(normalizedTx, userAddress, this.chainConfig);

        // Determine operation classification based on fund flow
        const classification = determineOperationFromFundFlow(fundFlow);

        // Only include fees if user was the sender (they paid the fee)
        // For incoming transactions (deposits, received transfers), the sender/validator paid the fee
        // User paid fee if:
        // 1. They have ANY outflows (sent funds, delegated, swapped, etc.) OR
        // 2. They initiated a transaction with no outflows (governance votes, contract calls, etc.)
        // Note: Addresses are already normalized to lowercase via CosmosAddressSchema
        const userInitiatedTransaction = normalizedTx.from === userAddress;
        const userPaidFee = fundFlow.outflows.length > 0 || userInitiatedTransaction;

        // Convert to UniversalTransaction with enhanced metadata
        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: this.chainConfig.chainName,
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            inflows: fundFlow.inflows.map((inflow) => {
              const amount = parseDecimal(inflow.amount);
              return {
                asset: inflow.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
            outflows: fundFlow.outflows.map((outflow) => {
              const amount = parseDecimal(outflow.amount);
              return {
                asset: outflow.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
          },

          // Structured fees - only deduct from balance if user paid them
          fees:
            userPaidFee && !parseDecimal(fundFlow.feeAmount).isZero()
              ? [
                  {
                    asset: fundFlow.feeCurrency,
                    amount: parseDecimal(fundFlow.feeAmount),
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],

          operation: classification.operation,

          note: classification.note,

          blockchain: {
            name: this.chainConfig.chainName,
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Minimal metadata - only Cosmos-specific data
          metadata: {
            providerId: normalizedTx.providerId,
            blockId: normalizedTx.blockId,
            bridgeType: fundFlow.bridgeType,
            messageType: normalizedTx.messageType,
            ethereumSender: normalizedTx.ethereumSender,
            ethereumReceiver: normalizedTx.ethereumReceiver,
            eventNonce: normalizedTx.eventNonce,
            sourceChannel: normalizedTx.sourceChannel,
            sourcePort: normalizedTx.sourcePort,
            tokenAddress: fundFlow.primary.tokenAddress,
            tokenType: normalizedTx.tokenType,
            hasBridgeTransfer: fundFlow.hasBridgeTransfer,
            hasIbcTransfer: fundFlow.hasIbcTransfer,
            hasContractInteraction: fundFlow.hasContractInteraction,
          },
        };

        universalTransactions.push(universalTransaction);
      } catch (error) {
        this.logger.warn(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    return okAsync(universalTransactions);
  }
}
