import { PlatformKindSchema } from '@exitbook/core';
import { CurrencySchema, DateSchema, DecimalSchema, err, ok, type Result } from '@exitbook/foundation';
import {
  AccountingBalanceCategorySchema,
  AccountingJournalKindSchema,
  AccountingPostingRoleSchema,
} from '@exitbook/ledger';
import { z } from 'zod';

export const LedgerLinkingPostingInputSchema = z.object({
  ownerAccountId: z.number().int().positive(),
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  journalFingerprint: z.string().min(1, 'Journal fingerprint must not be empty'),
  journalKind: AccountingJournalKindSchema,
  postingFingerprint: z.string().min(1, 'Posting fingerprint must not be empty'),
  platformKey: z.string().min(1, 'Platform key must not be empty'),
  platformKind: PlatformKindSchema,
  activityDatetime: DateSchema,
  blockchainTransactionHash: z.string().min(1, 'Blockchain transaction hash must not be empty').optional(),
  fromAddress: z.string().min(1, 'From address must not be empty').optional(),
  toAddress: z.string().min(1, 'To address must not be empty').optional(),
  assetId: z.string().min(1, 'Asset id must not be empty'),
  assetSymbol: CurrencySchema,
  quantity: DecimalSchema,
  role: AccountingPostingRoleSchema,
  balanceCategory: AccountingBalanceCategorySchema,
});

export type LedgerLinkingPostingInput = z.infer<typeof LedgerLinkingPostingInputSchema>;

export interface LedgerTransferLinkingCandidate {
  candidateId: number;
  ownerAccountId: number;
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  postingFingerprint: string;
  direction: 'source' | 'target';
  platformKey: string;
  platformKind: LedgerLinkingPostingInput['platformKind'];
  activityDatetime: Date;
  blockchainTransactionHash: string | undefined;
  fromAddress: string | undefined;
  toAddress: string | undefined;
  assetId: string;
  assetSymbol: LedgerLinkingPostingInput['assetSymbol'];
  amount: LedgerLinkingPostingInput['quantity'];
}

export interface LedgerLinkingCandidateSkip {
  postingFingerprint: string;
  reason: 'non_transfer_journal' | 'non_principal_role' | 'non_liquid_balance_category';
}

export interface LedgerTransferLinkingCandidateBuildResult {
  candidates: LedgerTransferLinkingCandidate[];
  skipped: LedgerLinkingCandidateSkip[];
}

const TRANSFER_CANDIDATE_JOURNAL_KINDS = new Set<LedgerLinkingPostingInput['journalKind']>([
  'transfer',
  'internal_transfer',
]);

export function buildLedgerTransferLinkingCandidates(
  postings: readonly LedgerLinkingPostingInput[]
): Result<LedgerTransferLinkingCandidateBuildResult, Error> {
  const candidates: LedgerTransferLinkingCandidate[] = [];
  const skipped: LedgerLinkingCandidateSkip[] = [];

  for (const posting of postings) {
    const validation = LedgerLinkingPostingInputSchema.safeParse(posting);
    if (!validation.success) {
      return err(new Error(`Invalid ledger-linking posting input: ${validation.error.message}`));
    }
    const validatedPosting = validation.data;

    if (validatedPosting.quantity.isZero()) {
      return err(new Error(`Ledger-linking posting ${validatedPosting.postingFingerprint} has zero quantity`));
    }

    const skipReason = getTransferCandidateSkipReason(validatedPosting);
    if (skipReason !== undefined) {
      skipped.push({ postingFingerprint: validatedPosting.postingFingerprint, reason: skipReason });
      continue;
    }

    candidates.push({
      candidateId: candidates.length + 1,
      ownerAccountId: validatedPosting.ownerAccountId,
      sourceActivityFingerprint: validatedPosting.sourceActivityFingerprint,
      journalFingerprint: validatedPosting.journalFingerprint,
      postingFingerprint: validatedPosting.postingFingerprint,
      direction: validatedPosting.quantity.isNegative() ? 'source' : 'target',
      platformKey: validatedPosting.platformKey,
      platformKind: validatedPosting.platformKind,
      activityDatetime: validatedPosting.activityDatetime,
      blockchainTransactionHash: validatedPosting.blockchainTransactionHash,
      fromAddress: validatedPosting.fromAddress,
      toAddress: validatedPosting.toAddress,
      assetId: validatedPosting.assetId,
      assetSymbol: validatedPosting.assetSymbol,
      amount: validatedPosting.quantity.abs(),
    });
  }

  return ok({ candidates, skipped });
}

function getTransferCandidateSkipReason(
  posting: LedgerLinkingPostingInput
): LedgerLinkingCandidateSkip['reason'] | undefined {
  if (!TRANSFER_CANDIDATE_JOURNAL_KINDS.has(posting.journalKind)) {
    return 'non_transfer_journal';
  }

  if (posting.role !== 'principal') {
    return 'non_principal_role';
  }

  if (posting.balanceCategory !== 'liquid') {
    return 'non_liquid_balance_category';
  }

  return undefined;
}
