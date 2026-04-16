import type { CostBasisPresentationModel } from '../view/cost-basis-view-utils.js';

export type CostBasisCommandResult = CostBasisPresentationModel['context'] & {
  assets: CostBasisPresentationModel['assetItems'];
  issueNotices: CostBasisPresentationModel['issueNotices'];
  summary: CostBasisPresentationModel['summary'];
};

export function buildCostBasisJsonData(presentation: CostBasisPresentationModel): CostBasisCommandResult {
  return {
    calculationId: presentation.context.calculationId,
    method: presentation.context.method,
    jurisdiction: presentation.context.jurisdiction,
    taxYear: presentation.context.taxYear,
    currency: presentation.context.currency,
    dateRange: presentation.context.dateRange,
    issueNotices: presentation.issueNotices,
    summary: presentation.summary,
    assets: presentation.assetItems,
  };
}
