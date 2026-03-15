import { z } from 'zod';

export const DecimalStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const IsoDateTimeStringSchema = z.string().datetime({ offset: true });

export const StoredCostBasisExecutionMetaSchema = z.object({
  missingPricesCount: z.number().int().nonnegative(),
  retainedTransactionIds: z.array(z.number().int().positive()),
});

export interface CostBasisArtifactDebugPayload {
  kind: 'standard-workflow' | 'canada-workflow';
  scopedTransactionIds: number[];
  appliedConfirmedLinkIds: number[];
  acquisitionEventIds?: string[] | undefined;
  dispositionEventIds?: string[] | undefined;
  transferIds?: string[] | undefined;
  superficialLossAdjustmentIds?: string[] | undefined;
}
