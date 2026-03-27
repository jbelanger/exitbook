import { z } from 'zod';

/**
 * Platform kind taxonomy for processed transactions and related workflows.
 */
export const PlatformKindSchema = z.enum(['blockchain', 'exchange']);

export type PlatformKind = z.infer<typeof PlatformKindSchema>;
