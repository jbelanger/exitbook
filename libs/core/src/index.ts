// Core domain aggregates and value objects
export * from './aggregates/account/account.aggregate';
export * from './aggregates/account/account.errors';
export * from './aggregates/transaction/ledger-transaction.aggregate';
export * from './aggregates/transaction/transaction.errors';
export * from './aggregates/transaction/entry.entity';
export * from './aggregates/transaction/entry.errors';
export * from './aggregates/user/user.aggregate';
export * from './aggregates/user/user.errors';
export * from './value-objects/money/money.vo';
export * from './value-objects/money/money.errors';

// Domain errors
export * from './errors';

// Repository interfaces (Dependency Inversion)
export * from './repositories/transaction.repository.interface';
export * from './repositories/account.repository.interface';
export * from './repositories/user.repository.interface';

// Domain services
export * from './services/balance-calculator.service';
export * from './services/transaction-validator.service';

// Types and validation (keeping existing patterns)
export * from './types';
export * from './validation';

// Module export
export { CoreModule } from './core.module';
