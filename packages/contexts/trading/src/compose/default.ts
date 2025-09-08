import { Layer } from 'effect';

// Import adapters (these would be implemented in adapters/ directory)
// import { TransactionRepositoryLive } from '../adapters/repositories/transaction.repository.live';
// import { TransactionClassifierLive } from '../adapters/services/transaction-classifier.live';

// Production runtime layer composition
// This assembles all the live implementations for production use
export const TradingRuntimeDefault = Layer.empty;

// TODO: Uncomment and implement when adapters are available
// export const TradingRuntimeDefault = Layer.mergeAll(
//   TransactionRepositoryTag.implement(TransactionRepositoryLive),
//   TransactionClassifierTag.implement(TransactionClassifierLive),
//   EventBus.implement(EventBusLive), // Platform EventBus implementation
// );
