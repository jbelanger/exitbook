import { type CardanoTransaction, CardanoTransactionSchema } from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, parseDecimal } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';

import { analyzeCardanoFundFlow, determineCardanoTransactionType } from './processor-utils.js';

/**
 * Cardano transaction processor that converts normalized blockchain transaction data
 * into ProcessedTransaction format.
 *
 * Cardano is a UTXO-based blockchain with native multi-asset support:
 * - Each transaction has inputs (UTXOs being spent) and outputs (new UTXOs created)
 * - Each input/output can contain multiple assets (ADA + native tokens)
 * - Fees are always paid in ADA
 *
 * Processing approach:
 * 1. Analyze inputs/outputs to determine which belong to user addresses
 * 2. Track movements for EACH asset separately
 * 3. Consolidate duplicate assets by summing amounts
 * 4. Determine transaction type based on fund flow direction
 */
export class CardanoTransactionProcessor extends BaseTransactionProcessor<CardanoTransaction> {
  constructor(scamDetectionService?: IScamDetectionService) {
    super('cardano', undefined, scamDetectionService);
  }

  protected get inputSchema() {
    return CardanoTransactionSchema;
  }

  /**
   * Process normalized Cardano transactions with multi-asset UTXO analysis
   */
  protected async transformNormalizedData(
    normalizedData: CardanoTransaction[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txHash: string }[] = [];
    const movementsForScamDetection: MovementWithContext[] = [];

    for (const normalizedTx of normalizedData) {
      try {
        // Perform fund flow analysis with multi-asset tracking
        const fundFlowResult = analyzeCardanoFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txHash: normalizedTx.id });
          this.logger.error(`${errorMsg} for Cardano transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type based on fund flow
        const transactionType = determineCardanoTransactionType(fundFlow);

        // Calculate fee details
        const feeAmount = parseDecimal(fundFlow.feeAmount || '0');
        const shouldRecordFeeEntry = fundFlow.feePaidByUser && !feeAmount.isZero();

        // Build assetId for fee (always ADA)
        const feeAssetIdResult = buildBlockchainNativeAssetId('cardano');
        if (feeAssetIdResult.isErr()) {
          const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txHash: normalizedTx.id });
          this.logger.error(`${errorMsg} for Cardano transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }
        const feeAssetId = feeAssetIdResult.value;

        // Build movements with assetId
        let hasAssetIdError = false;
        const inflows = [];
        for (const inflow of fundFlow.inflows) {
          const assetIdResult = this.buildCardanoAssetId(inflow);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for inflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txHash: normalizedTx.id });
            this.logger.error(`${errorMsg} for Cardano transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
            hasAssetIdError = true;
            break;
          }

          const amount = parseDecimal(inflow.amount);
          inflows.push({
            assetId: assetIdResult.value,
            assetSymbol: inflow.asset,
            grossAmount: amount,
            netAmount: amount, // Inflows: no fee adjustment needed
          });
        }

        if (hasAssetIdError) {
          continue;
        }

        const outflows = [];
        for (const outflow of fundFlow.outflows) {
          const assetIdResult = this.buildCardanoAssetId(outflow);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for outflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txHash: normalizedTx.id });
            this.logger.error(`${errorMsg} for Cardano transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
            hasAssetIdError = true;
            break;
          }

          const grossAmount = parseDecimal(outflow.amount);
          // For ADA outflows when user paid fee: netAmount = grossAmount - fee
          // For other assets or when no fee: netAmount = grossAmount
          const netAmount =
            outflow.asset === 'ADA' && shouldRecordFeeEntry ? grossAmount.minus(feeAmount) : grossAmount;

          outflows.push({
            assetId: assetIdResult.value,
            assetSymbol: outflow.asset,
            grossAmount, // Includes fee (total that left wallet)
            netAmount, // Actual transfer amount (excludes fee)
          });
        }

        if (hasAssetIdError) {
          continue;
        }

        // Build movements from fund flow
        // Convert to ProcessedTransaction format
        // ADR-005: For UTXO chains, grossAmount includes fees, netAmount is the actual transfer amount
        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'cardano',
          sourceType: 'blockchain',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from multi-asset UTXO analysis
          movements: {
            inflows,
            outflows,
          },

          fees: shouldRecordFeeEntry
            ? [
                {
                  assetId: feeAssetId,
                  assetSymbol: fundFlow.feeCurrency,
                  amount: feeAmount,
                  scope: 'network',
                  settlement: 'on-chain',
                },
              ]
            : [],

          operation: {
            category: 'transfer',
            type: transactionType,
          },

          blockchain: {
            name: 'cardano',
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Add note if there's classification uncertainty
          notes: fundFlow.classificationUncertainty
            ? [
                {
                  message: fundFlow.classificationUncertainty,
                  metadata: {
                    inflows: fundFlow.inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
                    outflows: fundFlow.outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
                  },
                  severity: 'info',
                  type: 'classification_uncertain',
                },
              ]
            : undefined,
        };

        // Collect token movements for batch scam detection later
        const allMovements = [...fundFlow.inflows, ...fundFlow.outflows];
        const isAirdrop = fundFlow.outflows.length === 0 && !fundFlow.feePaidByUser;

        for (const movement of allMovements) {
          if (!movement.policyId) {
            continue;
          }
          movementsForScamDetection.push({
            contractAddress: movement.policyId, // Cardano uses policyId as contract address
            asset: movement.asset,
            amount: parseDecimal(movement.amount),
            isAirdrop,
            transactionIndex: transactions.length, // Index of transaction we're about to push
          });
        }

        transactions.push(universalTransaction);

        this.logger.debug(
          `Successfully processed transaction ${universalTransaction.externalId} - Type: ${transactionType}, Primary: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
        );
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txHash: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Batch scam detection: Cardano has no metadata service, so detection is symbol-only
    // Token movements only (skip ADA)
    if (movementsForScamDetection.length > 0 && this.scamDetectionService) {
      this.markScamTransactions(transactions, movementsForScamDetection, new Map());
      this.logger.debug(`Applied symbol-only scam detection to ${transactions.length} transactions`);
    }

    // Log processing summary
    const totalInputTransactions = normalizedData.length;
    const failedTransactions = processingErrors.length;

    // STRICT MODE: Fail if ANY transactions could not be processed
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for Cardano:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.txHash.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedTransactions}/${totalInputTransactions} transactions failed to process. ` +
          `Lost ${failedTransactions} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.txHash.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return okAsync(transactions);
  }

  /**
   * Build assetId for a Cardano movement
   * - ADA (unit === 'lovelace'): blockchain:cardano:native
   * - Native token: blockchain:cardano:<unit> where unit = policyId + assetName (full unique identifier)
   *
   * CRITICAL: Must use the full unit (policyId + assetName), not just policyId.
   * Multiple assets can share the same policyId but have different assetNames.
   */
  private buildCardanoAssetId(movement: {
    asset: string;
    policyId?: string | undefined;
    unit: string;
  }): Result<string, Error> {
    // ADA is the native asset
    if (movement.unit === 'lovelace') {
      return buildBlockchainNativeAssetId('cardano');
    }

    // Native token - use the full unit (policyId + assetName) for uniqueness
    // The unit field already contains the complete unique identifier
    return buildBlockchainTokenAssetId('cardano', movement.unit);
  }
}
