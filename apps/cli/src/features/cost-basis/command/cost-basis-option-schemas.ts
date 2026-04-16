import { z } from 'zod';

import { validateAccountingMethodJurisdictionOptions } from '../../shared/option-schema-primitives.js';

export const CostBasisScopeOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);

export const CostBasisCommandOptionsSchema = CostBasisScopeOptionsSchema.extend({
  asset: z.string().optional(),
  refresh: z.boolean().optional(),
  json: z.boolean().optional(),
});

export const CostBasisExportCommandOptionsSchema = CostBasisScopeOptionsSchema.extend({
  asset: z.string().optional(),
  refresh: z.boolean().optional(),
  json: z.boolean().optional(),
  format: z.literal('tax-package').optional(),
  output: z.string().optional(),
});
