import type { UniversalTransaction } from '@crypto/core';
import { type Result, err } from 'neverthrow';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { InjectiveBalanceResponseSchema } from '../schemas.ts';
import type { InjectiveBalanceResponse } from '../types.ts';

@RegisterProcessor('injective-lcd')
export class InjectiveLCDProcessor implements IProviderProcessor<InjectiveBalanceResponse> {
  private formatDenom(denom: string | undefined): string {
    if (!denom) {
      return 'INJ';
    }

    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    return denom.toUpperCase();
  }

  transform(rawData: InjectiveBalanceResponse, walletAddresses: string[]): Result<UniversalTransaction, string> {
    // LCD processor is for balance data, not transaction data
    // This processor is created for consistency but should not be used for balance operations
    return err('InjectiveLCDProcessor is designed for balance data, not transaction processing');
  }

  validate(rawData: InjectiveBalanceResponse): ValidationResult {
    const result = InjectiveBalanceResponseSchema.safeParse(rawData);

    if (result.success) {
      return { isValid: true };
    }

    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });

    return {
      errors,
      isValid: false,
    };
  }
}
