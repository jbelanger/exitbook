import { z } from 'zod';

export const ProtocolRefSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1).optional(),
  })
  .strict();

export type ProtocolRef = z.infer<typeof ProtocolRefSchema>;

export function formatProtocolRef(ref: ProtocolRef): string {
  return ref.version === undefined ? ref.id : `${ref.id}@${ref.version}`;
}

export function protocolRefsEqual(a: ProtocolRef, b: ProtocolRef): boolean {
  return a.id === b.id && (a.version ?? '') === (b.version ?? '');
}
