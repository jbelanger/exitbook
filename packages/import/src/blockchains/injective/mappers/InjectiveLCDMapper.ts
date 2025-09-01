import { type Result, err } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataTransformer } from '../../shared/base-raw-data-mapper.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { InjectiveBalanceResponseSchema } from '../schemas.ts';
import type { InjectiveBalanceResponse } from '../types.ts';

@RegisterProcessor('injective-lcd')
export class InjectiveLCDProcessor extends BaseRawDataTransformer<InjectiveBalanceResponse> {
  protected readonly schema = InjectiveBalanceResponseSchema;
  private formatDenom(denom: string | undefined): string {
    if (!denom) {
      return 'INJ';
    }

    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    return denom.toUpperCase();
  }

  protected transformValidated(
    rawData: InjectiveBalanceResponse,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    // LCD processor is for balance data, not transaction data
    // This processor is created for consistency but should not be used for balance operations
    return err('InjectiveLCDProcessor is designed for balance data, not transaction processing');
  }
}
