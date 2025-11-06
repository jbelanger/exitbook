import { parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { NearTransaction } from '@exitbook/providers';
import { type Result, err, ok, okAsync } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import { looksLikeContractAddress, isMissingMetadata } from '../../../services/token-metadata/token-metadata-utils.js';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.js';

import { analyzeNearFundFlow, classifyNearOperationFromFundFlow } from './processor-utils.js';

/**
 * NEAR transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class NearTransactionProcessor extends BaseTransactionProcessor {
  constructor(
    private readonly tokenMetadataService: ITokenMetadataService,
    private readonly _transactionRepository?: ITransactionRepository
  ) {
    super('near');
  }

  /**
   * Process normalized data (structured NearTransaction objects)
   * with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized NEAR transactions`);

    // Enrich all transactions with token metadata (required)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as NearTransaction[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactions: UniversalTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as NearTransaction;

      try {
        // Perform enhanced fund flow analysis
        const fundFlowResult = analyzeNearFundFlow(normalizedTx, sessionMetadata);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for NEAR transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type and operation classification based on fund flow
        const classification = classifyNearOperationFromFundFlow(fundFlow, normalizedTx.actions || []);

        // Fix Issue #78: Record fees when the user paid them and they aren't already accounted for
        // within remaining NEAR outflows. When the fee fully consumes the NEAR movement (fee-only
        // transactions), we still need an explicit fee entry to avoid undercounting balances.
        const feeAccountedInMovements =
          fundFlow.feeAbsorbedByMovement &&
          fundFlow.outflows.some((movement) => movement.asset === (fundFlow.feeCurrency || 'NEAR'));

        const userPaidFee = fundFlow.feePaidByUser && !feeAccountedInMovements;

        // Convert to UniversalTransaction with structured fields
        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'near',
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
              // For outflows, use grossAmount if available (before fee deduction), otherwise use amount
              const netAmount = parseDecimal(outflow.amount);
              const grossAmount = outflow.grossAmount ? parseDecimal(outflow.grossAmount) : netAmount;
              return {
                asset: outflow.asset,
                grossAmount,
                netAmount,
              };
            }),
          },

          fees:
            userPaidFee && !parseDecimal(normalizedTx.feeAmount || '0').isZero()
              ? [
                  {
                    asset: normalizedTx.feeCurrency || 'NEAR',
                    amount: parseDecimal(normalizedTx.feeAmount || '0'),
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],

          operation: classification.operation,

          note: classification.note,

          blockchain: {
            name: 'near',
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Minimal metadata - only NEAR-specific data
          metadata: {
            blockId: normalizedTx.blockId,
            hasStaking: fundFlow.hasStaking,
            hasContractCall: fundFlow.hasContractCall,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
            actionCount: fundFlow.actionCount,
            actionTypes: fundFlow.actionTypes,
            providerName: normalizedTx.providerName,
            tokenAddress: fundFlow.primary.tokenAddress,
            tokenDecimals: fundFlow.primary.decimals,
          },
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Successfully processed transaction ${universalTransaction.externalId} - Category: ${classification.operation.category}, Type: ${classification.operation.type}, Amount: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
        );
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Log processing summary
    const totalInputTransactions = normalizedData.length;
    const successfulTransactions = transactions.length;
    const failedTransactions = processingErrors.length;

    this.logger.info(
      `Processing completed for NEAR: ${successfulTransactions} transactions processed, ${failedTransactions} failed (${failedTransactions}/${totalInputTransactions} transactions lost)`
    );

    // STRICT MODE: Fail if ANY transactions could not be processed
    // This is critical for portfolio accuracy - we cannot afford to silently drop transactions
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for NEAR:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.txId.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedTransactions}/${totalInputTransactions} transactions failed to process. ` +
          `Lost ${failedTransactions} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.txId.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return okAsync(transactions);
  }

  /**
   * Enrich token metadata for all transactions
   * Only fetches metadata for symbols that look like contract addresses
   */
  private async enrichTokenMetadata(transactions: NearTransaction[]): Promise<Result<void, Error>> {
    // Collect all token transfers that need enrichment
    const tokenTransfersToEnrich = transactions.flatMap((tx) => {
      if (!tx.tokenTransfers) return [];
      // Enrich if metadata is incomplete OR if symbol looks like a contract address
      return tx.tokenTransfers.filter(
        (transfer) =>
          isMissingMetadata(transfer.symbol, transfer.decimals) ||
          (transfer.symbol ? looksLikeContractAddress(transfer.symbol, 2) : false)
      );
    });

    if (tokenTransfersToEnrich.length === 0) {
      return ok(void 0);
    }

    this.logger.debug(`Enriching token metadata for ${tokenTransfersToEnrich.length} token transfers`);

    // Use the token metadata service to enrich with caching and provider fetching
    const enrichResult = await this.tokenMetadataService.enrichBatch(
      tokenTransfersToEnrich,
      'near',
      (transfer) => transfer.contractAddress,
      (transfer, metadata) => {
        if (metadata.symbol) {
          transfer.symbol = metadata.symbol;
        }
        // Decimals are already set from provider data, but update if metadata has better info
        if (metadata.decimals !== undefined && metadata.decimals !== transfer.decimals) {
          this.logger.debug(
            `Updating decimals for ${transfer.contractAddress} from ${transfer.decimals} to ${metadata.decimals}`
          );
          transfer.decimals = metadata.decimals;
        }
      },
      (transfer) => transfer.decimals !== undefined // Enrichment failure OK if decimals already present
    );

    if (enrichResult.isErr()) {
      return err(new Error(`Failed to enrich token metadata: ${enrichResult.error.message}`));
    }

    this.logger.debug('Successfully enriched token metadata from cache/provider');
    return ok(void 0);
  }
}
