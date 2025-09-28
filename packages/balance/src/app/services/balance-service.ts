import type { Decimal } from 'decimal.js';

import type { BalanceRepository } from '../../infrastructure/persistence/balance-repository.ts';

import { BalanceCalculationService } from './balance-calculation-service.ts';

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
