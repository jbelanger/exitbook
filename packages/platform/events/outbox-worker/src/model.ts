import { Schema } from 'effect';

// Event metadata schema
export const EventMetadataSchema = Schema.Struct({
  causationId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  timestamp: Schema.Date,
  userId: Schema.optional(Schema.String),
});

export type EventMetadata = Schema.Schema.Type<typeof EventMetadataSchema>;
