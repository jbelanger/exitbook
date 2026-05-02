import { resultDo, type Result } from '@exitbook/foundation';

import type { CostBasisLedgerFacts } from '../../../ports/cost-basis-ledger-persistence.js';
import {
  projectLedgerCostBasisEvents,
  type LedgerCostBasisEventProjection,
  type ProjectLedgerCostBasisEventsOptions,
} from '../../ledger/ledger-cost-basis-event-projection.js';
import {
  buildLedgerCostBasisOperations,
  type LedgerCostBasisOperationIdentityConfig,
  type LedgerCostBasisOperationProjection,
} from '../../ledger/ledger-cost-basis-operation-projection.js';
import type { CostBasisConfig } from '../../model/cost-basis-config.js';
import { getStrategyForMethod } from '../strategies/strategy-factory.js';

import {
  runStandardLedgerOperationEngine,
  type StandardLedgerOperationEngineResult,
} from './standard-ledger-operation-engine.js';

export interface RunStandardLedgerOperationPipelineInput {
  calculationId: string;
  excludedAssetIds?: ProjectLedgerCostBasisEventsOptions['excludedAssetIds'] | undefined;
  identityConfig?: LedgerCostBasisOperationIdentityConfig | undefined;
  ledgerFacts: CostBasisLedgerFacts;
  method: CostBasisConfig['method'];
}

export interface StandardLedgerOperationPipelineResult {
  engineResult: StandardLedgerOperationEngineResult;
  eventProjection: LedgerCostBasisEventProjection;
  operationProjection: LedgerCostBasisOperationProjection;
}

export function runStandardLedgerOperationPipeline(
  input: RunStandardLedgerOperationPipelineInput
): Result<StandardLedgerOperationPipelineResult, Error> {
  return resultDo(function* () {
    const eventProjection = yield* projectLedgerCostBasisEvents(input.ledgerFacts, {
      excludedAssetIds: input.excludedAssetIds,
    });
    const operationProjection = yield* buildLedgerCostBasisOperations({
      projection: eventProjection,
      identityConfig: input.identityConfig,
    });
    const strategy = yield* getStrategyForMethod(input.method);
    const engineResult = yield* runStandardLedgerOperationEngine({
      calculationId: input.calculationId,
      operationProjection,
      strategy,
    });

    return {
      engineResult,
      eventProjection,
      operationProjection,
    };
  });
}
