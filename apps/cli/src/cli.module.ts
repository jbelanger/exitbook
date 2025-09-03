import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { DatabaseModule } from '@exitbook/database';
// import { LedgerModule } from '@exitbook/ledger';
// import { ImportModule } from '@exitbook/import';
// import { ProvidersModule } from '@exitbook/providers';
// import { SharedModule } from '@exitbook/shared';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // DatabaseModule,
    // LedgerModule,
    // ImportModule,
    // ProvidersModule.forRootAsync({
    //   imports: [SharedModule],
    //   useFactory: (config) => config.providers,
    //   inject: ['TYPED_CONFIG'],
    // }),
  ],
  providers: [
    // Command services will be added here
  ],
})
export class CliModule {}