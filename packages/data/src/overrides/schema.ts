import type { Generated } from '@exitbook/sqlite';

import type { DateTime } from '../database-schema.js';

export interface OverrideEventsTable {
  sequence_id: Generated<number>;
  event_id: string;
  created_at: DateTime;
  actor: string;
  source: string;
  scope: string;
  reason: string | null;
  payload_json: string;
}

export interface OverridesDatabaseSchema {
  override_events: OverrideEventsTable;
}
