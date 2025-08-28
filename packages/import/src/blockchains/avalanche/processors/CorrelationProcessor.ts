import type { UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { TransactionGroup } from '../types.ts';
import { AvalancheUtils } from '../utils.ts';

@RegisterProcessor('avalanche-correlation')
export class CorrelationProcessor implements IProviderProcessor<TransactionGroup> {
  transform(rawData: TransactionGroup, walletAddresses: string[]): Result<UniversalTransaction, string> {
    try {
      // Use the correlation system to classify the transaction group
      const classification = AvalancheUtils.classifyTransactionGroup(rawData);

      // Create the primary transaction based on the classification
      let fee = createMoney('0', 'AVAX');

      // Calculate fee from normal transaction if available
      if (rawData.normal) {
        const gasUsed = new Decimal(rawData.normal.gasUsed);
        const gasPrice = new Decimal(rawData.normal.gasPrice);
        const feeWei = gasUsed.mul(gasPrice);
        const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));
        fee = createMoney(feeAvax.toString(), 'AVAX');
      }

      // Use classification results for amount and symbol
      const primaryAmount = classification.primaryAmount;
      const primarySymbol = classification.primarySymbol;

      // Determine from/to addresses based on transaction type and primary asset
      let fromAddress = '';
      let toAddress = '';

      if (classification.type === 'withdrawal') {
        fromAddress = rawData.userAddress;
        // Find the destination address from the primary asset flow
        if (classification.primarySymbol === 'AVAX') {
          // Look in internal transactions or normal transaction
          if (rawData.internal?.length) {
            const outgoingInternal = rawData.internal.find(
              tx => tx.from.toLowerCase() === rawData.userAddress.toLowerCase() && tx.value !== '0'
            );
            toAddress = outgoingInternal?.to || '';
          } else if (rawData.normal) {
            toAddress = rawData.normal.to;
          }
        } else {
          // Look in token transfers
          const outgoingToken = rawData.tokens?.find(
            tx =>
              tx.from.toLowerCase() === rawData.userAddress.toLowerCase() &&
              tx.tokenSymbol === classification.primarySymbol
          );
          toAddress = outgoingToken?.to || '';
        }
      } else if (classification.type === 'deposit') {
        toAddress = rawData.userAddress;
        // Find the source address from the primary asset flow
        if (classification.primarySymbol === 'AVAX') {
          // Look in internal transactions or normal transaction
          if (rawData.internal?.length) {
            const incomingInternal = rawData.internal.find(
              tx => tx.to.toLowerCase() === rawData.userAddress.toLowerCase() && tx.value !== '0'
            );
            fromAddress = incomingInternal?.from || '';
          } else if (rawData.normal) {
            fromAddress = rawData.normal.from;
          }
        } else {
          // Look in token transfers
          const incomingToken = rawData.tokens?.find(
            tx =>
              tx.to.toLowerCase() === rawData.userAddress.toLowerCase() &&
              tx.tokenSymbol === classification.primarySymbol
          );
          fromAddress = incomingToken?.from || '';
        }
      } else {
        // Transfer - use normal transaction addresses if available
        if (rawData.normal) {
          fromAddress = rawData.normal.from;
          toAddress = rawData.normal.to;
        }
      }

      return ok({
        amount: createMoney(primaryAmount, primarySymbol),
        datetime: new Date(rawData.timestamp).toISOString(),
        fee,
        from: fromAddress,
        id: rawData.hash,
        metadata: {
          blockchain: 'avalanche',
          blockNumber: rawData.normal
            ? parseInt(rawData.normal.blockNumber)
            : rawData.internal?.[0]
              ? parseInt(rawData.internal[0].blockNumber)
              : rawData.tokens?.[0]
                ? parseInt(rawData.tokens[0].blockNumber)
                : 0,
          classification,
          providerId: 'avalanche-correlation',
          rawData,
        },
        source: 'avalanche',
        status: 'ok',
        symbol: primarySymbol,
        timestamp: rawData.timestamp,
        to: toAddress,
        type: classification.type,
      });
    } catch (error) {
      return err(`Failed to process transaction group: ${error}`);
    }
  }

  validate(rawData: TransactionGroup): ValidationResult {
    if (!rawData.hash) {
      return {
        errors: ['Transaction hash is required'],
        isValid: false,
      };
    }

    if (!rawData.userAddress) {
      return {
        errors: ['User address is required'],
        isValid: false,
      };
    }

    if (!rawData.timestamp || rawData.timestamp <= 0) {
      return {
        errors: ['Valid timestamp is required'],
        isValid: false,
      };
    }

    // Must have at least one type of transaction
    if (
      !rawData.normal &&
      (!rawData.internal || rawData.internal.length === 0) &&
      (!rawData.tokens || rawData.tokens.length === 0)
    ) {
      return {
        errors: ['Transaction group must contain at least one transaction'],
        isValid: false,
      };
    }

    return { isValid: true };
  }
}
