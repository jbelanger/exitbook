import { parseDecimal } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { InjectiveTransactionSchema } from '../schemas.ts';
import type { InjectiveMessageValue, InjectiveTransaction } from '../types.ts';

@RegisterProcessor('injective-explorer')
export class InjectiveExplorerProcessor extends BaseProviderProcessor<InjectiveTransaction> {
  private readonly INJECTIVE_DENOM = 'inj';
  protected readonly schema = InjectiveTransactionSchema;

  private formatDenom(denom: string | undefined): string {
    if (!denom) {
      return 'INJ';
    }

    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    return denom.toUpperCase();
  }

  protected transformValidated(
    rawData: InjectiveTransaction,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    const timestamp = new Date(rawData.block_timestamp).getTime();
    // Extract addresses from rich session context
    const addresses = sessionContext.addresses || [];
    const relevantAddresses = new Set(addresses);

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
        if (to && relevantAddresses.has(to) && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
          isIncoming = true;
        } else if (from && relevantAddresses.has(from) && parseDecimal(amount).toNumber() > 0) {
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
        if (to && relevantAddresses.has(to) && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
          isIncoming = true;
        } else if (from && relevantAddresses.has(from) && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
          isOutgoing = true;
        }
        break;
      }

      // Handle Peggy bridge deposit messages (when funds come from Ethereum)
      else if (message.type === '/injective.peggy.v1.MsgDepositClaim') {
        const messageValue = message.value as InjectiveMessageValue & {
          ethereum_receiver?: string;
          injective_receiver?: string;
        };
        if (
          (messageValue.ethereum_receiver && relevantAddresses.has(messageValue.ethereum_receiver)) ||
          (messageValue.injective_receiver && relevantAddresses.has(messageValue.injective_receiver))
        ) {
          isRelevantTransaction = true;
          isIncoming = true;
          to = messageValue.injective_receiver || messageValue.ethereum_receiver || '';

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
      throw new Error('Transaction is not relevant to provided wallet addresses');
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

    const transaction: UniversalBlockchainTransaction = {
      amount,
      currency,
      from,
      id: rawData.hash,
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
}
