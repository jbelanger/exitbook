import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import postgres from 'postgres';

import * as schema from './schema';
import { CurrencySeederService } from './services/currency-seeder.service';
import { DatabaseHealthService } from './services/database-health.service';

@Module({
  exports: ['DATABASE_CONNECTION', DatabaseHealthService, CurrencySeederService],
  imports: [ConfigModule],
  providers: [
    {
      inject: [ConfigService],
      provide: 'DATABASE_CONNECTION',
      useFactory: async (configService: ConfigService) => {
        const databaseUrl =
          configService.get<string>('DATABASE_URL') ||
          'postgresql://crypto_user:crypto_pass@localhost:5432/crypto_tx_import';

        const client = postgres(databaseUrl, {
          max: configService.get<number>('DATABASE_POOL_SIZE', 10),
          ssl:
            configService.get<string>('DATABASE_SSL_MODE', 'disable') !== 'disable'
              ? { rejectUnauthorized: false }
              : false,
        });

        return drizzle(client, { schema });
      },
    },
    CurrencySeederService,
    DatabaseHealthService,
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    private currencySeeder: CurrencySeederService,
    private healthService: DatabaseHealthService
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing database module...');

    try {
      // Ensure currencies are seeded on every application startup
      await this.currencySeeder.seedDefaultCurrencies();

      // Validate database health
      const isHealthy = await this.healthService.isHealthy();
      if (!isHealthy) {
        throw new Error('Database health check failed during startup');
      }

      this.logger.log('Database module initialized successfully');
    } catch (error) {
      this.logger.error(`Database module initialization failed: ${error.message}`);
      throw error;
    }
  }
}
