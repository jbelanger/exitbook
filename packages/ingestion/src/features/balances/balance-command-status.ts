import { z } from 'zod';

export const BalanceCommandStatusSchema = z.enum(['success', 'warning', 'failed']);

export type BalanceCommandStatus = z.infer<typeof BalanceCommandStatusSchema>;
