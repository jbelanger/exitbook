export type ProjectionId = 'processed-transactions' | 'links';

export type ProjectionStatus = 'fresh' | 'stale' | 'building' | 'failed';

export interface ProjectionDefinition {
  id: ProjectionId;
  dependsOn: ProjectionId[];
  owner: 'ingestion' | 'accounting';
}

export const PROJECTION_DEFINITIONS: ProjectionDefinition[] = [
  { id: 'processed-transactions', dependsOn: [], owner: 'ingestion' },
  { id: 'links', dependsOn: ['processed-transactions'], owner: 'accounting' },
];
