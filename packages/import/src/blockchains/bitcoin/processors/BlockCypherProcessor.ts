import type { UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { BlockCypherTransactionSchema } from '../schemas.ts';
import type { BlockCypherTransaction } from '../types.ts';

@RegisterProcessor('blockcypher')
export class BlockCypherProcessor extends BaseProviderProcessor<BlockCypherTransaction> {
  private logger = getLogger('BlockCypherProcessor');
  protected readonly schema = BlockCypherTransactionSchema;

  protected transformValidated(
    rawData: BlockCypherTransaction,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    this.logger.debug(
      `Transform called with ${walletAddresses.length} wallet addresses: ${walletAddresses
        .slice(0, 3)
        .map(addr => addr.substring(0, 8) + '...')
        .join(', ')}${walletAddresses.length > 3 ? '...' : ''}`
    );

    const timestamp = rawData.confirmed ? new Date(rawData.confirmed).getTime() : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs and outputs to determine transaction type
    let walletInputValue = 0;
    let walletOutputValue = 0;
    let hasExternalOutput = false;

    // Check inputs - money going out of our wallet
    for (const input of rawData.inputs) {
      if (input.addresses) {
        let hasWalletAddress = false;
        for (const address of input.addresses) {
          if (relevantAddresses.has(address)) {
            hasWalletAddress = true;
            isOutgoing = true;
            if (input.output_value) {
              walletInputValue += input.output_value;
              totalValueChange -= input.output_value;
            }
            break;
          }
        }
      }
    }

    // Check outputs - money coming into our wallet or going to external addresses
    for (const output of rawData.outputs) {
      if (output.addresses) {
        let hasWalletAddress = false;
        for (const address of output.addresses) {
          if (relevantAddresses.has(address)) {
            hasWalletAddress = true;
            isIncoming = true;
            walletOutputValue += output.value;
            totalValueChange += output.value;
            break;
          }
        }
        if (!hasWalletAddress) {
          hasExternalOutput = true;
        }
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

    return ok({
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
    });
  }
}
