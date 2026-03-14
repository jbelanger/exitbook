import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { ProjectionStatus } from '@exitbook/core';
import type { Result } from '@exitbook/core';

/**
 * All data needed to run a cost basis calculation.
 */
export interface CostBasisContext {
  /** All transactions (full history needed for lot pool) */
  transactions: UniversalTransactionData[];
  /** Confirmed transaction links for transfer detection */
  confirmedLinks: TransactionLink[];
}

export interface CostBasisProjectionWatermark {
  status: ProjectionStatus | 'missing';
  lastBuiltAt?: Date | undefined;
}

export interface CostBasisDependencyWatermark {
  links: CostBasisProjectionWatermark;
  assetReview: CostBasisProjectionWatermark;
  pricesMutationVersion: number;
  exclusionFingerprint: string;
}

export type CostBasisArtifactKind = 'generic' | 'canada';

export interface CostBasisSnapshotRecord {
  scopeKey: string;
  snapshotId: string;
  storageSchemaVersion: number;
  calculationEngineVersion: number;
  artifactKind: CostBasisArtifactKind;
  linksBuiltAt: Date;
  assetReviewBuiltAt: Date;
  pricesMutationVersion: number;
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

export interface ICostBasisDependencyWatermarkReader {
  readCurrentWatermark(exclusionFingerprint: string): Promise<Result<CostBasisDependencyWatermark, Error>>;
}
