import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { MempoolTransactionSchema } from '../schemas.ts';
import type { MempoolTransaction } from '../types.ts';

@RegisterProcessor('mempool.space')
export class MempoolSpaceProcessor extends BaseProviderProcessor<MempoolTransaction> {
  protected readonly schema = MempoolTransactionSchema;

  protected transformValidated(
    rawData: MempoolTransaction,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    const timestamp =
      rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time * 1000 : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let walletInputValue = 0;
    let walletOutputValue = 0;
    let isIncoming = false;
    let isOutgoing = false;
    let hasExternalOutput = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs - money going out of our wallet
    for (const input of rawData.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        isOutgoing = true;
        if (input.prevout?.value) {
          walletInputValue += input.prevout.value;
          totalValueChange -= input.prevout.value;
        }
      }
    }

    // Check outputs - money coming into our wallet or going to external addresses
    for (const output of rawData.vout) {
      if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
        isIncoming = true;
        walletOutputValue += output.value;
        totalValueChange += output.value;
      } else {
        // Output going to external address (not in wallet)
        hasExternalOutput = true;
      }
    }

    // Determine transaction type based on fund flow
    let type: UniversalTransaction['type'];

    if (isIncoming && !isOutgoing) {
      // Funds only coming into wallet from external sources
      type = 'deposit';
    } else if (isOutgoing && !isIncoming) {
      // Funds only going out to external addresses
      type = 'withdrawal';
    } else if (isIncoming && isOutgoing) {
      if (hasExternalOutput) {
        // Funds going out to external addresses (with possible change back to wallet)
        type = 'withdrawal';
        // For withdrawals, calculate the net amount going out (excluding change)
        totalValueChange = walletInputValue - walletOutputValue;
      } else {
        // Only internal movement between wallet addresses
        type = 'transfer';
      }
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
    });
  }
}
