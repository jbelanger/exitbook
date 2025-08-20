import * as bitcoin from 'bitcoinjs-lib';

import { Balance, BitcoinWalletAddress, BlockchainInfo, BlockchainTransaction, CryptoTransaction, TransactionType } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { BlockchainProviderManager } from '../../providers/index.ts';
import { BitcoinUtils } from '../../utils/bitcoin-utils.ts';
import { BaseBlockchainAdapter } from './index.ts';

export class BitcoinAdapter extends BaseBlockchainAdapter {
  private walletAddresses: BitcoinWalletAddress[] = [];
  protected network: bitcoin.Network;
  private addressInfoCache = new Map<string, { balance: string; txCount: number }>(); // Simplified cache
  private providerManager: BlockchainProviderManager;
  private addressGap: number;

  constructor(options?: { addressGap?: number }) {
    super('bitcoin', 'BitcoinAdapter');

    // Always use mainnet
    this.network = bitcoin.networks.bitcoin;

    // Set address gap for xpub derivation
    this.addressGap = options?.addressGap || 20;

    // Create and initialize provider manager with registry
    this.providerManager = new BlockchainProviderManager();
    this.providerManager.autoRegisterFromConfig('bitcoin', 'mainnet');

    this.logger.info('Initialized Bitcoin adapter with registry-based provider manager', {
      addressGap: this.addressGap,
      providersCount: this.providerManager.getProviders('bitcoin').length
    });
  }



  /**
   * Initialize an xpub wallet using BitcoinUtils
   */
  private async initializeXpubWallet(walletAddress: BitcoinWalletAddress): Promise<void> {
    await BitcoinUtils.initializeXpubWallet(
      walletAddress,
      this.network,
      this.providerManager,
      this.addressGap
    );
  }


  /**
   * Get transactions for a user-provided address (handles xpub derivation transparently)
   */
  async getAddressTransactions(userAddress: string, since?: number): Promise<BlockchainTransaction[]> {
    this.logger.info(`Fetching transactions for address: ${userAddress.substring(0, 20)}...`);

    let wallet: BitcoinWalletAddress;

    // Check if we've already processed this address
    const existingWallet = this.walletAddresses.find(w => w.address === userAddress);
    if (existingWallet) {
      wallet = existingWallet;
    } else {
      // Initialize this specific address (handles both xpub and regular addresses)
      wallet = {
        address: userAddress,
        type: BitcoinUtils.getAddressType(userAddress)
      };

      if (BitcoinUtils.isXpub(userAddress)) {
        this.logger.info(`Processing xpub: ${userAddress.substring(0, 20)}...`);
        await this.initializeXpubWallet(wallet);
      } else {
        this.logger.info(`Processing regular address: ${userAddress}`);
      }

      this.walletAddresses.push(wallet);
    }

    if (wallet.derivedAddresses) {
      // Xpub wallet - fetch from all derived addresses and deduplicate
      this.logger.info(`Fetching from ${wallet.derivedAddresses.length} derived addresses`);

      const allTransactions = await this.fetchUniqueTransactionsForWalletWithProviders(wallet.derivedAddresses, since);
      this.logger.info(`Found ${allTransactions.length} unique transactions for wallet ${userAddress.substring(0, 20)}...`);
      return allTransactions;
    } else {
      // Regular address - use provider manager with raw transactions for wallet-aware parsing
      try {
        const rawTransactions = await this.providerManager.executeWithFailover('bitcoin', {
          type: 'getRawAddressTransactions',
          params: { address: userAddress, since },
          getCacheKey: (params: any) => `bitcoin:raw-txs:${params.address}:${params.since || 'all'}`
        }) as any[];

        // Parse raw transactions with wallet context (single address, local parsing)
        const transactions: BlockchainTransaction[] = [];
        for (const rawTx of rawTransactions) {
          try {
            const blockchainTx = this.parseWalletTransaction(rawTx, [userAddress]);
            transactions.push(blockchainTx);
          } catch (error) {
            this.logger.warn(`Failed to parse transaction ${rawTx.txid}`, { error });
          }
        }

        this.logger.info(`Found ${transactions.length} transactions for wallet ${userAddress.substring(0, 20)}...`);
        return transactions;
      } catch (error) {
        this.logger.error(`Failed to fetch Bitcoin transactions for ${userAddress}`, { error });
        throw error;
      }
    }
  }

