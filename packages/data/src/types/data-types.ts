// Database schema types for data persistence
import type { Selectable, Insertable, Updateable } from 'kysely';

import type { TransactionsTable } from '../schema/database-schema.ts';

// Transaction types using Kysely schema
export type StoredTransaction = Selectable<TransactionsTable>;
export type NewTransaction = Insertable<TransactionsTable>;
export type TransactionUpdate = Updateable<TransactionsTable>;

export interface StoredRawData<TRawData = unknown> {
  createdAt: number;
  id: number;
  importSessionId?: number | undefined;
  metadata?: unknown;
  processedAt?: number | undefined;
  processingError?: string | undefined;
  processingStatus: string;
  providerId?: string | undefined;
  rawData: TRawData;
  sourceId: string;
  sourceType: string;
}

// Wallet address tracking types
export interface WalletAddress {
  address: string;
  addressType: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain: string;
  createdAt: number;
  id: number;
  isActive: boolean;
  label?: string | undefined;
  notes?: string | undefined;
  updatedAt: number;
}

export interface CreateWalletAddressRequest {
  address: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain: string;
  label?: string;
  notes?: string;
}

export interface UpdateWalletAddressRequest {
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive?: boolean | undefined;
  label?: string | undefined;
  notes?: string | undefined;
}

export interface WalletAddressQuery {
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain?: string;
  isActive?: boolean | undefined;
  search?: string | undefined; // Search in address, label, or notes
}

// Import session tracking types
export interface ImportSession {
  completedAt?: number | undefined;
  createdAt: number;
  durationMs?: number | undefined;
  errorDetails?: unknown;
  errorMessage?: string | undefined;
  id: number;
  providerId?: string | undefined;
  sessionMetadata?: unknown;
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
  startedAt: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  transactionsFailed: number;
  transactionsImported: number;
  updatedAt: number;
}

export interface CreateImportSessionRequest {
  providerId?: string | undefined;
  sessionMetadata?: unknown;
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
}

export interface UpdateImportSessionRequest {
  errorDetails?: unknown;
  errorMessage?: string | undefined;
  sessionMetadata?: unknown;
  status?: 'started' | 'completed' | 'failed' | 'cancelled';
  transactionsFailed?: number;
  transactionsImported?: number;
}

export interface ImportSessionQuery {
  limit?: number | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
  sourceType?: 'exchange' | 'blockchain';
  status?: 'started' | 'completed' | 'failed' | 'cancelled';
}

export interface ImportSessionWithRawData {
  rawDataItems: StoredRawData[];
  session: ImportSession;
}
