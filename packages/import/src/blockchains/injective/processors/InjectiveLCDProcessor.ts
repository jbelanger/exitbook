import type { UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
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

  transform(rawData: InjectiveBalanceResponse, walletAddresses: string[]): UniversalTransaction {
    // LCD processor is for balance data, not transaction data
    // This processor is created for consistency but should not be used for balance operations
    throw new Error('InjectiveLCDProcessor is designed for balance data, not transaction processing');
  }

  validate(rawData: InjectiveBalanceResponse): ValidationResult {
    const errors: string[] = [];

    // Validate required fields for balance response
    if (!Array.isArray(rawData.balances)) {
      errors.push('Balances must be an array');
    }

    // Validate each balance entry
    for (const balance of rawData.balances || []) {
      if (!balance.amount) {
        errors.push('Balance amount is required');
      }

      if (!balance.denom) {
        errors.push('Balance denomination is required');
      }
    }

    const result: ValidationResult = {
      isValid: errors.length === 0,
    };

    if (errors.length > 0) {
      result.errors = errors;
    }

    return result;
  }
}
