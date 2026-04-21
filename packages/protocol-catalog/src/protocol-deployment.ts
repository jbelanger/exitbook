import { z } from 'zod';

export const ProtocolDeploymentSchema = z
  .object({
    chain: z.string().min(1),
    addresses: z.array(z.string().min(1)).readonly().optional(),
  })
  .strict();

export type ProtocolDeployment = z.infer<typeof ProtocolDeploymentSchema>;
