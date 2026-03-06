import type { Account, ImportSession } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

/**
 * Port for raw data processing. Will move to @exitbook/ingestion.
 */
export interface ProcessingStore {
  findAccountById(id: number): Promise<Result<Account | undefined, Error>>;
  findAccounts(filters: { sourceType?: string | undefined }): Promise<Result<Account[], Error>>;
  findImportSessions(filters: { accountId?: number | undefined }): Promise<Result<ImportSession[], Error>>;

  countRawTransactions(filters: {
    accountId?: number | undefined;
    processingStatus?: string | undefined;
  }): Promise<Result<number, Error>>;
  countRawTransactionsByStreamType(accountId: number): Promise<Result<Map<string, number>, Error>>;
  findDistinctRawAccountIds(filters: { processingStatus?: string | undefined }): Promise<Result<number[], Error>>;

  executeProcessingBatch(params: {
    accountId: number;
    consolidatedMovements?: unknown[] | undefined;
    processedRawIds: number[];
    transactions: unknown[];
  }): Promise<Result<{ created: number }, Error>>;
}

export class ProcessingStoreAdapter implements ProcessingStore {
  constructor(private readonly db: DataContext) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  async findAccountById(id: number): Promise<Result<Account | undefined, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  async findAccounts(filters: { sourceType?: string | undefined }): Promise<Result<Account[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  async findImportSessions(filters: { accountId?: number | undefined }): Promise<Result<ImportSession[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  async countRawTransactions(filters: {
    accountId?: number | undefined;
    processingStatus?: string | undefined;
  }): Promise<Result<number, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  async countRawTransactionsByStreamType(accountId: number): Promise<Result<Map<string, number>, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  async findDistinctRawAccountIds(filters: {
    processingStatus?: string | undefined;
  }): Promise<Result<number[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  async executeProcessingBatch(params: {
    accountId: number;
    consolidatedMovements?: unknown[] | undefined;
    processedRawIds: number[];
    transactions: unknown[];
  }): Promise<Result<{ created: number }, Error>> {
    throw new Error('Not implemented');
  }
}
