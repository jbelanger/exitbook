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

// Stored event schema for validation
export const StoredEventSchema = Schema.Struct({
  category: Schema.String,
  created_at: Schema.Date,
  event_data: Schema.Unknown,
  event_id: Schema.String,
  event_schema_version: Schema.Number,
  event_type: Schema.String,
  global_position: Schema.optional(Schema.String),
  id: Schema.Number,
  metadata: Schema.Unknown,
  stream_name: Schema.String,
  stream_version: Schema.Number,
});

// Outbox entry schema
export const OutboxEntrySchema = Schema.Struct({
  attempts: Schema.Number,
  category: Schema.String,
  cloudevent: Schema.Unknown,
  created_at: Schema.Date,
  event_id: Schema.String,
  event_position: Schema.BigInt,
  event_schema_version: Schema.Number,
  event_type: Schema.String,
  id: Schema.String,
  last_error: Schema.optional(Schema.String),
  next_attempt_at: Schema.Date,
  processed_at: Schema.optional(Schema.Date),
  status: Schema.Literal('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'),
  stream_name: Schema.String,
  updated_at: Schema.Date,
});

// Helper functions for stream naming
export const parseStreamName = (streamName: string): { category: string; id: string } => {
  const parts = streamName.split('-');
  if (parts.length < 2) {
    throw new Error(`Invalid stream name format: ${streamName}. Expected: category-id`);
  }
  return {
    category: parts[0]!,
    id: parts.slice(1).join('-'),
  };
};

export const makeStreamName = (category: string, id: string): string => `${category}-${id}`;

export const extractCategory = (streamName: string): string => {
  return parseStreamName(streamName).category;
};