  /**
   * Fetch unique raw transactions for an xpub wallet across all derived addresses using provider architecture
   */
  private async fetchUniqueTransactionsForWalletWithProviders(derivedAddresses: string[], since?: number): Promise<BlockchainTransaction[]> {
    // Collect all unique transaction hashes and their associated raw transactions
    const uniqueRawTransactions = new Map<string, any>();

    for (const address of derivedAddresses) {
      // Check cache first to see if this address has any transactions
      const cachedInfo = this.addressInfoCache.get(address);

      // Skip addresses that we know are empty from gap scanning
      if (cachedInfo && cachedInfo.txCount === 0) {
        this.logger.debug(`Skipping address ${address} - no transactions in cache`);
        continue;
      }

      try {
        const rawTransactions = await this.providerManager.executeWithFailover('bitcoin', {
          type: 'getRawAddressTransactions',
          params: { address, since },
          getCacheKey: (params: any) => `bitcoin:raw-txs:${params.address}:${params.since || 'all'}`
        }) as any[];

        // Add raw transactions to the unique set
        for (const rawTx of rawTransactions) {
          uniqueRawTransactions.set(rawTx.txid, rawTx);
        }

        this.logger.debug(`Found ${rawTransactions.length} transactions for address ${address}`);
      } catch (error) {
        this.logger.error(`Failed to fetch raw transactions for address ${address}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }

    this.logger.info(`Found ${uniqueRawTransactions.size} unique raw transactions across all addresses`);

    // Parse each unique transaction with wallet context (local parsing, no API calls)
    const blockchainTransactions: BlockchainTransaction[] = [];
    for (const [txid, rawTx] of uniqueRawTransactions) {
      try {
        const blockchainTx = this.parseWalletTransaction(rawTx, derivedAddresses);
        blockchainTransactions.push(blockchainTx);
      } catch (error) {
        this.logger.warn(`Failed to parse transaction ${txid}`, { error });
      }
    }

    // Sort by timestamp (newest first)
    blockchainTransactions.sort((a, b) => b.timestamp - a.timestamp);

    return blockchainTransactions;
  }

  /**
   * Parse a raw Bitcoin transaction with wallet context (local parsing, no API calls)
   */
  private parseWalletTransaction(tx: any, walletAddresses: string[]): BlockchainTransaction {
    const timestamp = tx.status.confirmed && tx.status.block_time
      ? tx.status.block_time * 1000
      : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs - money going out of our wallet
    for (const input of tx.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        isOutgoing = true;
        if (input.prevout?.value) {
          totalValueChange -= input.prevout.value;
        }
      }
    }

    // Check outputs - money coming into our wallet
    for (const output of tx.vout) {
      if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
        isIncoming = true;
        totalValueChange += output.value;
      }
    }

    // Determine transaction type
    let type: 'transfer_in' | 'transfer_out' | 'internal_transfer_in' | 'internal_transfer_out';

    if (isIncoming && !isOutgoing) {
      type = 'transfer_in';
    } else if (isOutgoing && !isIncoming) {
      type = 'transfer_out';
    } else if (isIncoming && isOutgoing) {
      // Internal transfer within our wallet - treat based on net change
      type = totalValueChange >= 0 ? 'internal_transfer_in' : 'internal_transfer_out';
    } else {
      // Neither incoming nor outgoing (shouldn't happen with proper filtering)
      type = 'transfer_out';
    }

    const totalValue = Math.abs(totalValueChange);
    const fee = isOutgoing ? tx.fee : 0;

    // Determine from/to addresses (first relevant address found)
    let fromAddress = '';
    let toAddress = '';

    // For from address, look for wallet addresses in inputs
    for (const input of tx.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        fromAddress = input.prevout.scriptpubkey_address;
        break;
      }
    }

    // For to address, look for wallet addresses in outputs
    for (const output of tx.vout) {
      if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
        toAddress = output.scriptpubkey_address;
        break;
      }
    }

    // Fallback to first addresses if no wallet addresses found
    if (!fromAddress && tx.vin.length > 0 && tx.vin[0]?.prevout?.scriptpubkey_address) {
      fromAddress = tx.vin[0].prevout.scriptpubkey_address;
    }

    if (!toAddress && tx.vout.length > 0 && tx.vout[0]?.scriptpubkey_address) {
      toAddress = tx.vout[0].scriptpubkey_address;
    }

    return {
      hash: tx.txid,
      blockNumber: tx.status.block_height || 0,
      blockHash: tx.status.block_hash || '',
      timestamp,
      from: fromAddress,
      to: toAddress,
      value: createMoney(totalValue / 100000000, 'BTC'),
      fee: createMoney(fee / 100000000, 'BTC'),
      gasUsed: undefined,
      gasPrice: undefined,
      status: tx.status.confirmed ? 'success' : 'pending',
      type,
      tokenContract: undefined,
      tokenSymbol: 'BTC',
      nonce: undefined,
      confirmations: tx.status.confirmed ? 1 : 0
    };
  }

  async getAddressBalance(address: string): Promise<Balance[]> {
    try {
      const result = await this.providerManager.executeWithFailover('bitcoin', {
        type: 'getAddressBalance',
        params: { address }
      }) as { balance: string; token: string };

      const balanceValue = parseFloat(result.balance);
      const balances: Balance[] = [];

      if (balanceValue > 0) {
        balances.push({
          currency: 'BTC',
          balance: balanceValue,
          used: 0,
          total: balanceValue,
          contractAddress: undefined
        });
      }

      return balances;

    } catch (error) {
      this.logger.error(`Failed to get Bitcoin balance for ${address}`, { error });
      throw error;
    }
  }

  validateAddress(address: string): boolean {
    const legacyPattern = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const segwitPattern = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const bech32Pattern = /^bc1[a-z0-9]{39,59}$/;
    const xpubPattern = /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,108}$/;

    return legacyPattern.test(address) || segwitPattern.test(address) ||
      bech32Pattern.test(address) || xpubPattern.test(address);
  }

  // Bitcoin doesn't support tokens, so optional token methods are not implemented

  async testConnection(): Promise<boolean> {
    try {
      // Test connection through provider manager
      const healthStatus = this.providerManager.getProviderHealth('bitcoin');
      const hasHealthyProvider = Array.from(healthStatus.values()).some(health =>
        health.isHealthy && health.circuitState !== 'OPEN'
      );

      this.logger.info('Bitcoin provider connection test result', {
        hasHealthyProvider,
        totalProviders: healthStatus.size
      });

      return hasHealthyProvider;
    } catch (error) {
      this.logger.error('Bitcoin connection test failed', { error });
      return false;
    }
  }

  /**
   * Close adapter and cleanup resources (required by IBlockchainAdapter)
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info('Bitcoin adapter closed successfully');
    } catch (error) {
      this.logger.warn('Error during Bitcoin adapter close', { error });
    }
  }


  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return {
      id: 'bitcoin',
      name: 'Bitcoin Blockchain',
      network: 'mainnet',
      capabilities: {
        supportsAddressTransactions: true,
        supportsTokenTransactions: false,
        supportsBalanceQueries: true,
        supportsHistoricalData: true,
        supportsPagination: true,
        maxLookbackDays: undefined
      }
    };
  }

  /**
   * Override convertToCryptoTransaction to handle xpub derived addresses properly
   */
  convertToCryptoTransaction(blockchainTx: BlockchainTransaction): CryptoTransaction {
    // Use the Bitcoin adapter's own transaction type classification
    let type: TransactionType;

    if (blockchainTx.type === 'transfer_in' || blockchainTx.type === 'internal_transfer_in') {
      type = 'deposit';
    } else if (blockchainTx.type === 'transfer_out' || blockchainTx.type === 'internal_transfer_out') {
      type = 'withdrawal';
    } else {
      // Fallback - shouldn't happen with proper Bitcoin transaction classification
      type = 'withdrawal';
    }

    return {
      id: blockchainTx.hash,
      type,
      timestamp: blockchainTx.timestamp,
      datetime: new Date(blockchainTx.timestamp).toISOString(),
      symbol: blockchainTx.tokenSymbol || undefined,
      side: undefined,
      amount: blockchainTx.value,
      price: undefined,
      fee: blockchainTx.fee,
      status: blockchainTx.status === 'success' ? 'closed' :
        blockchainTx.status === 'pending' ? 'open' : 'canceled',
      info: {
        blockNumber: blockchainTx.blockNumber,
        blockHash: blockchainTx.blockHash,
        from: blockchainTx.from,
        to: blockchainTx.to,
        confirmations: blockchainTx.confirmations,
        transactionType: blockchainTx.type,
        originalTransaction: blockchainTx
      }
    };
  }

}