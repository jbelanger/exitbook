import { z } from 'zod';

export const AccountingSettlementSchema = z.enum(['on-chain', 'balance', 'external']);

export type AccountingSettlement = z.infer<typeof AccountingSettlementSchema>;
