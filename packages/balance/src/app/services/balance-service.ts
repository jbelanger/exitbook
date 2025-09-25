import { getLogger } from '@crypto/shared-logger';
import type { Decimal } from 'decimal.js';

import type { BalanceRepository } from '../../infrastructure/persistence/balance-repository.ts';
import type { BalanceSnapshot, BalanceVerificationRecord } from '../../types/balance-types.ts';

import { BalanceCalculationService } from './balance-calculation-service.ts';

export class BalanceService {
  private balanceCalculationService: BalanceCalculationService;
  private balanceRepository: BalanceRepository;
  private logger = getLogger('BalanceService');

  constructor(balanceRepository: BalanceRepository) {
    this.balanceRepository = balanceRepository;
    this.balanceCalculationService = new BalanceCalculationService();
  }

  async calculateBalances(exchange: string): Promise<Record<string, Decimal>> {
    const transactions = await this.balanceRepository.getTransactionsForCalculation(exchange);
    return this.balanceCalculationService.calculateExchangeBalancesWithPrecision(transactions);
  }

  async calculateBalancesForVerification(exchange: string): Promise<Record<string, Decimal>> {
    const transactions = await this.balanceRepository.getTransactionsForCalculation(exchange);
    return this.balanceCalculationService.calculateExchangeBalancesForVerification(transactions);
  }

  async getLatestVerifications(exchange?: string): Promise<BalanceVerificationRecord[]> {
    return this.balanceRepository.getLatestVerifications(exchange);
  }

  async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    return this.balanceRepository.saveSnapshot(snapshot);
  }

  async saveVerification(verification: BalanceVerificationRecord): Promise<void> {
    return this.balanceRepository.saveVerification(verification);
  }
}
