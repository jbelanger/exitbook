import { type Result, err, ok } from 'neverthrow';

import { getLogger } from '../../../pino-logger.js';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.js';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { UniversalBlockchainTransaction } from '../../shared/types.js';
import { BlockCypherTransactionSchema } from '../schemas.js';
import type { BlockCypherTransaction } from '../types.js';

@RegisterTransactionMapper('blockcypher')
export class BlockCypherTransactionMapper extends BaseRawDataMapper<BlockCypherTransaction> {
  protected readonly schema = BlockCypherTransactionSchema;
  private logger = getLogger('BlockCypherProcessor');

  protected mapInternal(
    rawData: BlockCypherTransaction,
    sessionContext: ImportSessionMetadata,
  ): Result<UniversalBlockchainTransaction[], string> {
    // Extract addresses from rich session context (Bitcoin uses derivedAddresses)
    const addresses =
      sessionContext.derivedAddresses || (sessionContext.address ? [sessionContext.address] : []);

    this.logger.debug(
      `Transform called with ${addresses.length} wallet addresses: ${addresses
        .slice(0, 3)
        .map((addr) => addr.substring(0, 8) + '...')
        .join(', ')}${addresses.length > 3 ? '...' : ''}`,
    );

    const timestamp = rawData.confirmed ? new Date(rawData.confirmed).getTime() : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(addresses);

    // Check inputs and outputs to determine transaction type
    let walletInputValue = 0;
    let walletOutputValue = 0;
    let hasExternalOutput = false;

    // Check inputs - money going out of our wallet
    for (const input of rawData.inputs) {
      if (input.addresses) {
        for (const address of input.addresses) {
          if (relevantAddresses.has(address)) {
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

    // All Bitcoin transactions are transfers in the universal blockchain transaction model
    const type: UniversalBlockchainTransaction['type'] = 'transfer';

    if (!isIncoming && !isOutgoing) {
      // Neither incoming nor outgoing - cannot determine transaction type
      return err(
        'Unable to determine transaction type: transaction has no relevant wallet addresses in inputs or outputs',
      );
    }

    if (isIncoming && isOutgoing && hasExternalOutput) {
      // For withdrawals, calculate the net amount going out (excluding change)
      totalValueChange = walletInputValue - walletOutputValue;
    }

    const totalValue = Math.abs(totalValueChange);
    const fee = isOutgoing ? rawData.fees : 0;

    // Determine from/to addresses properly for transaction type mapping
    let fromAddress = '';
    let toAddress = '';

    if (isOutgoing) {
      // Outgoing: wallet → external
      // From address: first wallet address in inputs
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
      // To address: first external address in outputs
      for (const output of rawData.outputs) {
        if (output.addresses) {
          for (const address of output.addresses) {
            if (!relevantAddresses.has(address)) {
              toAddress = address;
              break;
            }
          }
          if (toAddress) break;
        }
      }
    } else if (isIncoming) {
      // Incoming: external → wallet
      // From address: first external address in inputs
      for (const input of rawData.inputs) {
        if (input.addresses) {
          for (const address of input.addresses) {
            if (!relevantAddresses.has(address)) {
              fromAddress = address;
              break;
            }
          }
          if (fromAddress) break;
        }
      }
      // To address: first wallet address in outputs
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
    }

    // Fallback to any address if specific logic didn't work
    if (
      !fromAddress &&
      rawData.inputs.length > 0 &&
      rawData.inputs[0] !== undefined &&
      rawData.inputs[0].addresses &&
      rawData.inputs[0].addresses.length > 0
    ) {
      fromAddress = rawData.inputs[0].addresses[0] ?? '';
    }

    if (
      !toAddress &&
      rawData.outputs.length > 0 &&
      rawData.outputs[0] !== undefined &&
      Array.isArray(rawData.outputs[0].addresses) &&
      rawData.outputs[0].addresses.length > 0
    ) {
      toAddress = rawData.outputs[0].addresses[0] ?? '';
    }

    const btcAmount = (totalValue / 100000000).toString();
    const btcFee = (fee / 100000000).toString();

    const transaction: UniversalBlockchainTransaction = {
      amount: btcAmount,
      currency: 'BTC',
      from: fromAddress,
      id: rawData.hash,
      providerId: 'blockcypher',
      status: rawData.confirmations > 0 ? 'success' : 'pending',
      timestamp,
      to: toAddress,
      type,
    };

    // Add optional fields
    if (rawData.block_height) {
      transaction.blockHeight = rawData.block_height;
    }
    if (rawData.block_hash) {
      transaction.blockId = rawData.block_hash;
    }
    if (fee > 0) {
      transaction.feeAmount = btcFee;
      transaction.feeCurrency = 'BTC';
    }

    return ok([transaction]);
  }
}
