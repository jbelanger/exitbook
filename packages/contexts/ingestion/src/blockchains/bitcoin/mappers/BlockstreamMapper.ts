import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.js';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { UniversalBlockchainTransaction } from '../../shared/types.js';
import { BlockstreamTransactionSchema } from '../schemas.js';
import type { BlockstreamTransaction } from '../types.js';

@RegisterTransactionMapper('blockstream.info')
export class BlockstreamTransactionMapper extends BaseRawDataMapper<BlockstreamTransaction> {
  protected readonly schema = BlockstreamTransactionSchema;

  protected mapInternal(
    rawData: BlockstreamTransaction,
    sessionContext: ImportSessionMetadata,
  ): Result<UniversalBlockchainTransaction[], string> {
    const timestamp =
      rawData.status.confirmed && rawData.status.block_time
        ? rawData.status.block_time * 1000
        : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    // Extract addresses from rich session context (Bitcoin uses derivedAddresses)
    const addresses = sessionContext.derivedAddresses || [sessionContext.address];
    const relevantAddresses = new Set(addresses);

    // Check inputs - money going out of our wallet (Blockstream format)
    for (const input of rawData.vin) {
      if (
        input.prevout?.scriptpubkey_address &&
        relevantAddresses.has(input.prevout.scriptpubkey_address)
      ) {
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

    // All Bitcoin transactions are transfers in the universal blockchain transaction model
    const type: UniversalBlockchainTransaction['type'] = 'transfer';

    if (!isIncoming && !isOutgoing) {
      // Neither incoming nor outgoing - cannot determine transaction type
      return err(
        'Unable to determine transaction type: transaction has no relevant wallet addresses in inputs or outputs',
      );
    }

    const totalValue = Math.abs(totalValueChange);
    const fee = isOutgoing ? rawData.fee : 0;

    // Determine from/to addresses properly for transaction type mapping
    let fromAddress = '';
    let toAddress = '';

    if (isOutgoing) {
      // Outgoing: wallet → external
      // From address: first wallet address in inputs
      for (const input of rawData.vin) {
        if (
          input.prevout?.scriptpubkey_address &&
          relevantAddresses.has(input.prevout.scriptpubkey_address)
        ) {
          fromAddress = input.prevout.scriptpubkey_address;
          break;
        }
      }
      // To address: first external address in outputs
      for (const output of rawData.vout) {
        if (output.scriptpubkey_address && !relevantAddresses.has(output.scriptpubkey_address)) {
          toAddress = output.scriptpubkey_address;
          break;
        }
      }
    } else if (isIncoming) {
      // Incoming: external → wallet
      // From address: first external address in inputs
      for (const input of rawData.vin) {
        if (
          input.prevout?.scriptpubkey_address &&
          !relevantAddresses.has(input.prevout.scriptpubkey_address)
        ) {
          fromAddress = input.prevout.scriptpubkey_address;
          break;
        }
      }
      // To address: first wallet address in outputs
      for (const output of rawData.vout) {
        if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
          toAddress = output.scriptpubkey_address;
          break;
        }
      }
    }

    // Fallback to any address if specific logic didn't work
    if (!fromAddress && rawData.vin.length > 0 && rawData.vin[0]?.prevout?.scriptpubkey_address) {
      fromAddress = rawData.vin[0].prevout.scriptpubkey_address;
    }

    if (!toAddress && rawData.vout.length > 0 && rawData.vout[0]?.scriptpubkey_address) {
      toAddress = rawData.vout[0].scriptpubkey_address;
    }

    const btcAmount = (totalValue / 100000000).toString();
    const btcFee = (fee / 100000000).toString();

    const transaction: UniversalBlockchainTransaction = {
      amount: btcAmount,
      currency: 'BTC',
      from: fromAddress,
      id: rawData.txid,
      providerId: 'blockstream.info',
      status: rawData.status.confirmed ? 'success' : 'pending',
      timestamp,
      to: toAddress,
      type,
    };

    // Add optional fields
    if (rawData.status.block_height) {
      transaction.blockHeight = rawData.status.block_height;
    }
    if (rawData.status.block_hash) {
      transaction.blockId = rawData.status.block_hash;
    }
    if (fee > 0) {
      transaction.feeAmount = btcFee;
      transaction.feeCurrency = 'BTC';
    }

    return ok([transaction]);
  }
}
