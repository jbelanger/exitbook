import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { BlockstreamTransactionSchema } from '../schemas.ts';
import type { BlockstreamTransaction } from '../types.ts';

@RegisterProcessor('blockstream.info')
export class BlockstreamProcessor implements IProviderProcessor<BlockstreamTransaction> {
  transform(rawData: BlockstreamTransaction, walletAddresses: string[]): Result<UniversalTransaction, string> {
    const timestamp =
      rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time * 1000 : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs - money going out of our wallet (Blockstream format)
    for (const input of rawData.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        isOutgoing = true;
        if (input.prevout?.value) {
          totalValueChange -= input.prevout.value;
        }
      }
    }

    // Check outputs - money coming into our wallet (Blockstream format)
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
      // Neither incoming nor outgoing - cannot determine transaction type
      return err(
        'Unable to determine transaction type: transaction has no relevant wallet addresses in inputs or outputs'
      );
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

    return ok({
      amount: createMoney(totalValue / 100000000, 'BTC'),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney(fee / 100000000, 'BTC'),
      from: fromAddress,
      id: rawData.txid,
      metadata: {
        blockchain: 'bitcoin',
        blockHash: rawData.status.block_hash || undefined,
        blockHeight: rawData.status.block_height || undefined,
        confirmations: rawData.status.confirmed ? 1 : 0,
        providerId: 'blockstream.info',
        rawData,
      },
      source: 'bitcoin',
      status: rawData.status.confirmed ? 'ok' : 'pending',
      symbol: 'BTC',
      timestamp,
      to: toAddress,
      type,
    });
  }

  validate(rawData: BlockstreamTransaction): ValidationResult {
    const result = BlockstreamTransactionSchema.safeParse(rawData);

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
