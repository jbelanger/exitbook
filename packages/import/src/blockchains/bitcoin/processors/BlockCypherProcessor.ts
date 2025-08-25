import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { BlockCypherTransactionSchema } from '../schemas.ts';
import type { BlockCypherTransaction } from '../types.ts';

@RegisterProcessor('blockcypher')
export class BlockCypherProcessor implements IProviderProcessor<BlockCypherTransaction> {
  transform(rawData: BlockCypherTransaction, walletAddresses: string[]): UniversalTransaction {
    const timestamp = rawData.confirmed ? new Date(rawData.confirmed).getTime() : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs - money going out of our wallet (BlockCypher format uses arrays)
    for (const input of rawData.inputs) {
      if (input.addresses) {
        for (const address of input.addresses) {
          if (relevantAddresses.has(address)) {
            isOutgoing = true;
            if (input.output_value) {
              totalValueChange -= input.output_value;
            }
            break; // Found a match in this input
          }
        }
      }
    }

    // Check outputs - money coming into our wallet (BlockCypher format uses arrays)
    for (const output of rawData.outputs) {
      if (output.addresses) {
        for (const address of output.addresses) {
          if (relevantAddresses.has(address)) {
            isIncoming = true;
            totalValueChange += output.value;
            break; // Found a match in this output
          }
        }
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
    const fee = isOutgoing ? rawData.fees : 0;

    // Determine from/to addresses (first relevant address found)
    let fromAddress = '';
    let toAddress = '';

    // For from address, look for wallet addresses in inputs
    for (const input of rawData.inputs) {
      if (input.addresses) {
        for (const address of input.addresses) {
          if (relevantAddresses.has(address)) {
            fromAddress = address;
            break;
          }
        }
        if (fromAddress) break;
      }
    }

    // For to address, look for wallet addresses in outputs
    for (const output of rawData.outputs) {
      if (output.addresses) {
        for (const address of output.addresses) {
          if (relevantAddresses.has(address)) {
            toAddress = address;
            break;
          }
        }
        if (toAddress) break;
      }
    }

    // Fallback to first addresses if no wallet addresses found
    if (!fromAddress && rawData.inputs.length > 0 && rawData.inputs[0]?.addresses?.length > 0) {
      fromAddress = rawData.inputs[0].addresses[0];
    }

    if (!toAddress && rawData.outputs.length > 0 && rawData.outputs[0]?.addresses?.length > 0) {
      toAddress = rawData.outputs[0].addresses[0];
    }

    return {
      amount: createMoney(totalValue / 100000000, 'BTC'),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney(fee / 100000000, 'BTC'),
      from: fromAddress,
      id: rawData.hash,
      metadata: {
        blockchain: 'bitcoin',
        blockHash: rawData.block_hash || undefined,
        blockHeight: rawData.block_height || undefined,
        confirmations: rawData.confirmations || 0,
        providerId: 'blockcypher',
        rawData,
      },
      source: 'bitcoin',
      status: rawData.confirmations > 0 ? 'ok' : 'pending',
      symbol: 'BTC',
      timestamp,
      to: toAddress,
      type,
    };
  }

  validate(rawData: BlockCypherTransaction): ValidationResult {
    const result = BlockCypherTransactionSchema.safeParse(rawData);

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
