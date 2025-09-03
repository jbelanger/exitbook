// Ledger transaction entity placeholder
export interface LedgerTransactionEntity {
  id: number;
  externalId: string;
  source: string;
  description: string;
  transactionDate: Date;
  createdAt: Date;
}

export interface LedgerEntryEntity {
  id: number;
  transactionId: number;
  accountId: number;
  currencyId: number;
  amount: bigint;
  direction: 'CREDIT' | 'DEBIT';
  entryType: string;
  createdAt: Date;
}