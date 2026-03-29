import { assertErr } from '@exitbook/foundation/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('better-sqlite3');
});

describe('createSqliteDatabase', () => {
  it('adds rebuild guidance when better-sqlite3 targets another platform', async () => {
    vi.resetModules();
    vi.doMock('better-sqlite3', () => ({
      default: class MockDatabase {
        constructor() {
          throw new Error(
            "dlopen(/tmp/better_sqlite3.node, 0x0001): tried: '/tmp/better_sqlite3.node' (slice is not valid mach-o file)"
          );
        }
      },
    }));

    const { createSqliteDatabase } = await import('../database.js');

    const error = assertErr(createSqliteDatabase<Record<string, never>>('/tmp/transactions.db'));

    expect(error.message).toContain('Failed to load better-sqlite3 native module');
    expect(error.message).toContain('pnpm rebuild better-sqlite3');
    expect(error.message).toContain('different OS, CPU architecture, or runtime');
  });
});
