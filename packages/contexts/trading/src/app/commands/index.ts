// Re-export the fixed classify-transaction handler
export { classifyTransaction } from './classify-transaction.handler.js';

// Re-export tags from their proper ports
export { TransactionRepositoryTag } from '../../ports/transaction-repository.port.js';
export { TransactionClassifierTag } from '../../ports/transaction-classifier.port.js';

// TODO: Fix and re-export other handlers following the same pattern
// export { importTransaction } from './import-transaction.handler.js';
// export { recordEntries } from './record-entries.handler.js';
