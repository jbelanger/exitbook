import { z } from 'zod';

export interface RawExchangeProcessorInput<TRaw = unknown> {
  raw: TRaw;
  eventId: string;
}

export const RawExchangeProcessorInputSchema = z.object({
  raw: z.unknown(),
  eventId: z.string().min(1, 'Event ID must not be empty'),
});

export function createRawExchangeProcessorInputSchema<TRaw>(
  rawSchema: z.ZodType<TRaw>
): z.ZodType<RawExchangeProcessorInput<TRaw>> {
  return RawExchangeProcessorInputSchema.extend({
    raw: rawSchema,
  }) as z.ZodType<RawExchangeProcessorInput<TRaw>>;
}
