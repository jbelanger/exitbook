import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
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
    const errors: string[] = [];

    // Validate required fields
    if (!rawData.hash) {
      errors.push('Transaction hash is required');
    }

    if (!Array.isArray(rawData.inputs)) {
      errors.push('Transaction inputs must be an array');
    }

    if (!Array.isArray(rawData.outputs)) {
      errors.push('Transaction outputs must be an array');
    }

    if (typeof rawData.fees !== 'number' || rawData.fees < 0) {
      errors.push('Transaction fees must be a non-negative number');
    }

    if (typeof rawData.confirmations !== 'number' || rawData.confirmations < 0) {
      errors.push('Transaction confirmations must be a non-negative number');
    }

    // Validate input structure
    if (Array.isArray(rawData.inputs)) {
      for (let i = 0; i < rawData.inputs.length; i++) {
        const input = rawData.inputs[i];
        if (!Array.isArray(input.addresses)) {
          errors.push(`Input ${i} addresses must be an array`);
        }
        if (typeof input.output_value !== 'number' || input.output_value < 0) {
          errors.push(`Input ${i} output_value must be a non-negative number`);
        }
      }
    }

    // Validate output structure
    if (Array.isArray(rawData.outputs)) {
      for (let i = 0; i < rawData.outputs.length; i++) {
        const output = rawData.outputs[i];
        if (!Array.isArray(output.addresses)) {
          errors.push(`Output ${i} addresses must be an array`);
        }
        if (typeof output.value !== 'number' || output.value < 0) {
          errors.push(`Output ${i} value must be a non-negative number`);
        }
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
