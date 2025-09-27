import { parseDecimal } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import { InjectiveTransactionSchema } from '../schemas.js';
import type { InjectiveMessageValue, InjectiveTransaction } from '../types.js';

@RegisterTransactionMapper('injective-explorer')
export class InjectiveExplorerTransactionMapper extends BaseRawDataMapper<
  InjectiveTransaction,
  UniversalBlockchainTransaction
> {
  protected readonly schema = InjectiveTransactionSchema;

  protected mapInternal(
    rawData: InjectiveTransaction,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    const timestamp = new Date(rawData.block_timestamp).getTime();

    if (!sessionContext.address) {
      return err('Invalid address');
    }

    // Extract address from rich session context
    const relevantAddress = sessionContext.address;

    let amount = '0';
    let feeAmount = '0';
    let from = '';
    let to = '';
    let currency = 'INJ';
    let feeCurrency = 'INJ';

    // Parse fee from gas_fee field
    if (
      rawData.gas_fee &&
      rawData.gas_fee.amount &&
      Array.isArray(rawData.gas_fee.amount) &&
      rawData.gas_fee.amount.length > 0
    ) {
      const firstFee = rawData.gas_fee.amount[0];
      if (firstFee && firstFee.amount && firstFee.denom) {
        feeAmount = parseDecimal(firstFee.amount).div(Math.pow(10, 18)).toString();
        feeCurrency = this.formatDenom(firstFee.denom);
      }
    }

    // Parse messages to extract transfer information and determine relevance
    let isRelevantTransaction = false;
    let isIncoming = false;
    let isOutgoing = false;
    let eventNonce: string | undefined;

    for (const message of rawData.messages) {
      // Handle bank transfer messages
      if (message.type === '/cosmos.bank.v1beta1.MsgSend') {
        from = message.value.from_address || '';
        to = message.value.to_address || '';

        if (message.value.amount && Array.isArray(message.value.amount) && message.value.amount.length > 0) {
          const transferAmount = message.value.amount[0];
          if (transferAmount) {
            amount = parseDecimal(transferAmount.amount).div(Math.pow(10, 18)).toString();
            currency = this.formatDenom(transferAmount.denom);
          }
        }

        // Determine if this transaction is relevant to our wallet
        if (to && relevantAddress === to && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
          isIncoming = true;
        } else if (from && relevantAddress === from && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
          isOutgoing = true;
        }
        break; // Use first transfer message
      }

      // Handle IBC transfer messages
      else if (message.type === '/ibc.applications.transfer.v1.MsgTransfer') {
        from = message.value.sender || '';
        to = message.value.receiver || '';

        if (message.value.token) {
          amount = parseDecimal(message.value.token.amount).div(Math.pow(10, 18)).toString();
          currency = this.formatDenom(message.value.token.denom);
        }

        // Determine if this transaction is relevant to our wallet
        if (to && relevantAddress === to && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
          isIncoming = true;
        } else if (from && relevantAddress === from && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
          isOutgoing = true;
        }
        break;
      }

      // Handle Peggy bridge deposit messages (when funds come from Ethereum)
      else if (message.type === '/injective.peggy.v1.MsgDepositClaim') {
        const messageValue = message.value as InjectiveMessageValue & {
          cosmos_receiver?: string;
          ethereum_receiver?: string;
          ethereum_sender?: string;
          event_nonce?: string;
        };

        if (
          (messageValue.ethereum_receiver && relevantAddress === messageValue.ethereum_receiver) ||
          (messageValue.cosmos_receiver && relevantAddress === messageValue.cosmos_receiver)
        ) {
          isRelevantTransaction = true;
          isIncoming = true;
          to = messageValue.cosmos_receiver || messageValue.ethereum_receiver || '';
          eventNonce = messageValue.event_nonce;

          // Extract amount from the deposit claim if available
          if (messageValue.amount && messageValue.token_contract) {
            const amountValue =
              typeof messageValue.amount === 'string' ? messageValue.amount : messageValue.amount[0]?.amount || '0';
            amount = parseDecimal(amountValue).div(Math.pow(10, 18)).toString();
            currency = 'INJ';
          }
        }
      }
    }

    // Only process transactions that are relevant to our wallet
    if (!isRelevantTransaction) {
      throw new Error('Transaction is not relevant to provided wallet address');
    }

    // Determine transaction type
    let type: UniversalBlockchainTransaction['type'];

    if (isIncoming && !isOutgoing) {
      type = 'transfer';
    } else if (isOutgoing && !isIncoming) {
      type = 'transfer';
    } else if (isIncoming && isOutgoing) {
      type = 'transfer';
    } else {
      return err('Unable to determine transaction type - neither incoming nor outgoing flags set');
    }

    // For Peggy deposits, use event_nonce as the unique identifier to deduplicate validator consensus votes
    // Fall back to claim_id from transaction level if event_nonce is not available
    let peggyId: string | undefined;
    if (eventNonce) {
      peggyId = eventNonce;
    } else if (rawData.claim_id && Array.isArray(rawData.claim_id) && rawData.claim_id.length > 0) {
      peggyId = String(rawData.claim_id[0]);
    }

    const transactionId = peggyId ? `peggy-deposit-${peggyId}` : rawData.hash;

    const transaction: UniversalBlockchainTransaction = {
      amount,
      currency,
      from,
      id: transactionId,
      providerId: 'injective-explorer',
      status: rawData.code === 0 ? 'success' : 'failed',
      timestamp,
      to,
      type,
    };

    // Add optional fields
    if (rawData.block_number) {
      transaction.blockHeight = rawData.block_number;
    }
    if (feeAmount !== '0') {
      transaction.feeAmount = feeAmount;
      transaction.feeCurrency = feeCurrency;
    }

    return ok(transaction);
  }

  private formatDenom(denom: string | undefined): string {
    if (!denom) {
      return 'INJ';
    }

    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    return denom.toUpperCase();
  }
}
