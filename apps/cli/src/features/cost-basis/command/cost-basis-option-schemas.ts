import { z } from 'zod';

import { validateAccountingMethodJurisdictionOptions } from '../../shared/option-schema-primitives.js';

export const CostBasisCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    asset: z.string().optional(),
    refresh: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);

export const CostBasisExportCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    asset: z.string().optional(),
    refresh: z.boolean().optional(),
    json: z.boolean().optional(),
    format: z.literal('tax-package').optional(),
    output: z.string().optional(),
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);
