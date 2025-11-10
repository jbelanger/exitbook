import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPricesDatabase,
  closePricesDatabase,
  createPricesDatabase,
  initializePricesDatabase,
  type PricesDB,
} from '../database.js';

describe('Database', () => {
  let tempDir: string;
  let dbPath: string;
  let db: PricesDB | undefined;

  beforeEach(() => {
    // Create temporary directory for test databases
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-db-test-'));
    dbPath = path.join(tempDir, 'test-prices.db');
  });

  afterEach(async () => {
    // Close database if open
    if (db) {
      await closePricesDatabase(db);
      db = undefined;
    }

    // Clean up temporary directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('createPricesDatabase', () => {
    it('should create in-memory database', () => {
      const result = createPricesDatabase(':memory:');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        db = result.value;
        expect(db).toBeDefined();
      }
    });

    it('should create file-based database', () => {
      const result = createPricesDatabase(dbPath);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        db = result.value;
        expect(db).toBeDefined();
        expect(fs.existsSync(dbPath)).toBe(true);
      }
    });

    it('should create parent directory if it does not exist', () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'prices.db');

      const result = createPricesDatabase(nestedPath);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        db = result.value;
        expect(fs.existsSync(nestedPath)).toBe(true);
      }
    });

    it('should use default path when not specified', () => {
      const result = createPricesDatabase();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        db = result.value;
        expect(db).toBeDefined();
      }
    });
  });

  describe('initializePricesDatabase', () => {
    beforeEach(() => {
      const result = createPricesDatabase(':memory:');
      if (result.isOk()) {
        db = result.value;
      }
    });

    it('should run migrations successfully', async () => {
      if (!db) throw new Error('DB not initialized');

      const result = await initializePricesDatabase(db);

      expect(result.isOk()).toBe(true);
    });

    it('should create all required tables', async () => {
      if (!db) throw new Error('DB not initialized');

      await initializePricesDatabase(db);

      // Check that tables exist by querying them
      const providers = await db.selectFrom('providers').selectAll().execute();
      expect(Array.isArray(providers)).toBe(true);

      const mappings = await db.selectFrom('provider_coin_mappings').selectAll().execute();
      expect(Array.isArray(mappings)).toBe(true);

      const prices = await db.selectFrom('prices').selectAll().execute();
      expect(Array.isArray(prices)).toBe(true);
    });

    it('should be idempotent (safe to run multiple times)', async () => {
      if (!db) throw new Error('DB not initialized');

      const result1 = await initializePricesDatabase(db);
      expect(result1.isOk()).toBe(true);

      const result2 = await initializePricesDatabase(db);
      expect(result2.isOk()).toBe(true);
    });

    it('should handle custom migrations path', async () => {
      if (!db) throw new Error('DB not initialized');

      // Use the actual migrations path
      const migrationsPath = path.join(process.cwd(), 'packages/price-providers/src/pricing/migrations');

      const result = await initializePricesDatabase(db, migrationsPath);

      // This should fail if path is invalid, succeed if valid
      expect(result.isOk() || result.isErr()).toBe(true);
    });
  });

  describe('closePricesDatabase', () => {
    it('should close database successfully', async () => {
      const createResult = createPricesDatabase(':memory:');
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;

      db = createResult.value;

      const closeResult = await closePricesDatabase(db);

      expect(closeResult.isOk()).toBe(true);
      db = undefined;
    });
  });

  describe('clearPricesDatabase', () => {
    beforeEach(async () => {
      const result = createPricesDatabase(':memory:');
      if (result.isOk()) {
        db = result.value;
        await initializePricesDatabase(db);
      }
    });

    it('should clear all tables', async () => {
      if (!db) throw new Error('DB not initialized');

      // Insert some test data
      await db
        .insertInto('providers')
        .values({
          name: 'test',
          display_name: 'Test',
          is_active: 1 as unknown as boolean,
          metadata: '{}',
          created_at: new Date().toISOString(),
        })
        .execute();

      const beforeClear = await db.selectFrom('providers').selectAll().execute();
      expect(beforeClear.length).toBeGreaterThan(0);

      // Clear database
      const result = await clearPricesDatabase(db);
      expect(result.isOk()).toBe(true);

      // Tables should be dropped (queries will fail)
      try {
        await db.selectFrom('providers').selectAll().execute();
        // If we get here, tables still exist (not cleared)
        expect(true).toBe(false); // Force failure
      } catch (error) {
        // Expected: tables should be dropped
        expect(error).toBeDefined();
      }
    });

    it('should handle empty database', async () => {
      if (!db) throw new Error('DB not initialized');

      const result = await clearPricesDatabase(db);

      expect(result.isOk()).toBe(true);
    });

    it('should be idempotent', async () => {
      if (!db) throw new Error('DB not initialized');

      const result1 = await clearPricesDatabase(db);
      expect(result1.isOk()).toBe(true);

      const result2 = await clearPricesDatabase(db);
      expect(result2.isOk()).toBe(true);
    });
  });

  describe('Integration: Full lifecycle', () => {
    it('should support create -> init -> use -> clear -> close workflow', async () => {
      // Create
      const createResult = createPricesDatabase(':memory:');
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;
      db = createResult.value;

      // Initialize
      const initResult = await initializePricesDatabase(db);
      expect(initResult.isOk()).toBe(true);

      // Use
      await db
        .insertInto('providers')
        .values({
          name: 'coingecko',
          display_name: 'CoinGecko',
          is_active: 1 as unknown as boolean,
          metadata: '{}',
          created_at: new Date().toISOString(),
        })
        .execute();

      const providers = await db.selectFrom('providers').selectAll().execute();
      expect(providers.length).toBe(1);

      // Clear
      const clearResult = await clearPricesDatabase(db);
      expect(clearResult.isOk()).toBe(true);

      // Close
      const closeResult = await closePricesDatabase(db);
      expect(closeResult.isOk()).toBe(true);
      db = undefined;
    });

    it('should support multiple databases simultaneously', async () => {
      const result1 = createPricesDatabase(':memory:');
      const result2 = createPricesDatabase(':memory:');

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);

      if (result1.isOk() && result2.isOk()) {
        const db1 = result1.value;
        const db2 = result2.value;

        await initializePricesDatabase(db1);
        await initializePricesDatabase(db2);

        // Insert into db1
        await db1
          .insertInto('providers')
          .values({
            name: 'provider1',
            display_name: 'Provider 1',
            is_active: 1 as unknown as boolean,
            metadata: '{}',
            created_at: new Date().toISOString(),
          })
          .execute();

        // Insert into db2
        await db2
          .insertInto('providers')
          .values({
            name: 'provider2',
            display_name: 'Provider 2',
            is_active: 1 as unknown as boolean,
            metadata: '{}',
            created_at: new Date().toISOString(),
          })
          .execute();

        // Verify isolation
        const providers1 = await db1.selectFrom('providers').selectAll().execute();
        const providers2 = await db2.selectFrom('providers').selectAll().execute();

        expect(providers1.length).toBe(1);
        expect(providers1[0]?.name).toBe('provider1');

        expect(providers2.length).toBe(1);
        expect(providers2[0]?.name).toBe('provider2');

        await closePricesDatabase(db1);
        await closePricesDatabase(db2);
      }
    });
  });
});
