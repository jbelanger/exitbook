// Handler for view sessions command

import type { DataSource } from '@exitbook/core';
import type { DataSourceRepository } from '@exitbook/ingestion';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { ViewSessionsParams, ViewSessionsResult } from './sessions-view-utils.ts';

/**
 * Handler for viewing import sessions.
 */
export class ViewSessionsHandler {
  constructor(private readonly dataSourceRepo: DataSourceRepository) {}

  /**
   * Execute the view sessions command.
   */
  async execute(params: ViewSessionsParams): Promise<Result<ViewSessionsResult, Error>> {
    // Fetch sessions from repository
    const dataSourcesResult = await this.dataSourceRepo.findAll({
      sourceId: params.source,
      status: params.status,
      limit: params.limit,
    });

    if (dataSourcesResult.isErr()) {
      return err(dataSourcesResult.error);
    }

    const sessions = dataSourcesResult.value;

    // Build result
    const result: ViewSessionsResult = {
      sessions: sessions.map((s) => this.formatSession(s)),
      count: sessions.length,
    };

    return ok(result);
  }

  destroy(): void {
    // No cleanup needed
  }

  /**
   * Format session for display.
   */
  private formatSession(session: DataSource) {
    return {
      id: session.id,
      source_id: session.sourceId,
      source_type: session.sourceType,
      status: session.status,
      started_at: session.startedAt.toISOString(),
      completed_at: session.completedAt?.toISOString() ?? undefined,
      duration_ms: session.durationMs ?? undefined,
      error_message: session.errorMessage ?? undefined,
    };
  }
}
