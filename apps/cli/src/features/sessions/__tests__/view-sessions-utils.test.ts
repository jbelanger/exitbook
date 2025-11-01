import { describe, expect, it } from 'vitest';

import type { SessionInfo } from '../sessions-view-utils.ts';
import { getStatusIcon, formatSessionForDisplay, formatSessionsListForDisplay } from '../sessions-view-utils.ts';

describe('view-sessions-utils', () => {
  describe('getStatusIcon', () => {
    it('should return checkmark for completed status', () => {
      expect(getStatusIcon('completed')).toBe('✓');
    });

    it('should return X for failed status', () => {
      expect(getStatusIcon('failed')).toBe('✗');
    });

    it('should return hourglass for started status', () => {
      expect(getStatusIcon('started')).toBe('⏳');
    });

    it('should return circle-slash for cancelled status', () => {
      expect(getStatusIcon('cancelled')).toBe('⊘');
    });

    it('should return bullet point for unknown status', () => {
      expect(getStatusIcon('unknown')).toBe('•');
      expect(getStatusIcon('')).toBe('•');
    });
  });

  describe('formatSessionForDisplay', () => {
    it('should format a complete session with all fields', () => {
      const session: SessionInfo = {
        id: 123,
        source_id: 'kraken',
        source_type: 'exchange',
        status: 'completed',
        started_at: '2024-01-15T10:30:00Z',
        completed_at: '2024-01-15T10:35:00Z',
        duration_ms: 300000,
        error_message: undefined,
      };

      const result = formatSessionForDisplay(session);

      expect(result).toContain('✓ Session #123 - kraken (exchange)');
      expect(result).toContain('Status: completed');
      expect(result).toContain('Started: 2024-01-15T10:30:00Z');
      expect(result).toContain('Completed: 2024-01-15T10:35:00Z');
      expect(result).toContain('Duration: 300.00s');
    });

    it('should format session without optional fields', () => {
      const session: SessionInfo = {
        id: 456,
        source_id: 'bitcoin',
        source_type: 'blockchain',
        status: 'started',
        started_at: '2024-01-15T10:30:00Z',
        completed_at: undefined,
        duration_ms: undefined,
        error_message: undefined,
      };

      const result = formatSessionForDisplay(session);

      expect(result).toContain('⏳ Session #456 - bitcoin (blockchain)');
      expect(result).toContain('Status: started');
      expect(result).toContain('Started: 2024-01-15T10:30:00Z');
      expect(result).not.toContain('Completed:');
      expect(result).not.toContain('Duration:');
      expect(result).not.toContain('Error:');
    });

    it('should format failed session with error message', () => {
      const session: SessionInfo = {
        id: 789,
        source_id: 'ethereum',
        source_type: 'blockchain',
        status: 'failed',
        started_at: '2024-01-15T10:30:00Z',
        completed_at: '2024-01-15T10:31:00Z',
        duration_ms: 60000,
        error_message: 'API rate limit exceeded',
      };

      const result = formatSessionForDisplay(session);

      expect(result).toContain('✗ Session #789 - ethereum (blockchain)');
      expect(result).toContain('Status: failed');
      expect(result).toContain('Error: API rate limit exceeded');
    });

    it('should format duration in seconds with two decimal places', () => {
      const session: SessionInfo = {
        id: 1,
        source_id: 'test',
        source_type: 'exchange',
        status: 'completed',
        started_at: '2024-01-15T10:30:00Z',
        completed_at: '2024-01-15T10:30:01.500Z',
        duration_ms: 1500,
        error_message: undefined,
      };

      const result = formatSessionForDisplay(session);

      expect(result).toContain('Duration: 1.50s');
    });

    it('should handle duration_ms of 0', () => {
      const session: SessionInfo = {
        id: 1,
        source_id: 'test',
        source_type: 'exchange',
        status: 'completed',
        started_at: '2024-01-15T10:30:00Z',
        completed_at: '2024-01-15T10:30:00Z',
        duration_ms: 0,
        error_message: undefined,
      };

      const result = formatSessionForDisplay(session);

      expect(result).toContain('Duration: 0.00s');
    });

    it('should format cancelled session', () => {
      const session: SessionInfo = {
        id: 999,
        source_id: 'test',
        source_type: 'exchange',
        status: 'cancelled',
        started_at: '2024-01-15T10:30:00Z',
        completed_at: undefined,
        duration_ms: undefined,
        error_message: 'User cancelled operation',
      };

      const result = formatSessionForDisplay(session);

      expect(result).toContain('⊘ Session #999 - test (exchange)');
      expect(result).toContain('Status: cancelled');
      expect(result).toContain('Error: User cancelled operation');
    });
  });

  describe('formatSessionsListForDisplay', () => {
    it('should format empty sessions list', () => {
      const result = formatSessionsListForDisplay([], 0);

      expect(result).toContain('Import Sessions:');
      expect(result).toContain('=============================');
      expect(result).toContain('No sessions found.');
      expect(result).toContain('Total: 0 sessions');
    });

    it('should format single session', () => {
      const sessions: SessionInfo[] = [
        {
          id: 1,
          source_id: 'kraken',
          source_type: 'exchange',
          status: 'completed',
          started_at: '2024-01-15T10:30:00Z',
          completed_at: '2024-01-15T10:35:00Z',
          duration_ms: 300000,
          error_message: undefined,
        },
      ];

      const result = formatSessionsListForDisplay(sessions, 1);

      expect(result).toContain('Import Sessions:');
      expect(result).toContain('✓ Session #1 - kraken (exchange)');
      expect(result).toContain('Total: 1 sessions');
    });

    it('should format multiple sessions', () => {
      const sessions: SessionInfo[] = [
        {
          id: 1,
          source_id: 'kraken',
          source_type: 'exchange',
          status: 'completed',
          started_at: '2024-01-15T10:30:00Z',
          completed_at: '2024-01-15T10:35:00Z',
          duration_ms: 300000,
          error_message: undefined,
        },
        {
          id: 2,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          status: 'started',
          started_at: '2024-01-15T10:40:00Z',
          completed_at: undefined,
          duration_ms: undefined,
          error_message: undefined,
        },
        {
          id: 3,
          source_id: 'ethereum',
          source_type: 'blockchain',
          status: 'failed',
          started_at: '2024-01-15T10:50:00Z',
          completed_at: '2024-01-15T10:51:00Z',
          duration_ms: 60000,
          error_message: 'Network error',
        },
      ];

      const result = formatSessionsListForDisplay(sessions, 3);

      expect(result).toContain('✓ Session #1 - kraken (exchange)');
      expect(result).toContain('⏳ Session #2 - bitcoin (blockchain)');
      expect(result).toContain('✗ Session #3 - ethereum (blockchain)');
      expect(result).toContain('Total: 3 sessions');
    });

    it('should show correct total even when displaying fewer sessions', () => {
      const sessions: SessionInfo[] = [
        {
          id: 1,
          source_id: 'kraken',
          source_type: 'exchange',
          status: 'completed',
          started_at: '2024-01-15T10:30:00Z',
          completed_at: '2024-01-15T10:35:00Z',
          duration_ms: 300000,
          error_message: undefined,
        },
      ];

      const result = formatSessionsListForDisplay(sessions, 100);

      expect(result).toContain('✓ Session #1 - kraken (exchange)');
      expect(result).toContain('Total: 100 sessions');
    });

    it('should include blank lines between sessions', () => {
      const sessions: SessionInfo[] = [
        {
          id: 1,
          source_id: 'test1',
          source_type: 'exchange',
          status: 'completed',
          started_at: '2024-01-15T10:30:00Z',
          completed_at: undefined,
          duration_ms: undefined,
          error_message: undefined,
        },
        {
          id: 2,
          source_id: 'test2',
          source_type: 'exchange',
          status: 'completed',
          started_at: '2024-01-15T10:30:00Z',
          completed_at: undefined,
          duration_ms: undefined,
          error_message: undefined,
        },
      ];

      const result = formatSessionsListForDisplay(sessions, 2);
      const lines = result.split('\n');

      const session2Index = lines.findIndex((line) => line.includes('Session #2'));

      expect(lines[session2Index - 1]).toBe('');
    });
  });
});
