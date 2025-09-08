// Re-export the fixed classify-transaction handler
export {
  classifyTransaction,
  TransactionRepositoryTag,
  TransactionClassifierTag,
} from './classify-transaction.handler.js';

// TODO: Fix and re-export other handlers following the same pattern
// export { importTransaction } from './import-transaction.handler.js';
// export { recordEntries } from './record-entries.handler.js';
