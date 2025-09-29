import type { Decimal } from 'decimal.js';

import type { BalanceRepository } from '../../infrastructure/persistence/balance-repository.js';

import { BalanceCalculationService } from './balance-calculation-service.js';

export class BalanceService {
  private balanceCalculationService: BalanceCalculationService;
  private balanceRepository: BalanceRepository;

  constructor(balanceRepository: BalanceRepository) {
    this.balanceRepository = balanceRepository;
    this.balanceCalculationService = new BalanceCalculationService();
  }

  async calculateBalancesForVerification(exchange: string): Promise<Record<string, Decimal>> {
    const transactions = await this.balanceRepository.getTransactionsForCalculation(exchange);
    return this.balanceCalculationService.calculateBalancesForVerification(transactions);
  }
}
