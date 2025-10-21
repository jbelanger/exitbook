import { createMoney, parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { BitcoinTransaction } from '@exitbook/providers';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { BitcoinFundFlow } from './types.ts';

/**
 * Bitcoin transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance. Optimized for multi-address processing using session context.
 */
export class BitcoinTransactionProcessor extends BaseTransactionProcessor {
  constructor() {
    super('bitcoin');
  }

  /**
   * Process normalized Bitcoin transactions with enhanced fund flow analysis.
   * Handles NormalizedBitcoinTransaction objects with structured input/output data.
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized Bitcoin transactions`);

    const transactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as BitcoinTransaction;

      try {
        // Perform enhanced fund flow analysis with structured input/output data
        const fundFlowResult = await Promise.resolve(this.analyzeFundFlowFromNormalized(normalizedTx, sessionMetadata));

        if (fundFlowResult.isErr()) {
          this.logger.warn(`Fund flow analysis failed for ${normalizedTx.id}: ${fundFlowResult.error}`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type based on fund flow
        const transactionType = this.determineTransactionTypeFromFundFlow(fundFlow, sessionMetadata);

        // Store actual network fees for reporting
        // For consistency with account-based blockchains, we record fees separately
        // and subtract them from outflows to avoid double-counting
        const userPaidFee = fundFlow.isOutgoing && parseFloat(fundFlow.walletInput) > 0;
        const feeAmount = parseFloat(normalizedTx.feeAmount || '0');
        const networkFee = userPaidFee
          ? createMoney(normalizedTx.feeAmount || '0', normalizedTx.feeCurrency || 'BTC')
          : createMoney('0', 'BTC');

        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          uniqueId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'bitcoin',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from UTXO analysis
          // For consistency with account-based blockchains:
          // - Outflows = amount sent (walletInput - fee - walletOutput)
          // - Inflows = amount received (walletOutput)
          // - Fees = recorded separately (not included in movements)
          // This ensures balance = inflows - outflows - fees (consistent across all blockchain types)
          movements: {
            outflows:
              parseFloat(fundFlow.walletInput) > 0
                ? [
                    {
                      asset: 'BTC',
                      // Subtract fee from outflow to avoid double-counting
                      // walletInput already includes the fee, so we remove it here
                      amount: parseDecimal((parseFloat(fundFlow.walletInput) - feeAmount).toString()),
                    },
                  ]
                : [],
            inflows:
              parseFloat(fundFlow.walletOutput) > 0
                ? [
                    {
                      asset: 'BTC',
                      amount: parseDecimal(fundFlow.walletOutput),
                    },
                  ]
                : [],
          },

          fees: {
            network: networkFee,
            platform: undefined, // Bitcoin has no platform fees
          },

          operation: {
            category: 'transfer',
            type: transactionType,
          },

          blockchain: {
            name: 'bitcoin',
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          metadata: {
            providerId: normalizedTx.providerId,
          },
        };

        transactions.push(universalTransaction);
        this.logger.debug(`Successfully processed normalized transaction ${universalTransaction.uniqueId}`);
      } catch (error) {
        this.logger.error(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    this.logger.info(`Normalized processing completed: ${transactions.length} transactions processed successfully`);
    return ok(transactions);
  }

  /**
   * Analyze fund flow from normalized Bitcoin transaction with structured input/output data.
   */
  private analyzeFundFlowFromNormalized(
    normalizedTx: BitcoinTransaction,
    sessionMetadata: Record<string, unknown>
  ): Result<BitcoinFundFlow, string> {
    // Convert all wallet addresses to lowercase for case-insensitive comparison
    const allWalletAddresses = new Set(
      [
        typeof sessionMetadata.address === 'string' ? sessionMetadata.address.toLowerCase() : undefined,
        ...(Array.isArray(sessionMetadata.derivedAddresses)
          ? sessionMetadata.derivedAddresses.filter((addr): addr is string => typeof addr === 'string')
          : []
        ).map((addr) => addr.toLowerCase()),
      ].filter(Boolean)
    );

    let totalInput = 0;
    let totalOutput = 0;
    let walletInput = 0;
    let walletOutput = 0;

    // Analyze inputs
    for (const input of normalizedTx.inputs) {
      const value = parseFloat(input.value);
      totalInput += value;

      if (input.address && allWalletAddresses.has(input.address.toLowerCase())) {
        walletInput += value;
      }
    }

    // Analyze outputs
    for (const output of normalizedTx.outputs) {
      const value = parseFloat(output.value);
      totalOutput += value;

      if (output.address && allWalletAddresses.has(output.address.toLowerCase())) {
        walletOutput += value;
      }
    }

    const netAmount = (walletOutput - walletInput) / 100000000;
    const isIncoming = walletOutput > walletInput;
    const isOutgoing = walletInput > walletOutput;

    // Determine primary addresses for from/to fields
    const fromAddress = isOutgoing
      ? normalizedTx.inputs.find((input) => input.address && allWalletAddresses.has(input.address.toLowerCase()))
          ?.address
      : normalizedTx.inputs[0]?.address;

    const toAddress = isIncoming
      ? normalizedTx.outputs.find((output) => output.address && allWalletAddresses.has(output.address.toLowerCase()))
          ?.address
      : normalizedTx.outputs[0]?.address;

    return ok({
      fromAddress,
      isIncoming,
      isOutgoing,
      netAmount: Math.abs(netAmount).toString(),
      toAddress,
      totalInput: (totalInput / 100000000).toString(),
      totalOutput: (totalOutput / 100000000).toString(),
      walletInput: (walletInput / 100000000).toString(),
      walletOutput: (walletOutput / 100000000).toString(),
    });
  }

  /**
   * Determine transaction type from fund flow analysis.
   */
  private determineTransactionTypeFromFundFlow(
    fundFlow: BitcoinFundFlow,
    _sessionMetadata: Record<string, unknown>
  ): 'deposit' | 'withdrawal' | 'transfer' | 'fee' {
    const { isIncoming, isOutgoing, walletInput, walletOutput } = fundFlow;

    // Check if this is a fee-only transaction
    const walletInputNum = parseFloat(walletInput);
    const walletOutputNum = parseFloat(walletOutput);
    const netAmount = Math.abs(walletOutputNum - walletInputNum);

    if (netAmount < 0.00001 && walletInputNum > 0) {
      // Very small net change with wallet involvement
      return 'fee';
    }

    // Determine transaction type based on fund flow direction
    if (isIncoming && isOutgoing) {
      // Both incoming and outgoing - internal transfer or self-send with change
      return 'transfer';
    } else if (isIncoming && !isOutgoing) {
      // Only incoming - deposit
      return 'deposit';
    } else if (!isIncoming && isOutgoing) {
      // Only outgoing - withdrawal
      return 'withdrawal';
    } else {
      // Neither incoming nor outgoing - shouldn't happen but default to transfer
      this.logger.warn(
        `Unable to determine transaction direction for ${fundFlow.fromAddress} -> ${fundFlow.toAddress}`
      );
      return 'transfer';
    }
  }
}
