import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { currencies } from '../schema';

type DrizzleDB = NodePgDatabase<Record<string, unknown>>;

@Injectable()
export class CurrencySeederService {
  private readonly logger = new Logger(CurrencySeederService.name);

  constructor(@Inject('DATABASE_CONNECTION') private db: DrizzleDB) {}

  async seedDefaultCurrencies(): Promise<void> {
    this.logger.log('Starting currency seeding process...');

    const defaultCurrencies = [
      { assetClass: 'CRYPTO' as const, decimals: 8, isNative: true, name: 'Bitcoin', ticker: 'BTC' },
      {
        assetClass: 'CRYPTO' as const,
        decimals: 18,
        isNative: true,
        name: 'Ethereum',
        network: 'ethereum',
        ticker: 'ETH',
      },
      {
        assetClass: 'CRYPTO' as const,
        contractAddress: '0xA0b86a33E6441e0fD4f5f6aF08e6E56fF29b4c3D',
        decimals: 6,
        name: 'USD Coin',
        network: 'ethereum',
        ticker: 'USDC',
      },
      { assetClass: 'CRYPTO' as const, decimals: 9, isNative: true, name: 'Solana', network: 'solana', ticker: 'SOL' },
      { assetClass: 'FIAT' as const, decimals: 2, isNative: true, name: 'US Dollar', ticker: 'USD' },
    ];

    let seededCount = 0;
    for (const currency of defaultCurrencies) {
      try {
        const result = await this.db
          .insert(currencies)
          .values(currency)
          .onConflictDoNothing({ target: currencies.ticker })
          .returning({ ticker: currencies.ticker });

        if (result.length > 0) {
          seededCount++;
          this.logger.debug(`Seeded currency: ${currency.ticker}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to seed currency ${currency.ticker}: ${error.message}`);
      }
    }

    this.logger.log(
      `Currency seeding completed. New currencies added: ${seededCount}, Total currencies: ${defaultCurrencies.length}`
    );
  }

  async validateCurrencySeeding(): Promise<boolean> {
    const expectedCurrencies = ['BTC', 'ETH', 'USDC', 'SOL', 'USD'];

    try {
      const existingCurrencies = await this.db
        .select({ ticker: currencies.ticker })
        .from(currencies)
        .where(sql`${currencies.ticker} = ANY(${expectedCurrencies})`);

      const existingTickers = existingCurrencies.map(c => c.ticker);
      const missingCurrencies = expectedCurrencies.filter(ticker => !existingTickers.includes(ticker));

      if (missingCurrencies.length > 0) {
        this.logger.error(`Missing required currencies: ${missingCurrencies.join(', ')}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Currency validation failed: ${error.message}`);
      return false;
    }
  }
}
