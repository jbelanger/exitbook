import { outputSuccess } from '../../shared/json-output.js';
import type { CostBasisPresentationModel } from '../view/cost-basis-view-utils.js';

type CostBasisCommandResult = CostBasisPresentationModel['context'] & {
  assets: CostBasisPresentationModel['assetItems'];
  summary: CostBasisPresentationModel['summary'];
};

export function outputCostBasisJSON(presentation: CostBasisPresentationModel): void {
  const resultData: CostBasisCommandResult = {
    calculationId: presentation.context.calculationId,
    method: presentation.context.method,
    jurisdiction: presentation.context.jurisdiction,
    taxYear: presentation.context.taxYear,
    currency: presentation.context.currency,
    dateRange: presentation.context.dateRange,
    summary: presentation.summary,
    assets: presentation.assetItems,
  };

  outputSuccess('cost-basis', resultData);
}
