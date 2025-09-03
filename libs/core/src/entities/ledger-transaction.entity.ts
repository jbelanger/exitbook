// Ledger transaction entity placeholder
export interface LedgerTransactionEntity {
  createdAt: Date;
  description: string;
  externalId: string;
  id: number;
  source: string;
  transactionDate: Date;
}

export interface LedgerEntryEntity {
  accountId: number;
  amount: bigint;
  createdAt: Date;
  currencyId: number;
  direction: 'CREDIT' | 'DEBIT';
  entryType: string;
  id: number;
  transactionId: number;
}
