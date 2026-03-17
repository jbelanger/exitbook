import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/core';

import type { ICostBasisContextReader } from '../../ports/cost-basis-persistence.js';
import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';
import type { JurisdictionConfig } from '../model/types.js';
import type { CostBasisInput } from '../workflow/cost-basis-input.js';
import type { CostBasisWorkflowExecutionOptions, CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import type { IJurisdictionRules } from './jurisdiction-rules.js';

export interface RunCostBasisJurisdictionWorkflowInput {
  params: CostBasisInput;
  transactions: Transaction[];
  store: ICostBasisContextReader;
  fxRateProvider?: IFxRateProvider | undefined;
  options: CostBasisWorkflowExecutionOptions;
}

export type CostBasisJurisdictionWorkflow =
  | {
      kind: 'standard';
      lookaheadDays: number;
    }
  | {
      kind: 'specialized';
      lookaheadDays: number;
      run(input: RunCostBasisJurisdictionWorkflowInput): Promise<Result<CostBasisWorkflowResult, Error>>;
    };

export interface ICostBasisJurisdictionModule {
  code: CostBasisInput['config']['jurisdiction'];
  config: JurisdictionConfig;
  createRules(): Result<IJurisdictionRules, Error>;
  workflow: CostBasisJurisdictionWorkflow;
}
