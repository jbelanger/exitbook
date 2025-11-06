import { parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { SubstrateTransaction, SubstrateChainConfig } from '@exitbook/providers';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.js';

import {
  analyzeFundFlowFromNormalized,
  determineOperationFromFundFlow,
  didUserPayFee,
  enrichSourceContext,
} from './processor-utils.ts';

/**
 * Generic Substrate transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Supports Polkadot, Kusama, Bittensor, and other
 * Substrate-based chains. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class SubstrateProcessor extends BaseTransactionProcessor {
  private chainConfig: SubstrateChainConfig;

  constructor(
    chainConfig: SubstrateChainConfig,
    private _transactionRepository?: ITransactionRepository
  ) {
    super(chainConfig.chainName);
    this.chainConfig = chainConfig;
  }

  /**
   * Process normalized SubstrateTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata?.address || typeof sessionMetadata.address !== 'string') {
      return err('Missing session address in metadata for Substrate processing');
    }

    const sourceContextResult = enrichSourceContext(sessionMetadata.address);
    if (sourceContextResult.isErr()) {
      return err(sourceContextResult.error);
    }

    const sourceContext = sourceContextResult.value;
    const transactions: UniversalTransaction[] = [];

    this.logger.info(
      `Enriched Substrate session context - Original address: ${sessionMetadata.address}, ` +
        `SS58 variants generated: ${Array.isArray(sourceContext.derivedAddresses) ? sourceContext.derivedAddresses.length : 0}`
    );

    for (const item of normalizedData) {
      const normalizedTx = item as SubstrateTransaction;
      try {
        const fundFlow = analyzeFundFlowFromNormalized(normalizedTx, sourceContext, this.chainConfig);
        const classification = determineOperationFromFundFlow(fundFlow, normalizedTx);

        // Calculate direction for primary asset
        const hasInflow = fundFlow.inflows.some((i) => i.asset === fundFlow.primary.asset);
        const hasOutflow = fundFlow.outflows.some((o) => o.asset === fundFlow.primary.asset);
        const direction: 'in' | 'out' | 'neutral' =
          hasInflow && hasOutflow ? 'neutral' : hasInflow ? 'in' : hasOutflow ? 'out' : 'neutral';

        // Only include fees if user was the signer/broadcaster (they paid the fee)
        // For incoming transactions (deposits, received transfers), the sender/protocol paid the fee
        const userAddress = sessionMetadata.address;
        const userPaidFee = didUserPayFee(normalizedTx, fundFlow, userAddress);

        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          // NEW: Structured fields
          movements: {
            inflows: fundFlow.inflows.map((i) => {
              const amount = parseDecimal(i.amount);
              return {
                asset: i.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
            outflows: fundFlow.outflows.map((o) => {
              const amount = parseDecimal(o.amount);
              return {
                asset: o.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
          },
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
          blockchain: {
            name: fundFlow.chainName,
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
          note: classification.note,

          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'substrate',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          metadata: {
            blockchain: 'substrate',
            blockHeight: normalizedTx.blockHeight,
            blockId: normalizedTx.blockId,
            call: fundFlow.call,
            chainName: fundFlow.chainName,
            module: fundFlow.module,
            providerName: normalizedTx.providerName,
            events: normalizedTx.events ?? [],
          },
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Processed Substrate transaction ${normalizedTx.id} - ` +
            `Operation: ${classification.operation.category}/${classification.operation.type}, ` +
            `Primary: ${fundFlow.primary.amount} ${fundFlow.primary.asset} (${direction}), ` +
            `Chain: ${fundFlow.chainName}`
        );
      } catch (error) {
        this.logger.warn(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    return okAsync(transactions);
  }
}
