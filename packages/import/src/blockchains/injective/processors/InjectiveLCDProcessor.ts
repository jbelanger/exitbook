import type { UniversalTransaction } from '@crypto/core';
import { type Result, err } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { InjectiveBalanceResponseSchema } from '../schemas.ts';
import type { InjectiveBalanceResponse } from '../types.ts';

@RegisterProcessor('injective-lcd')
export class InjectiveLCDProcessor extends BaseProviderProcessor<InjectiveBalanceResponse> {
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
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    // LCD processor is for balance data, not transaction data
    // This processor is created for consistency but should not be used for balance operations
    return err('InjectiveLCDProcessor is designed for balance data, not transaction processing');
  }
}
