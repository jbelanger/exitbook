import { getLogger } from '@crypto/shared-logger';
import type { Decimal } from 'decimal.js';

import { BalanceCalculationService } from '../app/services/balance-calculation-service.ts';
import type { BalanceRepository } from '../infrastructure/persistence/balance-repository.ts';
import type { BalanceVerificationRecord } from '../types/balance-types.ts';

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

  async saveVerification(verification: BalanceVerificationRecord): Promise<void> {
    return this.balanceRepository.saveVerification(verification);
  }
}
