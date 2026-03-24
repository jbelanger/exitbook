import { err, ok, type Result } from '@exitbook/foundation';

import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import { CANADA_JURISDICTION_CONFIG } from './canada/config.js';
import { CanadaRules } from './canada/rules.js';
import { runCanadaCostBasisCalculation } from './canada/workflow/run-canada-cost-basis-calculation.js';
import { EU_JURISDICTION_CONFIG, UK_JURISDICTION_CONFIG } from './jurisdiction-configs.js';
import type { ICostBasisJurisdictionModule, RunCostBasisJurisdictionWorkflowInput } from './jurisdiction-module.js';
import type { IJurisdictionRules } from './jurisdiction-rules.js';
import { US_JURISDICTION_CONFIG } from './us/config.js';
import { USRules } from './us/rules.js';

async function runCanadaJurisdictionWorkflow(
  input: RunCostBasisJurisdictionWorkflowInput
): Promise<Result<CostBasisWorkflowResult, Error>> {
  if (!input.priceRuntime) {
    return err(new Error('Price provider runtime required for Canada tax valuation'));
  }

  const contextResult = await input.store.loadCostBasisContext();
  if (contextResult.isErr()) {
    return err(contextResult.error);
  }

  return runCanadaCostBasisCalculation({
    input: input.config,
    transactions: input.transactions,
    confirmedLinks: contextResult.value.confirmedLinks,
    priceRuntime: input.priceRuntime,
    accountingExclusionPolicy: input.options.accountingExclusionPolicy,
    assetReviewSummaries: input.options.assetReviewSummaries,
    missingPricePolicy: 'error',
    poolSnapshotStrategy: 'report-end',
  });
}

const COST_BASIS_JURISDICTION_MODULES: Record<string, ICostBasisJurisdictionModule> = {
  US: {
    code: 'US',
    config: US_JURISDICTION_CONFIG,
    createRules: () => ok(new USRules()),
    workflow: {
      kind: 'standard',
      lookaheadDays: 0,
    },
  },
  CA: {
    code: 'CA',
    config: CANADA_JURISDICTION_CONFIG,
    createRules: () => ok(new CanadaRules()),
    workflow: {
      kind: 'specialized',
      lookaheadDays: 30,
      run: runCanadaJurisdictionWorkflow,
    },
  },
  UK: {
    code: 'UK',
    config: UK_JURISDICTION_CONFIG,
    createRules: () => err(new Error('UK jurisdiction rules not yet implemented')),
    workflow: {
      kind: 'standard',
      lookaheadDays: 0,
    },
  },
  EU: {
    code: 'EU',
    config: EU_JURISDICTION_CONFIG,
    createRules: () => err(new Error('EU jurisdiction rules not yet implemented')),
    workflow: {
      kind: 'standard',
      lookaheadDays: 0,
    },
  },
};

export function getCostBasisJurisdictionModule(
  jurisdiction: ICostBasisJurisdictionModule['code']
): Result<ICostBasisJurisdictionModule, Error> {
  const module = COST_BASIS_JURISDICTION_MODULES[jurisdiction];
  if (!module) {
    return err(new Error(`Jurisdiction module ${jurisdiction} is not registered`));
  }

  return ok(module);
}

export function resolveCostBasisJurisdictionRules(
  jurisdiction: ICostBasisJurisdictionModule['code']
): Result<IJurisdictionRules, Error> {
  const moduleResult = getCostBasisJurisdictionModule(jurisdiction);
  if (moduleResult.isErr()) {
    return err(moduleResult.error);
  }

  return moduleResult.value.createRules();
}
