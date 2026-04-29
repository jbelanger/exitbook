import { z } from 'zod';

import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { OptionalBareAccountSelectorSchema } from '../../accounts/account-selector.js';

export const EvmFamilyLedgerStressCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(
  JsonFlagSchema.shape
).extend({
  chains: z.string().trim().min(1).optional(),
  expectedDiffs: z.string().trim().min(1).optional(),
});

export const NearLedgerStressCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(
  JsonFlagSchema.shape
).extend({
  expectedDiffs: z.string().trim().min(1).optional(),
});

export const SolanaLedgerStressCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(
  JsonFlagSchema.shape
).extend({
  expectedDiffs: z.string().trim().min(1).optional(),
});

export const XrpLedgerStressCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(
  JsonFlagSchema.shape
).extend({
  expectedDiffs: z.string().trim().min(1).optional(),
});

export const LedgerLinkingV2RunCommandOptionsSchema = JsonFlagSchema.extend({
  dryRun: z.boolean().optional(),
});

export const LedgerLinkingV2AssetIdentityListCommandOptionsSchema = JsonFlagSchema;

export const LedgerLinkingV2AssetIdentityAcceptCommandOptionsSchema = JsonFlagSchema.extend({
  assetIdA: z.string().trim().min(1, 'Asset id A must not be empty'),
  assetIdB: z.string().trim().min(1, 'Asset id B must not be empty'),
  evidenceKind: z.enum(['manual', 'seeded', 'exact_hash_observed']).default('manual'),
  relationshipKind: z
    .enum(['internal_transfer', 'external_transfer', 'same_hash_carryover', 'bridge', 'asset_migration'])
    .default('internal_transfer'),
});
