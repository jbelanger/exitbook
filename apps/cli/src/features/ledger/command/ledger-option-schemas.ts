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
