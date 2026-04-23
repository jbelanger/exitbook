import { PlatformKindSchema, TransactionStatusSchema } from '@exitbook/core';
import { z } from 'zod';

export const SourceActivityDraftSchema = z.object({
  accountId: z.number().int().positive('Account id must be a positive integer'),
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  platformKey: z.string().min(1, 'Platform key must not be empty'),
  platformKind: PlatformKindSchema,
  activityStatus: TransactionStatusSchema,
  activityDatetime: z.string().datetime(),
  activityTimestampMs: z.number().int().nonnegative().optional(),
  fromAddress: z.string().min(1, 'From address must not be empty').optional(),
  toAddress: z.string().min(1, 'To address must not be empty').optional(),
  blockchainName: z.string().min(1, 'Blockchain name must not be empty').optional(),
  blockchainBlockHeight: z.number().int().nonnegative().optional(),
  blockchainTransactionHash: z.string().min(1, 'Blockchain transaction hash must not be empty').optional(),
  blockchainIsConfirmed: z.boolean().optional(),
});

export type SourceActivityDraft = z.infer<typeof SourceActivityDraftSchema>;
