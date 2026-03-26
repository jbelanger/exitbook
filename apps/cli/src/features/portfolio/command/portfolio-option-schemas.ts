import { z } from 'zod';

import {
  ProfileFlagSchema,
  validateAccountingMethodJurisdictionOptions,
} from '../../shared/option-schema-primitives.js';

export const PortfolioCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    fiatCurrency: z.string().optional(),
    asOf: z.string().optional(),
    json: z.boolean().optional(),
    profile: ProfileFlagSchema.shape.profile,
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);
