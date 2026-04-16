import { hashCostBasisStableValue } from './cost-basis-stable-hash.js';

interface CostBasisScopeKeyConfig {
  currency: string;
  endDate?: Date | undefined;
  jurisdiction: string;
  method: string;
  specificLotSelectionStrategy?: string | undefined;
  startDate?: Date | undefined;
  taxYear: number;
}

export function buildCostBasisConfigScopeKey(config: CostBasisScopeKeyConfig): string {
  const stableConfig = {
    currency: config.currency,
    endDate: config.endDate?.toISOString() ?? undefined,
    jurisdiction: config.jurisdiction,
    method: config.method,
    specificLotSelectionStrategy: config.specificLotSelectionStrategy ?? undefined,
    startDate: config.startDate?.toISOString() ?? undefined,
    taxYear: config.taxYear,
  };

  return `cost-basis:${hashCostBasisStableValue(JSON.stringify(stableConfig))}`;
}

export function buildCostBasisScopeKey(profileId: number, config: CostBasisScopeKeyConfig): string {
  return `profile:${profileId}:${buildCostBasisConfigScopeKey(config)}`;
}
