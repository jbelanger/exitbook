import type { EnhancedTransaction, UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createHash } from 'crypto';

import { TransactionRepository } from '../repositories/transaction-repository.ts';
import { WalletRepository } from '../repositories/wallet-repository.ts';
import type { StoredTransaction } from '../types/data-types.js';
import { TransactionLinkingService } from './transaction-linking-service.ts';

export class TransactionService {
  private logger = getLogger('TransactionService');
  private transactionLinkingService: TransactionLinkingService;
  private transactionRepository: TransactionRepository;

  constructor(transactionRepository: TransactionRepository, walletRepository: WalletRepository) {
    this.transactionRepository = transactionRepository;
    this.transactionLinkingService = new TransactionLinkingService(walletRepository);
  }

  /**
   * Convert UniversalTransaction to EnhancedTransaction format
   */
  private convertUniversalToEnhanced(universalTx: UniversalTransaction): EnhancedTransaction {
    // Create a unique hash for deduplication
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          amount: universalTx.amount,
          id: universalTx.id,
          source: universalTx.source,
          symbol: universalTx.symbol,
          timestamp: universalTx.timestamp,
          type: universalTx.type,
        })
      )
      .digest('hex')
      .slice(0, 16);

    return {
      amount: universalTx.amount,
      datetime: universalTx.datetime,
      fee: universalTx.fee,
      hash,
      id: universalTx.id,
      importedAt: Date.now(),
      info: {
        from: universalTx.from,
        network: universalTx.network,
        source: universalTx.source,
        to: universalTx.to,
        ...universalTx.metadata,
      },
      originalData: universalTx,
      price: universalTx.price,
      side: universalTx.side ?? 'buy',
      source: universalTx.source,
      status: universalTx.status,
      symbol: universalTx.symbol ?? '',
      timestamp: universalTx.timestamp,
      type: universalTx.type,
      verified: false,
    };
  }

  async count(exchange?: string): Promise<number> {
    return this.transactionRepository.count(exchange);
  }

  async findAll(exchange?: string, since?: number): Promise<StoredTransaction[]> {
    return this.transactionRepository.findAll(exchange, since);
  }

  async linkTransactionToWallets(transactionId: string, fromAddress?: string, toAddress?: string): Promise<void> {
    const walletId = await this.transactionLinkingService.findWalletIdForTransaction(fromAddress, toAddress);
    return this.transactionRepository.updateAddresses(transactionId, fromAddress, toAddress, walletId || undefined);
  }

  async save(transaction: EnhancedTransaction): Promise<void> {
    return this.transactionRepository.save(transaction);
  }

  async saveMany(transactions: EnhancedTransaction[]): Promise<number> {
    const saved = await this.transactionRepository.saveMany(transactions);

    if (saved > 0) {
      for (const transaction of transactions) {
        const info = transaction.info as Record<string, unknown> | undefined;
        const fromAddress = typeof info?.from === 'string' ? (info!.from as string) : null;
        const toAddress = typeof info?.to === 'string' ? (info!.to as string) : null;

        if (fromAddress || toAddress) {
          await this.linkTransactionToWallets(transaction.id, fromAddress ?? undefined, toAddress ?? undefined);
        }
      }
    }

    return saved;
  }

  /**
   * Save many UniversalTransactions directly
   */
  async saveManyUniversal(transactions: UniversalTransaction[]): Promise<number> {
    const enhancedTxs = transactions.map(tx => this.convertUniversalToEnhanced(tx));
    const saved = await this.transactionRepository.saveMany(enhancedTxs);

    if (saved > 0) {
      for (const transaction of enhancedTxs) {
        const info = transaction.info as Record<string, unknown> | undefined;
        const fromAddress = typeof info?.from === 'string' ? (info!.from as string) : null;
        const toAddress = typeof info?.to === 'string' ? (info!.to as string) : null;

        if (fromAddress || toAddress) {
          await this.linkTransactionToWallets(transaction.id, fromAddress ?? undefined, toAddress ?? undefined);
        }
      }
    }

    return saved;
  }

  /**
   * Save UniversalTransaction directly without conversion
   */
  async saveUniversal(transaction: UniversalTransaction): Promise<void> {
    const enhancedTx = this.convertUniversalToEnhanced(transaction);
    return this.transactionRepository.save(enhancedTx);
  }
}
