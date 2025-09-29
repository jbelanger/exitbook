import type { UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../app/ports/processors.ts';

// Import processors to trigger registration
import './register-mappers.ts';
import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import { TransactionMapperFactory } from '../../shared/processors/processor-registry.ts';

import { derivePolkadotAddressVariants } from './utils.ts';

/**
 * Polkadot transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class PolkadotTransactionProcessor extends BaseProcessor {
  constructor() {
    super('polkadot');
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
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

  protected async processInternal(
    rawDataItems: StoredRawData[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    if (!sessionMetadata?.address) {
      throw new Error('Missing session address in metadata for Polkadot processing');
    }

    // Enrich session context with SS58 address variants
    const sessionContext = this.enrichSessionContext(sessionMetadata.address);

    for (const item of rawDataItems) {
      const result = this.processSingle(item, sessionContext);
      if (result.isErr()) {
        this.logger.warn(`Failed to process transaction ${item.id}: ${result.error}`);
        continue; // Continue processing other transactions
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return Promise.resolve(ok(transactions));
  }

  private processSingle(
    rawDataItem: StoredRawData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalTransaction | undefined, string> {
    // Get the appropriate processor for this provider
    const processor = TransactionMapperFactory.create(rawDataItem.metadata.providerId);
    if (!processor) {
      return err(`No processor found for provider: ${rawDataItem.metadata.providerId}`);
    }

    // Transform using the provider-specific processor
    const transformResult = processor.map(rawDataItem.rawData, sessionContext) as Result<
      UniversalBlockchainTransaction,
      string
    >;

    if (transformResult.isErr()) {
      return err(`Transform failed for ${rawDataItem.metadata.providerId}: ${transformResult.error}`);
    }

    const blockchainTransactions = transformResult.value;
    if (!blockchainTransactions) {
      return err(`No transactions returned from ${rawDataItem.metadata.providerId} processor`);
    }

    // Polkadot processors return array with single transaction
    const blockchainTransaction = blockchainTransactions;

    if (!blockchainTransaction) {
      return err(`No valid transaction object returned from ${rawDataItem.metadata.providerId} processor`);
    }

    // Determine proper transaction type based on Polkadot transaction flow
    const transactionType = this.mapTransactionType(blockchainTransaction, sessionContext);

    // Convert UniversalBlockchainTransaction to UniversalTransaction
    const universalTransaction: UniversalTransaction = {
      amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
      datetime: new Date(blockchainTransaction.timestamp).toISOString(),
      fee: blockchainTransaction.feeAmount
        ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'DOT')
        : createMoney('0', 'DOT'),
      from: blockchainTransaction.from,
      id: blockchainTransaction.id,
      metadata: {
        blockchain: 'polkadot',
        blockHeight: blockchainTransaction.blockHeight,
        blockId: blockchainTransaction.blockId,
        providerId: blockchainTransaction.providerId,
      },
      source: 'polkadot',
      status: blockchainTransaction.status === 'success' ? 'ok' : 'failed',
      symbol: blockchainTransaction.currency,
      timestamp: blockchainTransaction.timestamp,
      to: blockchainTransaction.to,
      type: transactionType,
    };

    this.logger.debug(
      `Successfully processed transaction ${universalTransaction.id} from ${rawDataItem.metadata.providerId}`
    );
    return ok(universalTransaction);
  }
}
