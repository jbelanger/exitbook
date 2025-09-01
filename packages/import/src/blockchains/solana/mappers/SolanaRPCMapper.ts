import { getLogger } from '@crypto/shared-logger';
import { maskAddress } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataTransformer } from '../../shared/base-raw-data-mapper.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import type { SolanaRPCRawTransactionData } from '../clients/SolanaRPCApiClient.ts';
import { SolanaRPCRawTransactionDataSchema } from '../schemas.ts';
import type { SolanaRPCTransaction } from '../types.ts';
import { lamportsToSol } from '../utils.ts';

const logger = getLogger('SolanaRPCProcessor');

@RegisterProcessor('solana-rpc')
export class SolanaRPCProcessor extends BaseRawDataTransformer<SolanaRPCRawTransactionData> {
  protected readonly schema = SolanaRPCRawTransactionDataSchema;
  private static extractTokenTransaction(
    tx: SolanaRPCTransaction,
    userAddress: string,
    targetContract?: string
  ): UniversalBlockchainTransaction | null {
    try {
      // Look for token balance changes in preTokenBalances and postTokenBalances
      const preTokenBalances = tx.meta.preTokenBalances || [];
      const postTokenBalances = tx.meta.postTokenBalances || [];

      // Find changes for token accounts
      for (const postBalance of postTokenBalances) {
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

        // If a specific contract is specified, filter by it
        if (targetContract && postBalance.mint !== targetContract) {
          continue;
        }

        // Log any significant token transaction
        logger.debug(
          `Found SPL token transaction - Signature: ${tx.transaction.signatures?.[0]}, Mint: ${postBalance.mint}, Change: ${Math.abs(change)}, Type: ${change > 0 ? 'transfer_in' : 'transfer_out'}`
        );

        // Determine transfer direction
        const type: 'transfer_in' | 'transfer_out' = change > 0 ? 'transfer_in' : 'transfer_out';

        return {
          amount: Math.abs(change).toString(),
          blockHeight: tx.slot,
          currency: 'UNKNOWN', // Will be updated with proper symbol later
          feeAmount: lamportsToSol(tx.meta.fee).toString(),
          feeCurrency: 'SOL',
          from: type === 'transfer_out' ? userAddress : '',
          id: tx.transaction.signatures?.[0] || '',
          providerId: 'solana-rpc',
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: (tx.blockTime || 0) * 1000,
          to: type === 'transfer_in' ? userAddress : '',
          tokenAddress: postBalance.mint,
          tokenSymbol: 'UNKNOWN',
          type: 'token_transfer',
        };
      }

      return null;
    } catch (error) {
      logger.debug(
        `Failed to extract token transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  static processAddressTransactions(
    rawData: SolanaRPCRawTransactionData,
    userAddress: string
  ): UniversalBlockchainTransaction[] {
    logger.debug(
      `Processing Solana RPC address transactions - Address: ${maskAddress(userAddress)}, RawTransactionCount: ${rawData.normal.length}`
    );

    const transactions: UniversalBlockchainTransaction[] = [];

    for (const tx of rawData.normal) {
      const processedTx = this.transformTransaction(tx, userAddress);
      if (processedTx) {
        transactions.push(processedTx);
      }
    }

    logger.debug(
      `Successfully processed Solana RPC address transactions - Address: ${maskAddress(userAddress)}, ProcessedTransactionCount: ${transactions.length}, FilteredOut: ${rawData.normal.length - transactions.length}`
    );

    return transactions;
  }

  static processTokenTransactions(
    rawData: SolanaRPCRawTransactionData,
    userAddress: string,
    contractAddress?: string
  ): UniversalBlockchainTransaction[] {
    logger.debug(
      `Processing Solana RPC token transactions - Address: ${maskAddress(userAddress)}, ContractAddress: ${contractAddress ? maskAddress(contractAddress) : 'All'}, RawTransactionCount: ${rawData.normal.length}`
    );

    const tokenTransactions: UniversalBlockchainTransaction[] = [];

    for (const tx of rawData.normal) {
      const tokenTx = this.extractTokenTransaction(tx, userAddress, contractAddress);
      if (tokenTx) {
        tokenTransactions.push(tokenTx);
      }
    }

    logger.debug(
      `Successfully processed Solana RPC token transactions - Address: ${maskAddress(userAddress)}, TokenTransactionCount: ${tokenTransactions.length}`
    );

    return tokenTransactions;
  }

  private static transformTransaction(
    tx: SolanaRPCTransaction,
    userAddress: string
  ): UniversalBlockchainTransaction | null {
    try {
      // Skip failed transactions - they shouldn't be processed
      if (tx.meta.err) {
        logger.debug(
          `Skipping failed transaction - Hash: ${tx.transaction.signatures?.[0]}, Error: ${JSON.stringify(tx.meta.err)}`
        );
        return null;
      }

      const accountKeys = tx.transaction.message.accountKeys;
      const userIndex = accountKeys.findIndex(key => key === userAddress);

      if (userIndex === -1) {
        logger.debug(`Transaction not relevant to user - Signature: ${tx.transaction.signatures?.[0]}`);
        return null;
      }

      // Calculate balance change
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

      // Don't skip fee-only transactions - the base class will properly classify them as 'fee' type

      return {
        amount: amount.toString(),
        blockHeight: tx.slot,
        currency: 'SOL',
        feeAmount: fee.toString(),
        feeCurrency: 'SOL',
        from: accountKeys?.[0] || '',
        id: tx.transaction.signatures?.[0] || '',
        providerId: 'solana-rpc',
        status: tx.meta.err ? 'failed' : 'success',
        timestamp: (tx.blockTime || 0) * 1000,
        to: '',
        type,
      };
    } catch (error) {
      logger.warn(
        `Failed to transform transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  protected transformValidated(
    rawData: SolanaRPCRawTransactionData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    if (!sessionContext.address) {
      return err('No address found in session context');
    }

    if (!rawData.normal || rawData.normal.length === 0) {
      throw new Error('No transactions to transform from SolanaRPCRawTransactionData');
    }

    const transactions: UniversalBlockchainTransaction[] = [];

    // Process ALL transactions in the batch, not just the first one
    for (const tx of rawData.normal) {
      const processedTx = SolanaRPCProcessor.transformTransaction(tx, sessionContext.address);

      if (!processedTx) {
        // Transaction filtered out - continue with next
        continue;
      }

      transactions.push(processedTx);
    }

    return ok(transactions);
  }
}
