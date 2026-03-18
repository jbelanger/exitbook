import { z } from 'zod';

const AssetReviewStatusSchema = z.enum(['clear', 'needs-review', 'reviewed']);

const AssetReferenceStatusSchema = z.enum(['matched', 'unmatched', 'unknown']);

export const AssetReviewEvidenceSchema = z.object({
  kind: z.enum([
    'provider-spam-flag',
    'scam-note',
    'suspicious-airdrop-note',
    'same-symbol-ambiguity',
    'spam-flag',
    'unmatched-reference',
  ]),
  severity: z.enum(['warning', 'error']),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AssetReviewSummarySchema = z.object({
  assetId: z.string().min(1),
  reviewStatus: AssetReviewStatusSchema,
  referenceStatus: AssetReferenceStatusSchema,
  evidenceFingerprint: z.string().min(1),
  confirmationIsStale: z.boolean(),
  accountingBlocked: z.boolean(),
  confirmedEvidenceFingerprint: z.string().min(1).optional(),
  warningSummary: z.string().optional(),
  evidence: z.array(AssetReviewEvidenceSchema),
});

export type AssetReviewStatus = z.infer<typeof AssetReviewStatusSchema>;
export type AssetReferenceStatus = z.infer<typeof AssetReferenceStatusSchema>;
export type AssetReviewEvidence = z.infer<typeof AssetReviewEvidenceSchema>;
export type AssetReviewSummary = z.infer<typeof AssetReviewSummarySchema>;
