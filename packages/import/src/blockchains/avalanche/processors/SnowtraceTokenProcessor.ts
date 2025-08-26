import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { SnowtraceTokenTransferSchema } from '../schemas.ts';
import type { SnowtraceTokenTransfer } from '../types.ts';

@RegisterProcessor('snowtrace-token')
export class SnowtraceTokenProcessor implements IProviderProcessor<SnowtraceTokenTransfer> {
  transform(rawData: SnowtraceTokenTransfer, walletAddresses: string[]): UniversalTransaction {
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

    const decimals = parseInt(rawData.tokenDecimal);
    const valueRaw = new Decimal(rawData.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return {
      amount: createMoney(value.toString(), rawData.tokenSymbol),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney('0', 'AVAX'),
      from: rawData.from,
      id: rawData.hash,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: parseInt(rawData.blockNumber),
        providerId: 'snowtrace-token',
        rawData,
      },
      source: 'avalanche',
      status: 'ok',
      symbol: rawData.tokenSymbol,
      timestamp,
      to: rawData.to,
      type,
    };
  }

  validate(rawData: SnowtraceTokenTransfer): ValidationResult {
    const result = SnowtraceTokenTransferSchema.safeParse(rawData);

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
