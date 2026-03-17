import type { Account, TransactionLink, Transaction } from '@exitbook/core';
import type { ProjectionStatus } from '@exitbook/core';
import type { Result } from '@exitbook/core';

/**
 * All data needed to run a cost basis calculation.
 */
export interface CostBasisContext {
  /** All transactions (full history needed for lot pool) */
  transactions: Transaction[];
  /** Confirmed transaction links for transfer detection */
  confirmedLinks: TransactionLink[];
  /** Accounts needed for source labeling and export rejoin context */
  accounts: Account[];
}

export interface CostBasisProjectionWatermark {
  status: ProjectionStatus | 'missing';
  lastBuiltAt?: Date | undefined;
}

export interface CostBasisDependencyWatermark {
  links: CostBasisProjectionWatermark;
  assetReview: CostBasisProjectionWatermark;
  pricesLastMutatedAt?: Date | undefined;
  exclusionFingerprint: string;
}

export type CostBasisArtifactKind = 'standard' | 'canada';
export type CostBasisFailureConsumer = 'cost-basis' | 'portfolio';

export interface CostBasisSnapshotRecord {
  scopeKey: string;
  snapshotId: string;
  storageSchemaVersion: number;
  calculationEngineVersion: number;
  artifactKind: CostBasisArtifactKind;
  linksBuiltAt: Date;
  assetReviewBuiltAt: Date;
  pricesLastMutatedAt?: Date | undefined;
  exclusionFingerprint: string;
  calculationId: string;
  jurisdiction: string;
  method: string;
  taxYear: number;
  displayCurrency: string;
  startDate: string;
  endDate: string;
  artifactJson: string;
  debugJson: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CostBasisFailureSnapshotRecord {
  scopeKey: string;
  consumer: CostBasisFailureConsumer;
  snapshotId: string;
  linksStatus: CostBasisProjectionWatermark['status'];
  linksBuiltAt?: Date | undefined;
  assetReviewStatus: CostBasisProjectionWatermark['status'];
  assetReviewBuiltAt?: Date | undefined;
  pricesLastMutatedAt?: Date | undefined;
  exclusionFingerprint: string;
  jurisdiction: string;
  method: string;
  taxYear: number;
  displayCurrency: string;
  startDate: string;
  endDate: string;
  errorName: string;
  errorMessage: string;
  errorStack?: string | undefined;
  debugJson: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Port for cost basis calculation persistence.
 *
 * Domain-shaped: loads the full context in one call rather than
 * exposing separate findAllTransactions() + findConfirmedLinks().
 */
export interface ICostBasisContextReader {
  /** Load all data needed for cost basis calculation */
  loadCostBasisContext(): Promise<Result<CostBasisContext, Error>>;
}

export interface ICostBasisArtifactStore {
  findLatest(scopeKey: string): Promise<Result<CostBasisSnapshotRecord | undefined, Error>>;
  replaceLatest(snapshot: CostBasisSnapshotRecord): Promise<Result<void, Error>>;
}

export interface ICostBasisFailureSnapshotStore {
  replaceLatest(snapshot: CostBasisFailureSnapshotRecord): Promise<Result<void, Error>>;
}

export interface ICostBasisDependencyWatermarkReader {
  readCurrentWatermark(exclusionFingerprint: string): Promise<Result<CostBasisDependencyWatermark, Error>>;
}
