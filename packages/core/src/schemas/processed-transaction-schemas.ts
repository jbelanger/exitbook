import { z } from 'zod';

// Primitive type schemas
export const IsoTimestampSchema = z.string().datetime({
  message: 'Must be a valid ISO-8601 UTC timestamp',
});

export const DecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, 'Max 18 decimals, no leading zeros')
  .refine((v) => v !== '0', 'Amount must be > 0');

export const ExternalIdSchema = z.string().min(1, 'External ID must not be empty');

export const MovementIdSchema = z.string().min(1, 'Movement ID must not be empty');

export const MovementDirectionSchema = z.enum(['IN', 'OUT']);

export const MovementPurposeSchema = z.enum(['PRINCIPAL', 'FEE', 'GAS']);

export const MovementHintSchema = z.enum(['FEE', 'GAS']);

// Money Value Object Schema
export const MoneySchema2 = z.object({
  amount: DecimalStringSchema,
  currency: z.string().min(1, 'Currency required'),
});

// Source Details Schema (discriminated union)
export const SourceDetailsSchema = z.discriminatedUnion('kind', [
  z.object({
    externalId: ExternalIdSchema,
    importSessionId: z.string().min(1, 'Import session ID required'),
    kind: z.literal('exchange'),
    venue: z.string().min(1, 'Venue required'),
  }),
  z.object({
    chain: z.string().min(1, 'Chain required'),
    importSessionId: z.string().min(1, 'Import session ID required'),
    kind: z.literal('blockchain'),
    txHash: z.string().min(1, 'Transaction hash required'),
  }),
]);

// MovementUnclassified Schema
export const MovementUnclassifiedSchema = z.object({
  direction: MovementDirectionSchema,
  hint: MovementHintSchema.optional(),
  id: MovementIdSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  money: MoneySchema2,
  sequence: z.number().int().min(0, 'Sequence must be non-negative').optional(),
});

// ClassificationInfo Schema
export const ClassificationInfoSchema = z.object({
  classifiedAt: IsoTimestampSchema,
  confidence: z.number().min(0).max(1, 'Confidence must be between 0 and 1'),
  purpose: MovementPurposeSchema,
  reason: z.string().min(1, 'Reason required'),
  ruleId: z.string().min(1, 'Rule ID required'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be valid semver'),
});

// MovementClassified Schema
export const MovementClassifiedSchema = z.object({
  classification: ClassificationInfoSchema,
  direction: MovementDirectionSchema,
  id: MovementIdSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  money: MoneySchema2,
  sequence: z.number().int().min(0, 'Sequence must be non-negative').optional(),
});

// ProcessedTransaction Schema
export const ProcessedTransactionSchema = z.object({
  id: ExternalIdSchema,
  movements: z.array(MovementUnclassifiedSchema).min(1, 'At least one movement required'),
  source: SourceDetailsSchema,
  timestamp: IsoTimestampSchema,
});

// ClassifiedTransaction Schema
export const ClassifiedTransactionSchema = z.object({
  id: ExternalIdSchema,
  movements: z.array(MovementClassifiedSchema).min(1, 'At least one movement required'),
  purposeRulesetVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be valid semver'),
  source: SourceDetailsSchema,
  timestamp: IsoTimestampSchema,
});

// Validation Error Schema
export const RepositoryErrorCodeSchema = z.enum(['NOT_FOUND', 'VALIDATION_FAILED', 'CONSTRAINT_VIOLATION']);
