// Utilities and types for view sessions command

import type { SourceType } from '@exitbook/core';

import type { CommonViewFilters } from '../shared/view-utils.js';

/**
 * Parameters for view sessions command.
 */
export interface ViewSessionsParams extends CommonViewFilters {
  status?: 'started' | 'completed' | 'failed' | 'cancelled' | undefined;
}

/**
 * Session info for display.
 */
export interface SessionInfo {
  id: number;
  source_id: string;
  source_type: SourceType;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at: string | undefined;
  duration_ms: number | undefined;
  error_message: string | undefined;
}

/**
 * Result of view sessions command.
 */
export interface ViewSessionsResult {
  sessions: SessionInfo[];
  count: number;
}

/**
 * Get status icon for session.
 */
export function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'started':
      return '⏳';
    case 'cancelled':
      return '⊘';
    default:
      return '•';
  }
}

/**
 * Format a single session for text display.
 */
export function formatSessionForDisplay(session: SessionInfo): string {
  const statusIcon = getStatusIcon(session.status);
  const lines: string[] = [];

  lines.push(`${statusIcon} Session #${session.id} - ${session.source_id} (${session.source_type})`);
  lines.push(`   Status: ${session.status}`);
  lines.push(`   Started: ${session.started_at}`);

  if (session.completed_at) {
    lines.push(`   Completed: ${session.completed_at}`);
  }

  if (session.duration_ms !== undefined) {
    const durationSec = (session.duration_ms / 1000).toFixed(2);
    lines.push(`   Duration: ${durationSec}s`);
  }

  if (session.error_message) {
    lines.push(`   Error: ${session.error_message}`);
  }

  return lines.join('\n');
}

/**
 * Format sessions list for text display.
 */
export function formatSessionsListForDisplay(sessions: SessionInfo[], count: number): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Import Sessions:');
  lines.push('=============================');
  lines.push('');

  if (sessions.length === 0) {
    lines.push('No sessions found.');
  } else {
    for (const session of sessions) {
      lines.push(formatSessionForDisplay(session));
      lines.push('');
    }
  }

  lines.push('=============================');
  lines.push(`Total: ${count} sessions`);

  return lines.join('\n');
}
