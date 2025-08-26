import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { SnowtraceInternalTransactionSchema } from '../schemas.ts';
import type { SnowtraceInternalTransaction } from '../types.ts';

@RegisterProcessor('snowtrace-internal')
export class SnowtraceInternalProcessor implements IProviderProcessor<SnowtraceInternalTransaction> {
  transform(rawData: SnowtraceInternalTransaction, walletAddresses: string[]): UniversalTransaction {
    const userAddress = walletAddresses[0] || '';
    const isFromUser = rawData.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = rawData.to.toLowerCase() === userAddress.toLowerCase();

    let type: UniversalTransaction['type'];
    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'withdrawal';
    } else {
      type = 'deposit';
    }

    const valueWei = new Decimal(rawData.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return {
      amount: createMoney(valueAvax.toString(), 'AVAX'),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney('0', 'AVAX'),
      from: rawData.from,
      id: rawData.hash,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: parseInt(rawData.blockNumber),
        providerId: 'snowtrace-internal',
        rawData,
      },
      source: 'avalanche',
      status: rawData.isError === '0' ? 'ok' : 'failed',
      symbol: 'AVAX',
      timestamp,
      to: rawData.to,
      type,
    };
  }

  validate(rawData: SnowtraceInternalTransaction): ValidationResult {
    const result = SnowtraceInternalTransactionSchema.safeParse(rawData);

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
