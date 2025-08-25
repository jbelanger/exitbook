import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { MempoolTransactionSchema } from '../schemas.ts';
import type { MempoolTransaction } from '../types.ts';

@RegisterProcessor('mempool.space')
export class MempoolSpaceProcessor implements IProviderProcessor<MempoolTransaction> {
  transform(rawData: MempoolTransaction, walletAddresses: string[]): UniversalTransaction {
    const timestamp =
      rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time * 1000 : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs - money going out of our wallet
    for (const input of rawData.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        isOutgoing = true;
        if (input.prevout?.value) {
          totalValueChange -= input.prevout.value;
        }
      }
    }

    // Check outputs - money coming into our wallet
    for (const output of rawData.vout) {
      if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
        isIncoming = true;
        totalValueChange += output.value;
      }
    }

    // Determine transaction type
    let type: UniversalTransaction['type'];

    if (isIncoming && !isOutgoing) {
      type = 'deposit';
    } else if (isOutgoing && !isIncoming) {
      type = 'withdrawal';
    } else if (isIncoming && isOutgoing) {
      // Internal transfer within our wallet
      type = 'transfer';
    } else {
      // Neither incoming nor outgoing (shouldn't happen with proper filtering)
      type = 'withdrawal';
    }

    const totalValue = Math.abs(totalValueChange);
    const fee = isOutgoing ? rawData.fee : 0;

    // Determine from/to addresses (first relevant address found)
    let fromAddress = '';
    let toAddress = '';

    // For from address, look for wallet addresses in inputs
    for (const input of rawData.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        fromAddress = input.prevout.scriptpubkey_address;
        break;
      }
    }

    // For to address, look for wallet addresses in outputs
    for (const output of rawData.vout) {
      if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
        toAddress = output.scriptpubkey_address;
        break;
      }
    }

    // Fallback to first addresses if no wallet addresses found
    if (!fromAddress && rawData.vin.length > 0 && rawData.vin[0]?.prevout?.scriptpubkey_address) {
      fromAddress = rawData.vin[0].prevout.scriptpubkey_address;
    }

    if (!toAddress && rawData.vout.length > 0 && rawData.vout[0]?.scriptpubkey_address) {
      toAddress = rawData.vout[0].scriptpubkey_address;
    }

    return {
      amount: createMoney(new Decimal(totalValue).div(100000000).toString(), 'BTC'),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney(new Decimal(fee).div(100000000).toString(), 'BTC'),
      from: fromAddress,
      id: rawData.txid,
      metadata: {
        blockchain: 'bitcoin',
        blockHash: rawData.status.block_hash || undefined,
        blockHeight: rawData.status.block_height || undefined,
        confirmations: rawData.status.confirmed ? 1 : 0,
        providerId: 'mempool.space',
        rawData,
      },
      source: 'bitcoin',
      status: rawData.status.confirmed ? 'ok' : 'pending',
      symbol: 'BTC',
      timestamp,
      to: toAddress,
      type,
    };
  }

  validate(rawData: MempoolTransaction): ValidationResult {
    const result = MempoolTransactionSchema.safeParse(rawData);

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
