import type { Decimal } from 'decimal.js';

import type { CanadaSuperficialLossAdjustment, CanadaSuperficialLossAdjustmentEvent } from './canada-tax-types.js';

export interface CanadaSuperficialLossDispositionAdjustment {
  deniedLossCad: Decimal;
  deniedQuantity: Decimal;
  dispositionEventId: string;
}

export interface CanadaSuperficialLossEngineResult {
  adjustmentEvents: CanadaSuperficialLossAdjustmentEvent[];
  dispositionAdjustments: CanadaSuperficialLossDispositionAdjustment[];
  superficialLossAdjustments: CanadaSuperficialLossAdjustment[];
}
