import { ProtocolRefSchema } from '@exitbook/protocol-catalog';
import { z } from 'zod';

import {
  ANNOTATION_KINDS,
  ANNOTATION_PROVENANCE_INPUTS,
  ANNOTATION_ROLES,
  ANNOTATION_TIERS,
} from './annotation-types.js';

export const AnnotationKindSchema = z.enum(ANNOTATION_KINDS);
export const AnnotationTierSchema = z.enum(ANNOTATION_TIERS);
export const AnnotationRoleSchema = z.enum(ANNOTATION_ROLES);
export const AnnotationProvenanceInputSchema = z.enum(ANNOTATION_PROVENANCE_INPUTS);

export const AnnotationTargetSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('transaction') }).strict(),
  z
    .object({
      scope: z.literal('movement'),
      movementFingerprint: z.string().min(1),
    })
    .strict(),
]);

export const TransactionAnnotationSchema = z
  .object({
    annotationFingerprint: z.string().min(1),
    accountId: z.number().int().positive(),
    transactionId: z.number().int().positive(),
    txFingerprint: z.string().min(1),
    kind: AnnotationKindSchema,
    tier: AnnotationTierSchema,
    target: AnnotationTargetSchema,
    protocolRef: ProtocolRefSchema.optional(),
    role: AnnotationRoleSchema.optional(),
    groupKey: z.string().min(1).optional(),
    detectorId: z.string().min(1),
    derivedFromTxIds: z.array(z.number().int().positive()).min(1).readonly(),
    provenanceInputs: z.array(AnnotationProvenanceInputSchema).readonly(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
