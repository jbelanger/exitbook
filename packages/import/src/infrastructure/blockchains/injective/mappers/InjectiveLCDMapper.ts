import { type Result, err } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import { InjectiveBalanceResponseSchema } from '../schemas.js';
import type { InjectiveBalanceResponse } from '../types.js';

@RegisterTransactionMapper('injective-lcd')
export class InjectiveLCDTransactionMapper extends BaseRawDataMapper<
  InjectiveBalanceResponse,
  UniversalBlockchainTransaction
> {
  protected readonly schema = InjectiveBalanceResponseSchema;

  protected mapInternal(
    _rawData: InjectiveBalanceResponse,
    _sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    // LCD processor is for balance data, not transaction data
    // This processor is created for consistency but should not be used for balance operations
    return err('InjectiveLCDProcessor is designed for balance data, not transaction processing');
  }
}
