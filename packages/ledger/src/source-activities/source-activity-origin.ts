import { z } from 'zod';

import type { LedgerEnumDocumentation } from '../internal/enum-documentation.js';

export const SourceActivityOriginValues = ['provider_event', 'balance_snapshot', 'manual_accounting_entry'] as const;

export const SourceActivityOriginSchema = z.enum(SourceActivityOriginValues);

export type SourceActivityOrigin = z.infer<typeof SourceActivityOriginSchema>;

export const SourceActivityOriginDocs = {
  provider_event: {
    consumerEffects: 'Can be bound to raw transactions and provider lineage.',
    emitWhen: 'A processor materializes ledger journals from imported provider data.',
    meaning: 'Source activity originated from provider/imported event data.',
    notConfusedWith: 'balance_snapshot or manual_accounting_entry, which have no provider transaction identity.',
  },
  balance_snapshot: {
    consumerEffects: 'Creates auditable opening-balance provenance without raw transaction lineage.',
    emitWhen: 'A live balance/state snapshot establishes positions because prior history is incomplete.',
    meaning: 'Source activity originated from a balance/state snapshot.',
    notConfusedWith: 'provider_event; it must not fake a blockchain transaction hash.',
  },
  manual_accounting_entry: {
    consumerEffects: 'Requires user/accounting review and explicit provenance before consumers rely on it.',
    emitWhen: 'A user or accountant supplies a ledger entry not derived from provider history.',
    meaning: 'Source activity originated from a deliberate manual accounting input.',
    notConfusedWith: 'provider_event or balance_snapshot.',
  },
} satisfies Record<SourceActivityOrigin, LedgerEnumDocumentation>;
