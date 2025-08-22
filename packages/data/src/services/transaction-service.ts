import type { EnhancedTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { TransactionRepository } from '../repositories/transaction-repository.ts';
import { WalletRepository } from '../repositories/wallet-repository.ts';
import type { StoredTransaction } from '../types/data-types.js';
import { TransactionLinkingService } from './transaction-linking-service.ts';
// Add import for UniversalTransaction
import type { Transaction as UniversalTransaction } from '../../../import/src/adapters/universal/types.js';

export class TransactionService {
  private logger = getLogger('TransactionService');
  private transactionRepository: TransactionRepository;
  private transactionLinkingService: TransactionLinkingService;

  constructor(transactionRepository: TransactionRepository, walletRepository: WalletRepository) {
    this.transactionRepository = transactionRepository;
    this.transactionLinkingService = new TransactionLinkingService(walletRepository);
  }

  async save(transaction: EnhancedTransaction): Promise<void> {
    return this.transactionRepository.save(transaction);
  }

  /**
   * Save UniversalTransaction directly without conversion
   */
  async saveUniversal(transaction: UniversalTransaction): Promise<void> {
    const enhancedTx = this.convertUniversalToEnhanced(transaction);
    return this.transactionRepository.save(enhancedTx);
  }

  /**
   * Save many UniversalTransactions directly
   */
  async saveManyUniversal(transactions: UniversalTransaction[]): Promise<number> {
    const enhancedTxs = transactions.map(tx => this.convertUniversalToEnhanced(tx));
    const saved = await this.transactionRepository.saveMany(enhancedTxs);
    
    if (saved > 0) {
      for (const transaction of enhancedTxs) {
        const fromAddress = transaction.info?.from || null;
        const toAddress = transaction.info?.to || null;
        
        if (fromAddress || toAddress) {
          await this.linkTransactionToWallets(transaction.id, fromAddress, toAddress);
        }
      }
    }
    
    return saved;
  }

  async saveMany(transactions: EnhancedTransaction[]): Promise<number> {
    const saved = await this.transactionRepository.saveMany(transactions);
    
    if (saved > 0) {
      for (const transaction of transactions) {
        const fromAddress = transaction.info?.from || null;
        const toAddress = transaction.info?.to || null;
        
        if (fromAddress || toAddress) {
          await this.linkTransactionToWallets(transaction.id, fromAddress, toAddress);
        }
      }
    }
    
    return saved;
  }

  async findAll(exchange?: string, since?: number): Promise<StoredTransaction[]> {
    return this.transactionRepository.findAll(exchange, since);
  }

  async count(exchange?: string): Promise<number> {
    return this.transactionRepository.count(exchange);
  }

  async linkTransactionToWallets(transactionId: string, fromAddress?: string, toAddress?: string): Promise<void> {
    const walletId = await this.transactionLinkingService.findWalletIdForTransaction(fromAddress, toAddress);
    return this.transactionRepository.updateAddresses(transactionId, fromAddress, toAddress, walletId || undefined);
  }

  /**
   * Convert UniversalTransaction to EnhancedTransaction format
   */
  private convertUniversalToEnhanced(universalTx: UniversalTransaction): EnhancedTransaction {
    // Create a unique hash for deduplication
    const hash = require('crypto').createHash('sha256')
      .update(JSON.stringify({
        id: universalTx.id,
        timestamp: universalTx.timestamp,
        symbol: universalTx.symbol,
        amount: universalTx.amount,
        type: universalTx.type,
        source: universalTx.source
      }))
      .digest('hex')
      .slice(0, 16);

    return {
      id: universalTx.id,
      timestamp: universalTx.timestamp,
      datetime: universalTx.datetime,
      type: universalTx.type,
      status: universalTx.status,
      amount: universalTx.amount,
      fee: universalTx.fee,
      price: universalTx.price,
      symbol: universalTx.symbol,
      side: universalTx.metadata?.side,
      source: universalTx.source,
      hash,
      importedAt: Date.now(),
      verified: false,
      info: {
        from: universalTx.from,
        to: universalTx.to,
        source: universalTx.source,
        network: universalTx.network,
        ...universalTx.metadata
      },
      originalData: universalTx
    };
  }
}