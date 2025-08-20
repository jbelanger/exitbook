import type { EnhancedTransaction } from '@crypto/core';
import type { StoredTransaction } from '../types/data-types.js';
import { getLogger } from '@crypto/shared-logger';
import { TransactionRepository } from '../repositories/transaction-repository.ts';
import { WalletRepository } from '../repositories/wallet-repository.ts';
import { TransactionLinkingService } from './transaction-linking-service.ts';

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
}