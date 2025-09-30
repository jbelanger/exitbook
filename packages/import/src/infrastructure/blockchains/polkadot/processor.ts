import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { TransactionType, UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { SubstrateFundFlow, SubstrateTransaction } from './substrate-types.js';
import { derivePolkadotAddressVariants } from './utils.js';

/**
 * Substrate transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Supports Polkadot, Kusama, Bittensor, and other
 * Substrate-based chains. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class PolkadotTransactionProcessor extends BaseTransactionProcessor {
  constructor(private _transactionRepository?: ITransactionRepository) {
    super('polkadot');
  }

  /**
   * Process normalized SubstrateTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata?.address) {
      return err('Missing session address in metadata for Substrate processing');
    }

    const sessionContext = this.enrichSessionContext(sessionMetadata.address);
    const transactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as SubstrateTransaction;
      try {
        const fundFlow = this.analyzeFundFlowFromNormalized(normalizedTx, sessionContext);
        const transactionType = this.determineTransactionTypeFromFundFlow(fundFlow, normalizedTx);

        const universalTransaction: UniversalTransaction = {
          amount: createMoney(fundFlow.totalAmount, fundFlow.currency),
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          fee: createMoney(fundFlow.feeAmount, fundFlow.feeCurrency),
          from: fundFlow.fromAddress,
          id: normalizedTx.id,
          metadata: {
            blockchain: 'substrate',
            blockHeight: normalizedTx.blockHeight,
            blockId: normalizedTx.blockId,
            call: fundFlow.call,
            chainName: fundFlow.chainName,
            fundFlow: {
              eventCount: fundFlow.eventCount,
              extrinsicCount: fundFlow.extrinsicCount,
              hasGovernance: fundFlow.hasGovernance,
              hasMultisig: fundFlow.hasMultisig,
              hasProxy: fundFlow.hasProxy,
              hasStaking: fundFlow.hasStaking,
              hasUtilityBatch: fundFlow.hasUtilityBatch,
              isIncoming: fundFlow.isIncoming,
              isOutgoing: fundFlow.isOutgoing,
              netAmount: fundFlow.netAmount,
            },
            module: fundFlow.module,
            providerId: normalizedTx.providerId,
          },
          source: 'substrate',
          status: normalizedTx.status === 'success' ? 'ok' : 'failed',
          symbol: fundFlow.currency,
          timestamp: normalizedTx.timestamp,
          to: fundFlow.toAddress,
          type: transactionType,
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Processed normalized Substrate transaction ${normalizedTx.id} - Type: ${transactionType}, ` +
            `Net: ${fundFlow.netAmount} ${fundFlow.currency}, Chain: ${fundFlow.chainName}`
        );
      } catch (error) {
        this.logger.warn(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    return Promise.resolve(ok(transactions));
  }

  /**
   * Enrich session context with SS58 address variants for better transaction matching.
   * Similar to Bitcoin's derived address approach but for Substrate/Polkadot ecosystem.
   */
  protected enrichSessionContext(address: string): ImportSessionMetadata {
    if (!address) {
      throw new Error('Missing session address in metadata for Polkadot processing');
    }

    // Generate SS58 address variants for all addresses
    const allDerivedAddresses: string[] = [];

    const variants = derivePolkadotAddressVariants(address);
    allDerivedAddresses.push(...variants);

    // Remove duplicates
    const uniqueDerivedAddresses = Array.from(new Set(allDerivedAddresses));

    this.logger.info(
      `Enriched Polkadot session context - Original address: ${address}, ` +
        `SS58 variants generated: ${uniqueDerivedAddresses.length}`
    );

    return {
      address: address,
      derivedAddresses: uniqueDerivedAddresses,
    };
  }

  /**
   * Analyze fund flow from normalized Substrate transaction data
   */
  private analyzeFundFlowFromNormalized(
    transaction: SubstrateTransaction,
    sessionContext: ImportSessionMetadata
  ): SubstrateFundFlow {
    const userAddresses = new Set(sessionContext.derivedAddresses || [sessionContext.address]);

    const isFromUser = userAddresses.has(transaction.from);
    const isToUser = userAddresses.has(transaction.to);

    // Analyze transaction characteristics
    const hasStaking =
      transaction.module === 'staking' ||
      transaction.call?.includes('bond') ||
      transaction.call?.includes('nominate') ||
      transaction.call?.includes('unbond') ||
      transaction.call?.includes('withdraw');

    const hasGovernance =
      transaction.module === 'democracy' ||
      transaction.module === 'council' ||
      transaction.module === 'treasury' ||
      transaction.module === 'phragmenElection';

    const hasUtilityBatch = transaction.module === 'utility' && transaction.call?.includes('batch');
    const hasProxy = transaction.module === 'proxy';
    const hasMultisig = transaction.module === 'multisig';

    // Calculate flow amounts
    const amount = new Decimal(transaction.amount);
    const fee = new Decimal(transaction.feeAmount || '0');

    let netAmount: string;
    if (isFromUser && !isToUser) {
      // User is sending
      netAmount = amount.plus(fee).negated().toString();
    } else if (!isFromUser && isToUser) {
      // User is receiving
      netAmount = amount.toString();
    } else if (isFromUser && isToUser) {
      // Self-transaction, user only pays fee
      netAmount = fee.negated().toString();
    } else {
      // Shouldn't happen in practice
      netAmount = '0';
    }

    return {
      call: transaction.call || 'unknown',
      chainName: transaction.chainName || 'unknown',
      currency: transaction.currency,
      eventCount: transaction.events?.length || 0,
      extrinsicCount: hasUtilityBatch ? 1 : 1, // TODO: Parse batch details if needed
      feeAmount: transaction.feeAmount || '0',
      feeCurrency: transaction.feeCurrency || transaction.currency,
      feePaidByUser: isFromUser,
      fromAddress: transaction.from,
      hasGovernance: hasGovernance || false,
      hasMultisig: hasMultisig || false,
      hasProxy: hasProxy || false,
      hasStaking: hasStaking || false,
      hasUtilityBatch: hasUtilityBatch || false,
      isIncoming: isToUser && !isFromUser,
      isOutgoing: isFromUser && !isToUser,
      module: transaction.module || 'unknown',
      netAmount,
      toAddress: transaction.to,
      totalAmount: transaction.amount,
    };
  }

  /**
   * Determine transaction type based on fund flow analysis and historical patterns
   */
  private determineTransactionTypeFromFundFlow(
    fundFlow: SubstrateFundFlow,
    transaction: SubstrateTransaction
  ): TransactionType {
    // Staking operations
    if (fundFlow.hasStaking) {
      if (transaction.call?.includes('bond')) {
        return fundFlow.isOutgoing ? 'staking_deposit' : 'staking_reward';
      }
      if (transaction.call?.includes('unbond') || transaction.call?.includes('withdraw')) {
        return 'staking_withdrawal';
      }
      if (transaction.call?.includes('nominate') || transaction.call?.includes('chill')) {
        return 'staking_deposit'; // These usually involve staking
      }
      // Default staking behavior based on fund flow
      return fundFlow.isOutgoing ? 'staking_deposit' : 'staking_reward';
    }

    // Governance operations
    if (fundFlow.hasGovernance) {
      return fundFlow.isOutgoing ? 'governance_deposit' : 'governance_refund';
    }

    // Utility operations
    if (fundFlow.hasUtilityBatch) {
      return 'utility_batch';
    }

    // Proxy operations
    if (fundFlow.hasProxy) {
      return 'proxy';
    }

    // Multisig operations
    if (fundFlow.hasMultisig) {
      return 'multisig';
    }

    // Basic transfers
    if (fundFlow.isIncoming && !fundFlow.isOutgoing) {
      return 'deposit';
    }

    if (fundFlow.isOutgoing && !fundFlow.isIncoming) {
      return 'withdrawal';
    }

    if (fundFlow.isIncoming && fundFlow.isOutgoing) {
      return 'internal_transfer';
    }

    // Fee-only transactions
    const netAmount = new Decimal(fundFlow.netAmount);
    const feeAmount = new Decimal(fundFlow.feeAmount);
    if (netAmount.abs().equals(feeAmount)) {
      return 'fee';
    }

    return 'unknown';
  }
}
