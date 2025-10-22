/**
 * Types exported from schemas for single source of truth
 */
export type {
  BalanceDiscrepancy,
  BalanceVerification,
  DataImportParams,
  DataSourceStatus,
  SourceParams,
  SourceType,
  VerificationMetadata,
} from '../schemas/data-source.ts';

import type { DataImportParams, DataSourceStatus, SourceType, VerificationMetadata } from '../schemas/data-source.ts';

/**
 * Rich session metadata providing blockchain-specific address context
 */
export interface ImportSessionMetadata {
  address?: string | undefined;
  csvDirectories?: string[] | undefined;
  derivedAddresses?: string[] | undefined;
  importedAt?: number | undefined;
  importParams?: DataImportParams | undefined;
  [key: string]: unknown;
}

/**
 * Domain model for data source sessions
 * Represents an import session with parsed JSON fields and camelCase naming
 */
export interface DataSource {
  id: number;
  sourceId: string;
  sourceType: SourceType;
  status: DataSourceStatus;
  startedAt: Date;
  completedAt?: Date | undefined;
  createdAt: Date;
  updatedAt?: Date | undefined;
  durationMs?: number | undefined;
  errorMessage?: string | undefined;
  errorDetails?: unknown;
  importParams: DataImportParams;
  importResultMetadata: Record<string, unknown>;
  lastBalanceCheckAt?: Date | undefined;
  verificationMetadata?: VerificationMetadata | undefined;
}
