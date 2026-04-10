import { z } from 'zod';

import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const LinksBrowseCommandOptionsSchema = z
  .object({
    status: z.enum(['suggested', 'confirmed', 'rejected']).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    maxConfidence: z.number().min(0).max(1).optional(),
    verbose: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.minConfidence !== undefined && data.maxConfidence !== undefined) {
        return data.minConfidence <= data.maxConfidence;
      }
      return true;
    },
    {
      message: 'min-confidence must be less than or equal to max-confidence',
    }
  );

export const LinksGapsBrowseCommandOptionsSchema = JsonFlagSchema;

export const LinksRunCommandOptionsSchema = z
  .object({
    minConfidence: z.number().min(0).max(1).optional(),
    autoConfirmThreshold: z.number().min(0).max(1).optional(),
    json: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.autoConfirmThreshold !== undefined && data.minConfidence !== undefined) {
        return data.autoConfirmThreshold >= data.minConfidence;
      }
      return true;
    },
    {
      message: 'auto-confirm-threshold must be greater than or equal to min-confidence',
    }
  );

export const LinksReviewCommandOptionsSchema = JsonFlagSchema;

export const LinksGapResolutionCommandOptionsSchema = JsonFlagSchema.extend({
  reason: z.string().trim().min(1).optional(),
});
