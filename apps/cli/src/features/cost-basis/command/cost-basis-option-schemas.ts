import { z } from 'zod';

import {
  ProfileFlagSchema,
  validateAccountingMethodJurisdictionOptions,
} from '../../shared/option-schema-primitives.js';

export const CostBasisCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    asset: z.string().optional(),
    refresh: z.boolean().optional(),
    json: z.boolean().optional(),
    profile: ProfileFlagSchema.shape.profile,
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);

export const CostBasisExportCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    asset: z.string().optional(),
    refresh: z.boolean().optional(),
    json: z.boolean().optional(),
    format: z.literal('tax-package').optional(),
    output: z.string().optional(),
    profile: ProfileFlagSchema.shape.profile,
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);
