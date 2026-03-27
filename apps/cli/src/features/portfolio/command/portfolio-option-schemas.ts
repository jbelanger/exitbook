import { z } from 'zod';

import { validateAccountingMethodJurisdictionOptions } from '../../shared/option-schema-primitives.js';

export const PortfolioCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    fiatCurrency: z.string().optional(),
    asOf: z.string().optional(),
    json: z.boolean().optional(),
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);
