import type { BlockchainTransaction, UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney, maskAddress } from '@crypto/shared-utils';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { SolanaRawTransactionData } from '../clients/HeliusApiClient.ts';
import type { HeliusTransaction, SolanaTokenBalance } from '../types.ts';
import { lamportsToSol } from '../utils.ts';

@RegisterProcessor('helius')
export class HeliusProcessor implements IProviderProcessor<SolanaRawTransactionData> {
  private static logger = getLogger('HeliusProcessor');

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
  transform(rawData: SolanaRawTransactionData, walletAddresses: string[]): UniversalTransaction {
    // Process the first transaction for interface compatibility
    const userAddress = walletAddresses[0] || '';

    if (!rawData.normal || rawData.normal.length === 0) {
      throw new Error('No transactions to transform from SolanaRawTransactionData');
    }

    const tx = rawData.normal[0];
    const processedTx = HeliusProcessor.transformTransaction(tx, userAddress);

    if (!processedTx) {
      throw new Error('Unable to transform Helius transaction to UniversalTransaction');
    }

    // Convert BlockchainTransaction to UniversalTransaction
    let type: UniversalTransaction['type'];
    if (processedTx.type === 'transfer_in') {
      type = 'deposit';
    } else if (processedTx.type === 'transfer_out') {
      type = 'withdrawal';
    } else {
      type = 'transfer';
    }

    return {
      amount: processedTx.value,
      datetime: new Date(processedTx.timestamp * 1000).toISOString(),
      fee: processedTx.fee,
      from: processedTx.from,
      id: processedTx.hash,
      metadata: {
        blockchain: 'solana',
        blockNumber: processedTx.blockNumber,
        providerId: 'helius',
        rawData: tx,
      },
      source: 'solana',
      status: processedTx.status === 'success' ? 'ok' : 'failed',
      symbol: processedTx.tokenSymbol || 'SOL',
      timestamp: processedTx.timestamp * 1000,
      to: processedTx.to,
      type,
    };
  }

  validate(rawData: SolanaRawTransactionData): ValidationResult {
    const errors: string[] = [];

    // Validate the structure
    if (!rawData || typeof rawData !== 'object') {
      errors.push('Raw data must be a SolanaRawTransactionData object');
      return { errors, isValid: false };
    }

    if (!Array.isArray(rawData.normal)) {
      errors.push('Normal transactions must be an array');
      return { errors, isValid: false };
    }

    // Validate each transaction
    for (let i = 0; i < rawData.normal.length; i++) {
      const tx = rawData.normal[i];
      const prefix = `Transaction ${i}:`;

      // Check for signature
      if (!tx.signature && (!tx.transaction?.signatures || tx.transaction.signatures.length === 0)) {
        errors.push(`${prefix} Transaction signature is required`);
      }

      if (!tx.slot || typeof tx.slot !== 'number') {
        errors.push(`${prefix} Slot number is required and must be a number`);
      }

      if (!tx.transaction || typeof tx.transaction !== 'object') {
        errors.push(`${prefix} Transaction object is required`);
      }

      if (!tx.meta || typeof tx.meta !== 'object') {
        errors.push(`${prefix} Meta object is required`);
      }

      if (tx.transaction && (!tx.transaction.message || !tx.transaction.message.accountKeys)) {
        errors.push(`${prefix} Transaction message with accountKeys is required`);
      }

      if (tx.meta && (!Array.isArray(tx.meta.preBalances) || !Array.isArray(tx.meta.postBalances))) {
        errors.push(`${prefix} Meta preBalances and postBalances must be arrays`);
      }
    }

    return {
      isValid: errors.length === 0,
      ...(errors.length > 0 && { errors }),
    };
  }
}
