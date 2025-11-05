import { parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { BitcoinTransaction } from '@exitbook/providers';
import { type Result, err, ok, okAsync } from 'neverthrow';

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
        const fundFlowResult = this.analyzeFundFlowFromNormalized(normalizedTx, sessionMetadata);

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
        const walletInputAmount = parseDecimal(fundFlow.walletInput);
        const walletOutputAmount = parseDecimal(fundFlow.walletOutput);
        const feeAmount = parseDecimal(normalizedTx.feeAmount || '0');
        const zeroDecimal = parseDecimal('0');

        const userPaidFee = fundFlow.isOutgoing && !walletInputAmount.isZero();
        const effectiveFeeAmount = userPaidFee ? feeAmount : zeroDecimal;

        // Measure wallet spend in two views:
        // - grossOutflow: balance impact (amount removed from wallet after accounting for change)
        // - netOutflow: amount that actually left to external parties (excludes change, still excludes fees)
        let grossOutflowAmount = zeroDecimal;
        let netOutflowAmount = zeroDecimal;

        if (!walletInputAmount.isZero()) {
          if (fundFlow.isOutgoing) {
            const baseOutflow = walletInputAmount.minus(walletOutputAmount);
            grossOutflowAmount = baseOutflow.isNegative() ? zeroDecimal : baseOutflow;
          } else {
            grossOutflowAmount = walletInputAmount;
          }

          netOutflowAmount = grossOutflowAmount.minus(effectiveFeeAmount);

          if (netOutflowAmount.isNegative()) {
            netOutflowAmount = zeroDecimal;
          }
        }

        const includeWalletOutputAsInflow = transactionType !== 'withdrawal' && !walletOutputAmount.isZero();
        const hasOutflow = !grossOutflowAmount.isZero();

        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'bitcoin',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from UTXO analysis
          // - Outflow grossAmount captures the BTC removed from wallet balance (after removing change)
          // - Outflow netAmount captures what actually left the wallet after on-chain fees
          // - Inflows are only recorded for bona fide incoming funds (deposits / true transfers)
          // Network fees remain explicit in the fees array
          movements: {
            outflows: hasOutflow
              ? [
                  {
                    asset: 'BTC',
                    grossAmount: grossOutflowAmount,
                    netAmount: netOutflowAmount,
                  },
                ]
              : [],
            inflows: includeWalletOutputAsInflow
              ? [
                  {
                    asset: 'BTC',
                    grossAmount: walletOutputAmount,
                    netAmount: walletOutputAmount,
                  },
                ]
              : [],
          },

          fees:
            userPaidFee && !feeAmount.isZero()
              ? [
                  {
                    asset: normalizedTx.feeCurrency || 'BTC',
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
        this.logger.debug(`Successfully processed normalized transaction ${universalTransaction.externalId}`);
      } catch (error) {
        this.logger.error(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    this.logger.info(`Normalized processing completed: ${transactions.length} transactions processed successfully`);
    return okAsync(transactions);
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

      // Address already normalized by BitcoinAddressSchema
      if (input.address && allWalletAddresses.has(input.address)) {
        walletInput += value;
      }
    }

    // Analyze outputs
    for (const output of normalizedTx.outputs) {
      const value = parseFloat(output.value);
      totalOutput += value;

      // Address already normalized by BitcoinAddressSchema
      if (output.address && allWalletAddresses.has(output.address)) {
        walletOutput += value;
      }
    }

    const netAmount = (walletOutput - walletInput) / 100000000;
    const isIncoming = walletOutput > walletInput;
    const isOutgoing = walletInput > walletOutput;

    // Determine primary addresses for from/to fields
    // Addresses already normalized by BitcoinAddressSchema
    const fromAddress = isOutgoing
      ? normalizedTx.inputs.find((input) => input.address && allWalletAddresses.has(input.address))?.address
      : normalizedTx.inputs[0]?.address;

    const toAddress = isIncoming
      ? normalizedTx.outputs.find((output) => output.address && allWalletAddresses.has(output.address))?.address
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
