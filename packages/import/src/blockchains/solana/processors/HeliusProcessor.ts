import type { BlockchainTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney, maskAddress } from '@crypto/shared-utils';
import { type Result, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import type { SolanaRawTransactionData } from '../clients/HeliusApiClient.ts';
import { SolanaRawTransactionDataSchema } from '../schemas.ts';
import type { HeliusTransaction } from '../types.ts';
import { lamportsToSol } from '../utils.ts';

@RegisterProcessor('helius')
export class HeliusProcessor extends BaseProviderProcessor<SolanaRawTransactionData> {
  private static logger = getLogger('HeliusProcessor');
  protected readonly schema = SolanaRawTransactionDataSchema;

  private static extractTokenTransaction(tx: HeliusTransaction, userAddress: string): BlockchainTransaction | null {
    try {
      // Look for token balance changes in preTokenBalances and postTokenBalances
      const preTokenBalances = tx.meta.preTokenBalances || [];
      const postTokenBalances = tx.meta.postTokenBalances || [];

      // Find changes for token accounts owned by the user
      for (const postBalance of postTokenBalances) {
        // Check if this token account is owned by the user
        if (postBalance.owner !== userAddress) {
          continue;
        }

        const preBalance = preTokenBalances.find(
          pre => pre.accountIndex === postBalance.accountIndex && pre.mint === postBalance.mint
        );

        const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0') : 0;
        const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
        const change = postAmount - preAmount;

        // Skip if no meaningful change
        if (Math.abs(change) < 0.000001) {
          continue;
        }

        this.logger.debug(
          `Found SPL token transaction - Signature: ${tx.transaction.signatures?.[0] || tx.signature}, Mint: ${postBalance.mint}, Owner: ${postBalance.owner}, Change: ${Math.abs(change)}, Type: ${change > 0 ? 'transfer_in' : 'transfer_out'}`
        );

        // Determine transfer direction
        const type: 'transfer_in' | 'transfer_out' = change > 0 ? 'transfer_in' : 'transfer_out';

        // Use truncated mint address as fallback token symbol
        const tokenSymbol = `${postBalance.mint.slice(0, 6)}...`;

        return {
          blockHash: '',
          blockNumber: tx.slot,
          confirmations: 1,
          fee: createMoney(lamportsToSol(tx.meta.fee).toNumber(), 'SOL'),
          from: type === 'transfer_out' ? userAddress : '',
          gasPrice: undefined,
          gasUsed: undefined,
          hash: tx.transaction.signatures?.[0] || tx.signature,
          nonce: undefined,
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: tx.blockTime || 0,
          to: type === 'transfer_in' ? userAddress : '',
          tokenContract: postBalance.mint,
          tokenSymbol,
          type: 'token_transfer',
          value: createMoney(Math.abs(change), tokenSymbol),
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(
        `Failed to extract token transaction - Signature: ${tx.transaction.signatures?.[0] || tx.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  static processAddressTransactions(rawData: SolanaRawTransactionData, userAddress: string): BlockchainTransaction[] {
    const transactions: BlockchainTransaction[] = [];

    for (const tx of rawData.normal) {
      try {
        const processedTx = this.transformTransaction(tx, userAddress);
        if (processedTx) {
          transactions.push(processedTx);
        }
      } catch (error) {
        this.logger.debug(
          `Failed to process transaction - Signature: ${tx.transaction.signatures?.[0] || tx.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Sort by timestamp (newest first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    this.logger.debug(
      `Successfully processed address transactions - UserAddress: ${maskAddress(userAddress)}, ProcessedTransactions: ${transactions.length}, TotalRawTransactions: ${rawData.normal.length}`
    );

    return transactions;
  }

  private static transformTransaction(tx: HeliusTransaction, userAddress: string): BlockchainTransaction | null {
    try {
      const accountKeys = tx.transaction.message.accountKeys;
      const userIndex = accountKeys.findIndex(key => key === userAddress);

      // First check for token transfers - these are more important than SOL transfers
      const tokenTransaction = this.extractTokenTransaction(tx, userAddress);
      if (tokenTransaction) {
        return tokenTransaction;
      }

      // Fall back to SOL transfer handling
      if (userIndex !== -1) {
        const preBalance = tx.meta.preBalances[userIndex] || 0;
        const postBalance = tx.meta.postBalances[userIndex] || 0;
        const rawBalanceChange = postBalance - preBalance;

        // For fee payer, add back the fee to get the actual transfer amount
        const isFeePayerIndex = userIndex === 0;
        const feeAdjustment = isFeePayerIndex ? tx.meta.fee : 0;
        const balanceChange = rawBalanceChange + feeAdjustment;

        const amount = lamportsToSol(Math.abs(balanceChange));
        const type: 'transfer_in' | 'transfer_out' = balanceChange > 0 ? 'transfer_in' : 'transfer_out';
        const fee = lamportsToSol(tx.meta.fee);

        // Skip transactions with no meaningful amount (pure fee transactions)
        if (amount.toNumber() <= fee.toNumber() && amount.toNumber() < 0.000001) {
          this.logger.debug(
            `Skipping fee-only transaction - Hash: ${tx.transaction.signatures?.[0] || tx.signature}, Amount: ${amount.toNumber()}, Fee: ${fee.toNumber()}`
          );
          return null;
        }

        return {
          blockHash: '',
          blockNumber: tx.slot,
          confirmations: 1,
          fee: createMoney(fee.toNumber(), 'SOL'),
          from: type === 'transfer_out' ? userAddress : accountKeys?.[0] || '',
          gasPrice: undefined,
          gasUsed: undefined,
          hash: tx.transaction.signatures?.[0] || tx.signature,
          nonce: undefined,
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: tx.blockTime || 0,
          to: type === 'transfer_in' ? userAddress : '',
          tokenContract: undefined,
          tokenSymbol: 'SOL',
          type,
          value: createMoney(amount.toNumber(), 'SOL'),
        };
      }

      this.logger.debug(
        `Transaction not relevant to user - Signature: ${tx.transaction.signatures?.[0] || tx.signature}`
      );
      return null;
    } catch (error) {
      this.logger.warn(
        `Failed to transform transaction - Signature: ${tx.transaction.signatures?.[0] || tx.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  // IProviderProcessor interface implementation
  protected transformValidated(
    rawData: SolanaRawTransactionData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    // Extract addresses from rich session context
    const addresses = sessionContext.addresses || [];
    const userAddress = addresses[0] || '';

    if (!rawData.normal || rawData.normal.length === 0) {
      throw new Error('No transactions to transform from SolanaRawTransactionData');
    }

    const tx = rawData.normal[0];
    const processedTx = HeliusProcessor.transformTransaction(tx, userAddress);

    if (!processedTx) {
      throw new Error('Unable to transform Helius transaction to UniversalTransaction');
    }

    const transaction: UniversalBlockchainTransaction = {
      amount: processedTx.value.amount.toString(),
      currency: processedTx.tokenSymbol || 'SOL',
      from: processedTx.from,
      id: processedTx.hash,
      providerId: 'helius',
      status: processedTx.status === 'success' ? 'success' : 'failed',
      timestamp: processedTx.timestamp * 1000,
      to: processedTx.to,
      type: processedTx.type === 'token_transfer' ? 'token_transfer' : 'transfer',
    };

    // Add optional fields
    if (processedTx.blockNumber > 0) {
      transaction.blockHeight = processedTx.blockNumber;
    }
    if (processedTx.fee.amount.toNumber() > 0) {
      transaction.feeAmount = processedTx.fee.amount.toString();
      transaction.feeCurrency = 'SOL';
    }
    if (processedTx.tokenContract) {
      transaction.tokenAddress = processedTx.tokenContract;
      transaction.tokenSymbol = processedTx.tokenSymbol || 'UNKNOWN';
    }

    return ok(transaction);
  }
}
