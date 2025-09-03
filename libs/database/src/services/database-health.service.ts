import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { accounts, currencies, ledgerTransactions } from '../schema';
import { CurrencySeederService } from './currency-seeder.service';

type DrizzleDB = NodePgDatabase<Record<string, unknown>>;

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    private currencySeeder: CurrencySeederService
  ) {}

  async getHealthMetrics(): Promise<{
    currenciesSeeded: boolean;
    databaseConnected: boolean;
    totalAccounts: number;
    totalCurrencies: number;
    totalTransactions: number;
  }> {
    try {
      const [currencyCount] = await this.db.select({ count: sql<number>`count(*)` }).from(currencies);
      const [accountCount] = await this.db.select({ count: sql<number>`count(*)` }).from(accounts);
      const [transactionCount] = await this.db.select({ count: sql<number>`count(*)` }).from(ledgerTransactions);

      return {
        currenciesSeeded: currencyCount.count >= 5, // BTC, ETH, USDC, SOL, USD
        databaseConnected: true,
        totalAccounts: accountCount.count,
        totalCurrencies: currencyCount.count,
        totalTransactions: transactionCount.count,
      };
    } catch (error) {
      return {
        currenciesSeeded: false,
        databaseConnected: false,
        totalAccounts: 0,
        totalCurrencies: 0,
        totalTransactions: 0,
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test database connectivity
      await this.db
        .select({ count: sql<number>`count(*)` })
        .from(currencies)
        .limit(1);

      // Validate currency seeding completed
      const seedingValid = await this.currencySeeder.validateCurrencySeeding();
      if (!seedingValid) {
        this.logger.error('Currency seeding validation failed');
        return false;
      }

      // Test account/currency relationship integrity
      const relationshipTest = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(accounts)
        .innerJoin(currencies, eq(accounts.currencyId, currencies.id))
        .limit(1);

      this.logger.log('Database health check passed');
      return true;
    } catch (error) {
      this.logger.error(`Database health check failed: ${error.message}`);
      return false;
    }
  }
}
