import { z } from 'zod';

export function pickLatestDate(...dates: (Date | undefined)[]): Date | undefined {
  let latest: Date | undefined;
  for (const date of dates) {
    if (date && (!latest || date > latest)) {
      latest = date;
    }
  }
  return latest;
}

// Date schema - accepts Unix timestamp (number), ISO 8601 string, or Date instance, transforms to Date
// Used for parsing from DB (timestamps/strings) or validating in-memory objects (Date instances)
export const DateSchema = z
  .union([
    z.number().int().positive(),
    z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date string' }),
    z.date(),
  ])
  .transform((val) => {
    if (typeof val === 'number') {
      return new Date(val);
    }
    if (typeof val === 'string') {
      return new Date(val);
    }
    return val;
  });
