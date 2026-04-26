import { AssetIdSchema, PriceAtTxTimeSchema } from '@exitbook/core';
import { CurrencySchema, DecimalSchema } from '@exitbook/foundation';
import { z } from 'zod';

import { SourceComponentQuantityRefSchema } from '../source-components/source-component-ref.js';

import { AccountingBalanceCategorySchema } from './balance-category.js';
import { AccountingPostingRoleSchema } from './posting-role.js';
import { AccountingSettlementSchema } from './settlement.js';

export const AccountingPostingDraftSchema = z.object({
  postingStableKey: z.string().min(1, 'Posting stable key must not be empty'),
  assetId: AssetIdSchema,
  assetSymbol: CurrencySchema,
  quantity: DecimalSchema,
  role: AccountingPostingRoleSchema,
  balanceCategory: AccountingBalanceCategorySchema,
  settlement: AccountingSettlementSchema.optional(),
  priceAtTxTime: PriceAtTxTimeSchema.optional(),
  sourceComponentRefs: z
    .array(SourceComponentQuantityRefSchema)
    .min(1, 'Posting must have at least one source component'),
});

export type AccountingPostingDraft = z.infer<typeof AccountingPostingDraftSchema>;

export interface IdentifiedAccountingPostingDraft extends AccountingPostingDraft {
  postingFingerprint: string;
}
