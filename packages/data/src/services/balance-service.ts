import type {
  BalanceSnapshot,
  BalanceVerificationRecord,
} from "@crypto/balance";
import { getLogger } from "@crypto/shared-logger";
import { BalanceRepository } from "../repositories/balance-repository.ts";
import { BalanceCalculationService } from "./balance-calculation-service.ts";

export class BalanceService {
  private logger = getLogger("BalanceService");
  private balanceRepository: BalanceRepository;
  private balanceCalculationService: BalanceCalculationService;

  constructor(balanceRepository: BalanceRepository) {
    this.balanceRepository = balanceRepository;
    this.balanceCalculationService = new BalanceCalculationService();
  }

  async calculateBalances(exchange: string): Promise<Record<string, number>> {
    const transactions =
      await this.balanceRepository.getTransactionsForCalculation(exchange);
    return this.balanceCalculationService.calculateExchangeBalances(
      transactions,
    );
  }

  async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    return this.balanceRepository.saveSnapshot(snapshot);
  }

  async saveVerification(
    verification: BalanceVerificationRecord,
  ): Promise<void> {
    return this.balanceRepository.saveVerification(verification);
  }

  async getLatestVerifications(
    exchange?: string,
  ): Promise<BalanceVerificationRecord[]> {
    return this.balanceRepository.getLatestVerifications(exchange);
  }
}
