import type { BlockchainTransaction, UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney, maskAddress } from '@crypto/shared-utils';
import { type Result, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { SolanaRPCRawTransactionData } from '../clients/SolanaRPCApiClient.ts';
import { SolanaRPCRawTransactionDataSchema } from '../schemas.ts';
import type { SolanaRPCTransaction } from '../types.ts';
import { lamportsToSol } from '../utils.ts';

const logger = getLogger('SolanaRPCProcessor');

@RegisterProcessor('solana-rpc')
export class SolanaRPCProcessor extends BaseProviderProcessor<SolanaRPCRawTransactionData> {
  protected readonly schema = SolanaRPCRawTransactionDataSchema;
  private static extractTokenTransaction(
    tx: SolanaRPCTransaction,
    userAddress: string,
    targetContract?: string
  ): BlockchainTransaction | null {
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
          blockHash: '',
          blockNumber: tx.slot,
          confirmations: 1,
          fee: createMoney(lamportsToSol(tx.meta.fee).toNumber(), 'SOL'),
          from: type === 'transfer_out' ? userAddress : '',
          gasPrice: undefined,
          gasUsed: undefined,
          hash: tx.transaction.signatures?.[0] || '',
          nonce: undefined,
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: (tx.blockTime || 0) * 1000,
          to: type === 'transfer_in' ? userAddress : '',
          tokenContract: postBalance.mint,
          tokenSymbol: postBalance.uiTokenAmount.uiAmountString?.includes('.') ? 'UNKNOWN' : 'UNKNOWN',
          type: 'token_transfer',
          value: createMoney(Math.abs(change), 'UNKNOWN'), // Will be updated with proper symbol later
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
  ): BlockchainTransaction[] {
    logger.debug(
      `Processing Solana RPC address transactions - Address: ${maskAddress(userAddress)}, RawTransactionCount: ${rawData.normal.length}`
    );

    const transactions: BlockchainTransaction[] = [];

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
  ): BlockchainTransaction[] {
    logger.debug(
      `Processing Solana RPC token transactions - Address: ${maskAddress(userAddress)}, ContractAddress: ${contractAddress ? maskAddress(contractAddress) : 'All'}, RawTransactionCount: ${rawData.normal.length}`
    );

    const tokenTransactions: BlockchainTransaction[] = [];

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

  private static transformTransaction(tx: SolanaRPCTransaction, userAddress: string): BlockchainTransaction | null {
    try {
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

      // Skip transactions with no meaningful amount (pure fee transactions)
      if (amount.toNumber() <= fee.toNumber() && amount.toNumber() < 0.000001) {
        logger.debug(
          `Skipping fee-only transaction - Hash: ${tx.transaction.signatures?.[0]}, Amount: ${amount.toNumber()}, Fee: ${fee.toNumber()}`
        );
        return null;
      }

      return {
        blockHash: '',
        blockNumber: tx.slot,
        confirmations: 1,
        fee: createMoney(fee.toNumber(), 'SOL'),
        from: accountKeys?.[0] || '',
        gasPrice: undefined,
        gasUsed: undefined,
        hash: tx.transaction.signatures?.[0] || '',
        nonce: undefined,
        status: tx.meta.err ? 'failed' : 'success',
        timestamp: (tx.blockTime || 0) * 1000,
        to: '',
        tokenContract: undefined,
        tokenSymbol: 'SOL',
        type,
        value: createMoney(amount.toNumber(), 'SOL'),
      };
    } catch (error) {
      logger.warn(
        `Failed to transform transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  // IProviderProcessor interface implementation
  protected transformValidated(
    rawData: SolanaRPCRawTransactionData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalTransaction, string> {
    // Extract addresses from rich session context
    const addresses = sessionContext.addresses || [];
    const userAddress = addresses[0] || '';

    if (!rawData.normal || rawData.normal.length === 0) {
      throw new Error('No transactions to transform from SolanaRPCRawTransactionData');
    }

    const tx = rawData.normal[0];
    const processedTx = SolanaRPCProcessor.transformTransaction(tx, userAddress);

    if (!processedTx) {
      throw new Error('Unable to transform SolanaRPC transaction to UniversalTransaction');
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

    return ok({
      amount: processedTx.value,
      datetime: new Date(processedTx.timestamp).toISOString(),
      fee: processedTx.fee,
      from: processedTx.from,
      id: processedTx.hash,
      metadata: {
        blockchain: 'solana',
        blockNumber: processedTx.blockNumber,
        providerId: 'solana-rpc',
        rawData: tx,
      },
      source: 'solana',
      status: processedTx.status === 'success' ? 'ok' : 'failed',
      symbol: processedTx.tokenSymbol || 'SOL',
      timestamp: processedTx.timestamp,
      to: processedTx.to,
      type,
    });
  }
}
