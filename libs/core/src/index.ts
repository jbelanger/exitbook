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

// Types and validation (keeping existing patterns)
export * from './types';
export * from './validation';

// Module export
export { CoreModule } from './core.module';
