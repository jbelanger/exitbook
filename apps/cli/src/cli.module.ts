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
  imports: [
    TypedConfigModule,
    LoggerModule.forRoot({
      serviceName: 'exitbook-cli',
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
  providers: [
    // Command services will be added here
  ],
})
export class CliModule {}
