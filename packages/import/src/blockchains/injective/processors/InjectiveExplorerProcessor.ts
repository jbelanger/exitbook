import type { UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { InjectiveTransactionSchema } from '../schemas.ts';
import type { InjectiveMessageValue, InjectiveTransaction } from '../types.ts';

@RegisterProcessor('injective-explorer')
export class InjectiveExplorerProcessor implements IProviderProcessor<InjectiveTransaction> {
  private readonly INJECTIVE_DENOM = 'inj';

  private formatDenom(denom: string | undefined): string {
    if (!denom) {
      return 'INJ';
    }

    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    return denom.toUpperCase();
  }

  transform(rawData: InjectiveTransaction, walletAddresses: string[]): Result<UniversalTransaction, string> {
    const timestamp = new Date(rawData.block_timestamp).getTime();
    const relevantAddresses = new Set(walletAddresses);

    let value = createMoney(0, this.INJECTIVE_DENOM);
    let fee = createMoney(0, this.INJECTIVE_DENOM);
    let from = '';
    let to = '';
    let tokenSymbol = this.INJECTIVE_DENOM;

    // Parse fee from gas_fee field
    if (
      rawData.gas_fee &&
      rawData.gas_fee.amount &&
      Array.isArray(rawData.gas_fee.amount) &&
      rawData.gas_fee.amount.length > 0
    ) {
      const firstFee = rawData.gas_fee.amount[0];
      if (firstFee && firstFee.amount && firstFee.denom) {
        fee = createMoney(
          parseDecimal(firstFee.amount).div(Math.pow(10, 18)).toString(),
          this.formatDenom(firstFee.denom)
        );
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
            value = createMoney(
              parseDecimal(transferAmount.amount).div(Math.pow(10, 18)).toString(),
              this.formatDenom(transferAmount.denom)
            );
            tokenSymbol = this.formatDenom(transferAmount.denom);
          }
        }

        // Determine if this transaction is relevant to our wallet
        if (to && relevantAddresses.has(to) && value.amount.toNumber() > 0) {
          isRelevantTransaction = true;
          isIncoming = true;
        } else if (from && relevantAddresses.has(from) && value.amount.toNumber() > 0) {
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
          value = createMoney(
            parseDecimal(message.value.token.amount).div(Math.pow(10, 18)).toString(),
            this.formatDenom(message.value.token.denom)
          );
          tokenSymbol = this.formatDenom(message.value.token.denom);
        }

        // Determine if this transaction is relevant to our wallet
        if (to && relevantAddresses.has(to) && value.amount.toNumber() > 0) {
          isRelevantTransaction = true;
          isIncoming = true;
        } else if (from && relevantAddresses.has(from) && value.amount.toNumber() > 0) {
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
            value = createMoney(parseDecimal(amountValue).div(Math.pow(10, 18)).toString(), 'INJ');
            tokenSymbol = 'INJ';
          }
        }
      }
    }

    // Only process transactions that are relevant to our wallet
    if (!isRelevantTransaction) {
      throw new Error('Transaction is not relevant to provided wallet addresses');
    }

    // Determine transaction type based on Bitcoin pattern
    let type: UniversalTransaction['type'];

    if (isIncoming && !isOutgoing) {
      type = 'deposit';
    } else if (isOutgoing && !isIncoming) {
      type = 'withdrawal';
    } else if (isIncoming && isOutgoing) {
      type = 'transfer';
    } else {
      return err('Unable to determine transaction type - neither incoming nor outgoing flags set');
    }

    return ok({
      amount: value,
      datetime: new Date(timestamp).toISOString(),
      fee,
      from,
      id: rawData.hash,
      metadata: {
        blockchain: 'injective',
        blockNumber: rawData.block_number,
        confirmations: rawData.code === 0 ? 1 : 0,
        gasUsed: rawData.gas_used,
        providerId: 'injective-explorer',
        rawData,
      },
      source: 'injective',
      status: rawData.code === 0 ? 'ok' : 'failed',
      symbol: tokenSymbol,
      timestamp,
      to,
      type,
    });
  }

  validate(rawData: InjectiveTransaction): ValidationResult {
    const result = InjectiveTransactionSchema.safeParse(rawData);

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
