import { z } from 'zod';

export interface RawExchangeProcessorInput<TRaw = unknown> {
  raw: TRaw;
  eventId: string;
}

export const RawExchangeProcessorInputSchema = z.object({
  raw: z.unknown(),
  eventId: z.string().min(1, 'Event ID must not be empty'),
});
