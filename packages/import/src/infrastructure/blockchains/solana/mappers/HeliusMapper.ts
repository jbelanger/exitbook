import { getLogger } from '@crypto/shared-logger';
import { hasStringProperty, isErrorWithMessage, maskAddress } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { SolanaRawTransactionData } from '../clients/HeliusApiClient.js';
import { SolanaRawTransactionDataSchema } from '../schemas.js';
import type { HeliusTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

@RegisterTransactionMapper('helius')
export class HeliusTransactionMapper extends BaseRawDataMapper<SolanaRawTransactionData> {
  // Known Solana token mint addresses to symbols mapping
  private static readonly KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
    BvkjtktEZyjix9rSKEiA3ftMU1UCS61XEERFxtMqN1zd: 'MOBILE',
    hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux: 'HNT',
    rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: 'RENDER',
    // Add more known tokens as needed
  };
  private static logger = getLogger('HeliusProcessor');

  static processAddressTransactions(
    rawData: SolanaRawTransactionData,
    userAddress: string
  ): UniversalBlockchainTransaction[] {
    const transactions: UniversalBlockchainTransaction[] = [];

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

  /**
   * Detect staking operations by examining transaction instructions
   */
  private static detectStakingOperation(tx: HeliusTransaction): 'delegate' | 'undelegate' | undefined {
    try {
      // Solana Stake Program ID
      const STAKE_PROGRAM_ID = '11111111111111111111111111111112';

      // Look for staking-related instructions
      const instructions = tx.transaction.message.instructions || [];

      for (const instruction of instructions) {
        if (typeof instruction === 'object' && instruction !== null && 'programIdIndex' in instruction) {
          const programId = tx.transaction.message.accountKeys[instruction.programIdIndex as number];

          // Check if this is a stake program instruction
          if (programId === STAKE_PROGRAM_ID) {
            // Decode instruction data to determine operation type
            // This is simplified - in a full implementation, you'd decode the instruction data
            // For now, we can infer from balance changes and context
            return 'delegate'; // Could be delegate or undelegate
          }
        }
      }

      return undefined;
    } catch (error) {
      this.logger.debug(`Failed to detect staking operation: ${String(error)}`);
      return undefined;
    }
  }

  private static extractTokenTransaction(
    tx: HeliusTransaction,
    userAddress: string
  ): UniversalBlockchainTransaction | undefined {
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
          (pre) => pre.accountIndex === postBalance.accountIndex && pre.mint === postBalance.mint
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

        // Get proper token symbol from known mappings
        const tokenSymbol = this.getTokenSymbolFromMint(postBalance.mint);

        return {
          amount: Math.abs(change).toString(),
          blockHeight: tx.slot,
          currency: tokenSymbol,
          feeAmount: lamportsToSol(tx.meta.fee).toString(),
          feeCurrency: 'SOL',
          from: type === 'transfer_out' ? userAddress : '',
          id: tx.transaction.signatures?.[0] || tx.signature,
          providerId: 'helius',
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: (tx.blockTime || 0) * 1000,
          to: type === 'transfer_in' ? userAddress : '',
          tokenAddress: postBalance.mint,
          tokenSymbol,
          type: 'token_transfer',
        };
      }

      return undefined;
    } catch (error) {
      this.logger.debug(
        `Failed to extract token transaction - Signature: ${tx.transaction.signatures?.[0] || tx.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  private static getTokenSymbolFromMint(mintAddress: string): string {
    return this.KNOWN_TOKEN_SYMBOLS[mintAddress] || `${mintAddress.slice(0, 6)}...`;
  }

  private static transformTransaction(
    tx: HeliusTransaction,
    userAddress: string
  ): UniversalBlockchainTransaction | undefined {
    try {
      // Skip failed transactions - they shouldn't be processed
      if (tx.meta.err) {
        this.logger.debug(
          `Skipping failed transaction - Hash: ${tx.transaction.signatures?.[0] || tx.signature}, Error: ${JSON.stringify(tx.meta.err)}`
        );
        return undefined;
      }

      const accountKeys = tx.transaction.message.accountKeys;
      const userIndex = accountKeys.findIndex((key) => key === userAddress);

      // First check for token transfers - these are more important than SOL transfers
      const tokenTransaction = this.extractTokenTransaction(tx, userAddress);
      if (tokenTransaction) {
        return tokenTransaction;
      }

      // Check for staking operations
      const stakingOperation = this.detectStakingOperation(tx);

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

        // Determine transaction type - prioritize staking operations
        let type: 'transfer_in' | 'transfer_out' | 'delegate' | 'undelegate' =
          balanceChange > 0 ? 'transfer_in' : 'transfer_out';

        if (stakingOperation) {
          // Use detected staking operation, but infer delegate vs undelegate from balance change
          type = balanceChange < 0 ? 'delegate' : 'undelegate';
          this.logger.debug(
            `Detected staking operation - Hash: ${tx.transaction.signatures?.[0] || tx.signature}, Type: ${type}, BalanceChange: ${balanceChange}`
          );
        }

        const fee = lamportsToSol(tx.meta.fee);

        // Log transaction details for investigation
        this.logger.debug(
          `Processing SOL transaction - Hash: ${tx.transaction.signatures?.[0] || tx.signature}, PreBalance: ${preBalance}, PostBalance: ${postBalance}, RawChange: ${rawBalanceChange}, FeeAdjustment: ${feeAdjustment}, FinalBalanceChange: ${balanceChange}, Amount: ${amount.toNumber()}, Fee: ${fee.toNumber()}`
        );

        // For fee-only transactions (balance change is 0), still create a transaction
        // The base class mapTransactionType will properly classify it as 'fee' type
        const isFeeOnlyTransaction = Math.abs(balanceChange) === 0 && fee.toNumber() > 0;

        if (isFeeOnlyTransaction) {
          this.logger.debug(
            `Processing fee-only transaction - Hash: ${tx.transaction.signatures?.[0] || tx.signature}, Amount: ${amount.toNumber()}, Fee: ${fee.toNumber()}`
          );

          return {
            amount: fee.toString(),
            blockHeight: tx.slot,
            currency: 'SOL',
            feeAmount: fee.toString(),
            feeCurrency: 'SOL',
            from: userAddress,
            id: tx.transaction.signatures?.[0] || tx.signature,
            providerId: 'helius',
            status: 'success',
            timestamp: (tx.blockTime || 0) * 1000,
            to: '',
            type: 'transfer_out',
          };
        }

        return {
          amount: amount.toString(),
          blockHeight: tx.slot,
          currency: 'SOL',
          feeAmount: fee.toString(),
          feeCurrency: 'SOL',
          from: type === 'transfer_out' || type === 'delegate' ? userAddress : accountKeys?.[0] || '',
          id: tx.transaction.signatures?.[0] || tx.signature,
          providerId: 'helius',
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: (tx.blockTime || 0) * 1000,
          to: type === 'transfer_in' || type === 'undelegate' ? userAddress : '',
          type,
        };
      }

      this.logger.debug(
        `Transaction not relevant to user - Signature: ${tx.transaction.signatures?.[0] || tx.signature}`
      );
      return undefined;
    } catch (error) {
      this.logger.warn(
        `Failed to transform transaction - Signature: ${tx.transaction.signatures?.[0] || tx.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }
  protected readonly schema = SolanaRawTransactionDataSchema;
  protected mapInternal(
    rawData: SolanaRawTransactionData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    if (!sessionContext.address) {
      return err('No address found in session context');
    }

    if (!rawData.normal || rawData.normal.length === 0) {
      return err('No transactions to transform from SolanaRawTransactionData');
    }

    const transactions: UniversalBlockchainTransaction[] = [];

    // Process ALL transactions in the batch, not just the first one
    for (const tx of rawData.normal) {
      const processedTx = HeliusTransactionMapper.transformTransaction(tx, sessionContext.address);

      if (processedTx) {
        transactions.push(processedTx);
      }
    }

    return ok(transactions);
  }
}
