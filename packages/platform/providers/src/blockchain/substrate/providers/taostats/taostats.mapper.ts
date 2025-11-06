import type { SourceMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../shared/blockchain/index.ts';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';

import { convertTaostatsTransaction, isTransactionRelevant } from './taostats.mapper-utils.ts';
import { TaostatsTransactionRawSchema, type TaostatsTransactionAugmented } from './taostats.schemas.js';

export class TaostatsTransactionMapper extends BaseRawDataMapper<TaostatsTransactionAugmented, SubstrateTransaction> {
  protected readonly inputSchema = TaostatsTransactionRawSchema;
  protected readonly outputSchema = SubstrateTransactionSchema;

  protected mapInternal(
    rawData: TaostatsTransactionAugmented,
    sourceContext: SourceMetadata
  ): Result<SubstrateTransaction, NormalizationError> {
    // Extract addresses from session context
    const addresses = sourceContext.derivedAddresses || (sourceContext.address ? [sourceContext.address] : []);
    const relevantAddresses = new Set(addresses);

    // Check if transaction involves any of our addresses
    if (!isTransactionRelevant(rawData, relevantAddresses)) {
      return err({
        message: `Transaction not relevant to user addresses: ${Array.from(relevantAddresses).join(', ')}`,
        type: 'error',
      });
    }

    // Get chain-specific info from augmented fields
    const nativeCurrency = rawData._nativeCurrency;

    // Convert transaction using pure function
    const transaction = convertTaostatsTransaction(rawData, nativeCurrency);

    return ok(transaction);
  }
}
