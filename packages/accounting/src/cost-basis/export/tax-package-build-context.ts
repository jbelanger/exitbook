import type { Account, TransactionLink, Transaction } from '@exitbook/core';

import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

export interface TaxPackageArtifactRef {
  calculationId: string;
  scopeKey: string;
  snapshotId?: string | undefined;
}

export interface TaxPackageSourceContext {
  transactionsById: Map<number, Transaction>;
  accountsById: Map<number, Account>;
  confirmedLinksById: Map<number, TransactionLink>;
}

export interface TaxPackageBuildContext {
  artifactRef: TaxPackageArtifactRef;
  workflowResult: CostBasisWorkflowResult;
  sourceContext: TaxPackageSourceContext;
}
