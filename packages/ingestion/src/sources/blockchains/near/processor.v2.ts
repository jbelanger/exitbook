import type { NearReceiptEvent } from '@exitbook/blockchain-providers';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  parseDecimal,
  type TokenMetadataRecord,
  type OperationType,
} from '@exitbook/core';
import { type Result, err, ok, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import { analyzeNearEvent } from './processor-utils.v2.js';
import type { NearFundFlow } from './types.v2.js';

/**
 * NEAR V2 transaction processor that converts receipt events
 * into ProcessedTransaction format. Uses receipt-level granularity
 * and NEAR-native semantics for accurate fund flow tracking.
 */
export class NearTransactionProcessorV2 extends BaseTransactionProcessor {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;

  constructor(tokenMetadataService: ITokenMetadataService, scamDetectionService?: IScamDetectionService) {
    super('near', tokenMetadataService, scamDetectionService);
  }

  /**
   * Process normalized data (structured NearReceiptEvent objects)
   * with receipt-level fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Enrich all receipt events with token metadata (required)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as NearReceiptEvent[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; receiptId: string }[] = [];
    const tokenMovementsForScamDetection: MovementWithContext[] = [];

    for (const item of normalizedData) {
      const receiptEvent = item as NearReceiptEvent;

      try {
        // Analyze receipt event to extract fund flows
        const analysisResult = analyzeNearEvent(receiptEvent, context.primaryAddress);

        if (analysisResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${analysisResult.error.message}`;
          processingErrors.push({ error: errorMsg, receiptId: receiptEvent.receiptId });
          this.logger.error(`${errorMsg} for NEAR receipt ${receiptEvent.receiptId} - THIS RECEIPT WILL BE LOST`);
          continue;
        }

        const analysis = analysisResult.value;

        // Build assetIds and movements
        const inflows = [];
        const outflows = [];
        let hasAssetIdError = false;

        for (const flow of analysis.flows) {
          // Skip fee flows - they're handled separately
          if (flow.flowType === 'fee') {
            continue;
          }

          const assetIdResult = this.buildNearAssetId(flow, receiptEvent.receiptId);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for flow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, receiptId: receiptEvent.receiptId });
            this.logger.error(`${errorMsg} for NEAR receipt ${receiptEvent.receiptId} - THIS RECEIPT WILL BE LOST`);
            hasAssetIdError = true;
            break;
          }

          const amount = parseDecimal(flow.amount);

          if (flow.direction === 'in') {
            inflows.push({
              assetId: assetIdResult.value,
              assetSymbol: flow.asset,
              grossAmount: amount,
              netAmount: amount,
            });
          } else if (flow.direction === 'out') {
            outflows.push({
              assetId: assetIdResult.value,
              assetSymbol: flow.asset,
              grossAmount: amount,
              netAmount: amount,
            });
          }
        }

        if (hasAssetIdError) {
          continue;
        }

        // Build fee assetId (always NEAR for NEAR blockchain)
        const feeAssetIdResult = buildBlockchainNativeAssetId('near');
        if (feeAssetIdResult.isErr()) {
          const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, receiptId: receiptEvent.receiptId });
          this.logger.error(`${errorMsg} for NEAR receipt ${receiptEvent.receiptId} - THIS RECEIPT WILL BE LOST`);
          continue;
        }
        const feeAssetId = feeAssetIdResult.value;

        // Extract fee if present
        const feeFlow = analysis.flows.find((f) => f.flowType === 'fee');
        const fees = feeFlow
          ? [
              {
                assetId: feeAssetId,
                assetSymbol: 'NEAR',
                amount: parseDecimal(feeFlow.amount),
                scope: 'network' as const,
                // NEAR balance changes already include fees (net deltas), so avoid double-counting
                settlement: 'on-chain' as const,
              },
            ]
          : [];

        // Determine from/to addresses
        let from: string | undefined;
        let to: string | undefined;

        if (outflows.length > 0) {
          from = receiptEvent.predecessorId;
        }
        if (inflows.length > 0) {
          to = receiptEvent.receiverId;
        }

        // Convert to ProcessedTransaction
        const universalTransaction: ProcessedTransaction = {
          externalId: receiptEvent.receiptId, // Receipt ID (unique per receipt)
          datetime: new Date(receiptEvent.timestamp).toISOString(),
          timestamp: receiptEvent.timestamp,
          source: 'near',
          status: receiptEvent.status === 'success' ? 'success' : 'failed',
          from,
          to,

          // Structured movements from fund flow analysis
          movements: {
            inflows,
            outflows,
          },

          fees,

          operation: {
            category: this.mapOperationTypeToCategory(analysis.operationType),
            type: analysis.operationType,
          },

          notes: this.buildNotes(receiptEvent, analysis.flows),

          blockchain: {
            name: 'near',
            block_height: receiptEvent.blockHeight,
            /**
             * IMPORTANT: For NEAR, we use receiptId as the transaction_hash for DB uniqueness.
             * This is because NEAR's execution model is receipt-based: one transaction spawns
             * multiple receipts, and each receipt is a separate event with its own state changes.
             *
             * Implications:
             * - DB constraint (account_id, blockchain_transaction_hash) will be unique per receipt
             * - Explorer links must use the parent transaction hash (stored in notes)
             * - Transaction grouping must use the parent transaction hash (event.id)
             * - This field is for DB identity, NOT for user-facing transaction references
             */
            transaction_hash: receiptEvent.receiptId, // Receipt ID (unique event identifier)
            is_confirmed: receiptEvent.status === 'success',
          },
        };

        // Collect token movements for batch scam detection
        const isAirdrop = outflows.length === 0 && !feeFlow;

        for (const flow of analysis.flows) {
          if (flow.flowType !== 'token_transfer' || !flow.contractId) {
            continue;
          }

          tokenMovementsForScamDetection.push({
            contractAddress: flow.contractId,
            asset: flow.asset,
            amount: parseDecimal(flow.amount),
            isAirdrop,
            transactionIndex: transactions.length,
          });
        }

        transactions.push(universalTransaction);

        this.logger.debug(`Successfully processed receipt ${receiptEvent.receiptId} - Type: ${analysis.operationType}`);
      } catch (error) {
        const errorMsg = `Error processing receipt event: ${String(error)}`;
        processingErrors.push({ error: errorMsg, receiptId: receiptEvent.receiptId });
        this.logger.error(`${errorMsg} for ${receiptEvent.receiptId} - THIS RECEIPT WILL BE LOST`);
        continue;
      }
    }

    // Batch scam detection
    if (tokenMovementsForScamDetection.length > 0) {
      const uniqueContracts = Array.from(new Set(tokenMovementsForScamDetection.map((m) => m.contractAddress)));
      let metadataMap = new Map<string, TokenMetadataRecord | undefined>();
      let detectionMode: 'metadata' | 'symbol-only' = 'symbol-only';

      if (this.tokenMetadataService && uniqueContracts.length > 0) {
        const metadataResult = await this.tokenMetadataService.getOrFetchBatch('near', uniqueContracts);

        if (metadataResult.isOk()) {
          metadataMap = metadataResult.value;
          detectionMode = 'metadata';
        } else {
          this.logger.warn(
            { error: metadataResult.error.message },
            'Metadata fetch failed for scam detection (falling back to symbol-only)'
          );
        }
      }

      this.applyScamDetection(transactions, tokenMovementsForScamDetection, metadataMap);
      this.logger.debug(
        `Applied ${detectionMode} scam detection to ${transactions.length} transactions (${uniqueContracts.length} tokens)`
      );
    }

    // Log processing summary
    const totalInputEvents = normalizedData.length;
    const failedEvents = processingErrors.length;

    // STRICT MODE: Fail if ANY receipts could not be processed
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for NEAR V2:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.receiptId.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedEvents}/${totalInputEvents} receipt events failed to process. ` +
          `Lost ${failedEvents} receipts which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.receiptId.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return okAsync(transactions);
  }

  /**
   * Enrich token metadata for all token transfers in receipt events
   */
  private async enrichTokenMetadata(events: NearReceiptEvent[]): Promise<Result<void, Error>> {
    // Collect all token transfers with contract addresses
    const tokenTransfersToEnrich = events.flatMap((event) => {
      if (!event.tokenTransfers) return [];
      return event.tokenTransfers.filter((transfer) => !!transfer.contractId);
    });

    if (tokenTransfersToEnrich.length === 0) {
      return ok(undefined);
    }

    this.logger.debug(`Enriching token metadata for ${tokenTransfersToEnrich.length} token transfers`);

    // Use the token metadata service to enrich with caching and provider fetching
    const enrichResult = await this.tokenMetadataService.enrichBatch(
      tokenTransfersToEnrich,
      'near',
      (transfer) => transfer.contractId,
      (transfer, metadata) => {
        if (metadata.symbol) {
          transfer.symbol = metadata.symbol;
        }
        // Update decimals if metadata has better info
        if (metadata.decimals !== undefined && metadata.decimals !== transfer.decimals) {
          this.logger.debug(
            `Updating decimals for ${transfer.contractId} from ${transfer.decimals} to ${metadata.decimals}`
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
    return ok(undefined);
  }

  /**
   * Build assetId for a NEAR fund flow
   */
  private buildNearAssetId(flow: NearFundFlow, receiptId: string): Result<string, Error> {
    // Native asset (NEAR) - no contract address
    if (!flow.contractId) {
      const assetSymbol = flow.asset.trim().toUpperCase();

      if (assetSymbol === 'NEAR') {
        return buildBlockchainNativeAssetId('near');
      }

      // If it's not NEAR and has no contract address, this is an error
      return err(new Error(`Missing contractId for non-native asset ${flow.asset} in receipt ${receiptId}`));
    }

    // NEP-141 token with contract address
    return buildBlockchainTokenAssetId('near', flow.contractId);
  }

  /**
   * Map OperationType to OperationCategory
   */
  private mapOperationTypeToCategory(
    type: OperationType
  ): 'trade' | 'transfer' | 'staking' | 'defi' | 'fee' | 'governance' {
    switch (type) {
      case 'buy':
      case 'sell':
      case 'swap':
        return 'trade';
      case 'transfer':
      case 'deposit':
      case 'withdrawal':
      case 'airdrop':
        return 'transfer';
      case 'stake':
      case 'unstake':
      case 'reward':
        return 'staking';
      case 'fee':
        return 'fee';
      case 'vote':
      case 'proposal':
        return 'governance';
      case 'batch':
      case 'refund':
      default:
        return 'defi';
    }
  }

  /**
   * Build notes for the transaction
   */
  private buildNotes(
    event: NearReceiptEvent,
    _flows: NearFundFlow[]
  ):
    | { message: string; metadata?: Record<string, unknown>; severity?: 'info' | 'warning' | 'error'; type: string }[]
    | undefined {
    const notes: { message: string; type: string }[] = [];

    // Add parent transaction hash (since blockchain_transaction_hash uses receiptId)
    notes.push({
      type: 'parent_transaction',
      message: `Transaction hash: ${event.id}`,
    });

    // Add receipt kind if not ACTION
    if (event.receiptKind !== 'ACTION') {
      notes.push({
        type: 'receipt_kind',
        message: `Receipt type: ${event.receiptKind}`,
      });
    }

    // Add action info
    if (event.actions && event.actions.length > 0) {
      const actionTypes = event.actions.map((a) => a.actionType).join(', ');
      notes.push({
        type: 'actions',
        message: `Actions: ${actionTypes}`,
      });
    }

    // Add method name for function calls
    const functionCall = event.actions?.find((a) => a.actionType === 'function_call');
    if (functionCall?.methodName) {
      notes.push({
        type: 'method',
        message: `Method: ${functionCall.methodName}`,
      });
    }

    // Add receipt ID for reference
    notes.push({
      type: 'receipt_id',
      message: `Receipt ID: ${event.receiptId}`,
    });

    return notes.length > 0 ? notes : undefined;
  }
}
