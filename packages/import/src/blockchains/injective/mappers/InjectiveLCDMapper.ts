import { type Result, err } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { InjectiveBalanceResponseSchema } from '../schemas.ts';
import type { InjectiveBalanceResponse } from '../types.ts';

@RegisterTransactionMapper('injective-lcd')
export class InjectiveLCDTransactionMapper extends BaseRawDataMapper<InjectiveBalanceResponse> {
  protected readonly schema = InjectiveBalanceResponseSchema;

  protected mapInternal(
    _rawData: InjectiveBalanceResponse,
    _sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    // LCD processor is for balance data, not transaction data
    // This processor is created for consistency but should not be used for balance operations
    return err('InjectiveLCDProcessor is designed for balance data, not transaction processing');
  }
}
