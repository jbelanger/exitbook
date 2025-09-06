import { TypedConfigModule } from '@exitbook/shared-config';
import { LoggerModule } from '@exitbook/shared-logger';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

// import { DatabaseModule } from '@exitbook/database';
// import { LedgerModule } from '@exitbook/ledger';
// import { ImportModule } from '@exitbook/import';
// import { ProvidersModule } from '@exitbook/providers';
// import { SharedModule } from '@exitbook/shared';

@Module({
  controllers: [],
  imports: [
    TypedConfigModule,
    LoggerModule.forRoot({
      serviceName: 'exitbook-api',
    }),
    CqrsModule,
    // DatabaseModule,
    // LedgerModule,
    // ImportModule,
    // ProvidersModule.forRootAsync({
    //   imports: [SharedModule],
    //   useFactory: (config) => config.providers,
    //   inject: ['TYPED_CONFIG'],
    // }),
  ],
  providers: [],
})
export class AppModule {}
