import { NonPrincipalMovementRoleSchema } from '@exitbook/core';
import { CurrencySchema } from '@exitbook/foundation';
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

export const LinksCreateCommandOptionsSchema = JsonFlagSchema.extend({
  asset: CurrencySchema,
  reason: z.string().trim().min(1).optional(),
});

export const LinksCreateGroupedCommandOptionsSchema = JsonFlagSchema.extend({
  asset: CurrencySchema,
  explainedResidualAmount: z.string().trim().min(1).optional(),
  explainedResidualRole: NonPrincipalMovementRoleSchema.optional(),
  reason: z.string().trim().min(1).optional(),
  source: z.array(z.string().trim().min(1)).min(1),
  target: z.array(z.string().trim().min(1)).min(1),
}).superRefine((data, ctx) => {
  const hasAmount = data.explainedResidualAmount !== undefined;
  const hasRole = data.explainedResidualRole !== undefined;

  if (hasAmount !== hasRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'explained residual amount and role must be provided together',
      path: hasAmount ? ['explainedResidualRole'] : ['explainedResidualAmount'],
    });
  }
});

export const LinksGapResolutionCommandOptionsSchema = JsonFlagSchema.extend({
  reason: z.string().trim().min(1).optional(),
});
