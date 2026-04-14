import type { AssetReviewSummary } from '@exitbook/core';
import { sha256Hex } from '@exitbook/foundation';
import { z } from 'zod';

export const ACCOUNTING_ISSUE_REF_LENGTH = 10;

export const AccountingIssueScopeKindSchema = z.enum(['profile', 'cost-basis']);
export type AccountingIssueScopeKind = z.infer<typeof AccountingIssueScopeKindSchema>;

export const AccountingIssueScopeStatusSchema = z.enum(['ready', 'has-open-issues', 'failed']);
export type AccountingIssueScopeStatus = z.infer<typeof AccountingIssueScopeStatusSchema>;

export const AccountingIssueFamilySchema = z.enum(['transfer_gap', 'asset_review_blocker']);
export type AccountingIssueFamily = z.infer<typeof AccountingIssueFamilySchema>;

export const AccountingIssueSeveritySchema = z.enum(['warning', 'blocked']);
export type AccountingIssueSeverity = z.infer<typeof AccountingIssueSeveritySchema>;

export const AccountingIssueCodeSchema = z.enum(['LINK_GAP', 'ASSET_REVIEW_BLOCKER']);
export type AccountingIssueCode = z.infer<typeof AccountingIssueCodeSchema>;

export const AccountingIssueStatusSchema = z.literal('open');
export type AccountingIssueStatus = z.infer<typeof AccountingIssueStatusSchema>;

export const StoredAccountingIssueRowStatusSchema = z.enum(['open', 'closed']);
export type StoredAccountingIssueRowStatus = z.infer<typeof StoredAccountingIssueRowStatusSchema>;

export const AccountingIssueClosedReasonSchema = z.literal('disappeared');
export type AccountingIssueClosedReason = z.infer<typeof AccountingIssueClosedReasonSchema>;

export const AccountingIssueEvidenceRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('transaction'),
    ref: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('gap'),
    ref: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('asset'),
    selector: z.string().trim().min(1),
  }),
]);
export type AccountingIssueEvidenceRef = z.infer<typeof AccountingIssueEvidenceRefSchema>;

export const AccountingIssueRouteTargetSchema = z.object({
  family: z.enum(['links', 'assets', 'transactions', 'prices']),
  selectorKind: z.enum(['tx-ref', 'gap-ref', 'asset-selector']).optional(),
  selectorValue: z.string().trim().min(1).optional(),
});
export type AccountingIssueRouteTarget = z.infer<typeof AccountingIssueRouteTargetSchema>;

export const AccountingIssueNextActionModeSchema = z.enum(['direct', 'routed', 'review_only']);
export type AccountingIssueNextActionMode = z.infer<typeof AccountingIssueNextActionModeSchema>;

export const AccountingIssueNextActionSchema = z.object({
  kind: z.string().trim().min(1),
  label: z.string().trim().min(1),
  mode: AccountingIssueNextActionModeSchema,
  routeTarget: AccountingIssueRouteTargetSchema.optional(),
});
export type AccountingIssueNextAction = z.infer<typeof AccountingIssueNextActionSchema>;

export const AccountingIssueSummaryItemSchema = z.object({
  issueRef: z.string().trim().min(1),
  family: AccountingIssueFamilySchema,
  code: AccountingIssueCodeSchema,
  severity: AccountingIssueSeveritySchema,
  status: AccountingIssueStatusSchema,
  summary: z.string().trim().min(1),
  nextActions: z.array(AccountingIssueNextActionSchema),
});
export type AccountingIssueSummaryItem = z.infer<typeof AccountingIssueSummaryItemSchema>;

export const AccountingIssueDetailScopeSchema = z.object({
  kind: AccountingIssueScopeKindSchema,
  key: z.string().trim().min(1),
});
export type AccountingIssueDetailScope = z.infer<typeof AccountingIssueDetailScopeSchema>;

export const AccountingIssueStoredDetailPayloadSchema = z.object({
  details: z.string().trim().min(1),
  whyThisMatters: z.string().trim().min(1),
});
export type AccountingIssueStoredDetailPayload = z.infer<typeof AccountingIssueStoredDetailPayloadSchema>;

export const AccountingIssueDetailItemSchema = AccountingIssueSummaryItemSchema.extend({
  scope: AccountingIssueDetailScopeSchema,
  details: z.string().trim().min(1),
  whyThisMatters: z.string().trim().min(1),
  evidenceRefs: z.array(AccountingIssueEvidenceRefSchema),
});
export type AccountingIssueDetailItem = z.infer<typeof AccountingIssueDetailItemSchema>;

export const AccountingIssueScopeSummarySchema = z.object({
  scopeKind: AccountingIssueScopeKindSchema,
  scopeKey: z.string().trim().min(1),
  profileId: z.number().int().positive(),
  title: z.string().trim().min(1),
  status: AccountingIssueScopeStatusSchema,
  openIssueCount: z.number().int().nonnegative(),
  blockingIssueCount: z.number().int().nonnegative(),
  updatedAt: z.date(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AccountingIssueScopeSummary = z.infer<typeof AccountingIssueScopeSummarySchema>;

export interface MaterializedAccountingIssue {
  issueKey: string;
  issue: AccountingIssueDetailItem;
}

export interface AccountingIssueScopeSnapshot {
  scope: AccountingIssueScopeSummary;
  issues: readonly MaterializedAccountingIssue[];
}

export function buildTransferGapIssueKey(issueKey: string): string {
  return `transfer_gap:${issueKey}`;
}

export function buildAssetReviewBlockerIssueKey(
  summary: Pick<AssetReviewSummary, 'assetId' | 'evidenceFingerprint'>
): string {
  return `asset_review_blocker:${summary.assetId}|${summary.evidenceFingerprint}`;
}

export function buildAccountingIssueSelector(scopeKey: string, issueKey: string): string {
  return sha256Hex(`${scopeKey}:${issueKey}`);
}

export function buildAccountingIssueRef(scopeKey: string, issueKey: string): string {
  const selector = buildAccountingIssueSelector(scopeKey, issueKey);
  return selector.length <= ACCOUNTING_ISSUE_REF_LENGTH ? selector : selector.slice(0, ACCOUNTING_ISSUE_REF_LENGTH);
}
