import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCsvHeaders, parseCsvFile, validateCsvHeaders } from './csv-parser-utils.js';

describe('csv-parser-utils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-parser-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getCsvHeaders', () => {
    it('should return the first line of a CSV file', async () => {
      const csvPath = path.join(tmpDir, 'test.csv');
      const content = 'Name,Age,City\nJohn,30,NYC\nJane,25,LA';
      await fs.writeFile(csvPath, content);

      const result = await getCsvHeaders(csvPath);

      expect(result).toBe('Name,Age,City');
    });

    it('should remove BOM from CSV headers', async () => {
      const csvPath = path.join(tmpDir, 'test-bom.csv');
      const content = '\uFEFFName,Age,City\nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const result = await getCsvHeaders(csvPath);

      expect(result).toBe('Name,Age,City');
    });

    it('should trim whitespace from headers', async () => {
      const csvPath = path.join(tmpDir, 'test-whitespace.csv');
      const content = '  Name,Age,City  \nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const result = await getCsvHeaders(csvPath);

      expect(result).toBe('Name,Age,City');
    });

    it('should return empty string for empty file', async () => {
      const csvPath = path.join(tmpDir, 'empty.csv');
      await fs.writeFile(csvPath, '');

      const result = await getCsvHeaders(csvPath);

      expect(result).toBe('');
    });

    it('should return empty string for file with only newlines', async () => {
      const csvPath = path.join(tmpDir, 'newlines.csv');
      await fs.writeFile(csvPath, '\n\n\n');

      const result = await getCsvHeaders(csvPath);

      expect(result).toBe('');
    });

    it('should return empty string when file does not exist', async () => {
      const csvPath = path.join(tmpDir, 'nonexistent.csv');

      const result = await getCsvHeaders(csvPath);

      expect(result).toBe('');
    });

    it('should handle single line file without newline', async () => {
      const csvPath = path.join(tmpDir, 'single-line.csv');
      await fs.writeFile(csvPath, 'Name,Age,City');

      const result = await getCsvHeaders(csvPath);

      expect(result).toBe('Name,Age,City');
    });
  });

  describe('parseCsvFile', () => {
    interface TestRow {
      Name: string;
      Age: string;
      City: string;
    }

    it('should parse a valid CSV file', async () => {
      const csvPath = path.join(tmpDir, 'test.csv');
      const content = 'Name,Age,City\nJohn,30,NYC\nJane,25,LA';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ Name: 'John', Age: '30', City: 'NYC' });
      expect(result[1]).toEqual({ Name: 'Jane', Age: '25', City: 'LA' });
    });

    it('should remove BOM before parsing', async () => {
      const csvPath = path.join(tmpDir, 'test-bom.csv');
      const content = '\uFEFFName,Age,City\nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ Name: 'John', Age: '30', City: 'NYC' });
    });

    it('should skip empty lines', async () => {
      const csvPath = path.join(tmpDir, 'empty-lines.csv');
      const content = 'Name,Age,City\nJohn,30,NYC\n\nJane,25,LA\n\n\n';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ Name: 'John', Age: '30', City: 'NYC' });
      expect(result[1]).toEqual({ Name: 'Jane', Age: '25', City: 'LA' });
    });

    it('should trim whitespace from values', async () => {
      const csvPath = path.join(tmpDir, 'whitespace.csv');
      const content = 'Name,Age,City\n  John  ,  30  ,  NYC  ';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ Name: 'John', Age: '30', City: 'NYC' });
    });

    it('should handle quoted values with commas', async () => {
      const csvPath = path.join(tmpDir, 'quoted.csv');
      const content = 'Name,Age,City\n"Doe, John",30,NYC';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ Name: 'Doe, John', Age: '30', City: 'NYC' });
    });

    it('should handle quoted values with newlines', async () => {
      const csvPath = path.join(tmpDir, 'multiline.csv');
      const content = 'Name,Age,City\n"John\nDoe",30,NYC';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ Name: 'John\nDoe', Age: '30', City: 'NYC' });
    });

    it('should handle empty CSV file', async () => {
      const csvPath = path.join(tmpDir, 'empty.csv');
      await fs.writeFile(csvPath, '');

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(0);
    });

    it('should handle CSV with only headers', async () => {
      const csvPath = path.join(tmpDir, 'headers-only.csv');
      await fs.writeFile(csvPath, 'Name,Age,City\n');

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(0);
    });

    it('should throw error when file does not exist', async () => {
      const csvPath = path.join(tmpDir, 'nonexistent.csv');

      await expect(parseCsvFile<TestRow>(csvPath)).rejects.toThrow();
    });

    it('should handle complex CSV with special characters', async () => {
      const csvPath = path.join(tmpDir, 'special-chars.csv');
      const content = 'Name,Age,City\n"O\'Brien",30,"São Paulo"';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ Name: "O'Brien", Age: '30', City: 'São Paulo' });
    });

    it('should handle missing values', async () => {
      const csvPath = path.join(tmpDir, 'missing-values.csv');
      const content = 'Name,Age,City\nJohn,,NYC\n,25,LA';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ Name: 'John', Age: '', City: 'NYC' });
      expect(result[1]).toEqual({ Name: '', Age: '25', City: 'LA' });
    });

    it('should handle Windows line endings (CRLF)', async () => {
      const csvPath = path.join(tmpDir, 'windows.csv');
      const content = 'Name,Age,City\r\nJohn,30,NYC\r\nJane,25,LA';
      await fs.writeFile(csvPath, content);

      const result = await parseCsvFile<TestRow>(csvPath);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ Name: 'John', Age: '30', City: 'NYC' });
      expect(result[1]).toEqual({ Name: 'Jane', Age: '25', City: 'LA' });
    });
  });

  describe('validateCsvHeaders', () => {
    it('should return matching file type for exact header match', async () => {
      const csvPath = path.join(tmpDir, 'test.csv');
      const content = 'Name,Age,City\nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('user_data');
    });

    it('should match headers case-insensitively', async () => {
      const csvPath = path.join(tmpDir, 'test.csv');
      const content = 'NAME,AGE,CITY\nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'name,age,city': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('user_data');
    });

    it('should remove BOM before matching headers', async () => {
      const csvPath = path.join(tmpDir, 'test-bom.csv');
      const content = '\uFEFFName,Age,City\nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('user_data');
    });

    it('should trim whitespace from headers before matching', async () => {
      const csvPath = path.join(tmpDir, 'test-whitespace.csv');
      const content = '  Name,Age,City  \nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('user_data');
    });

    it('should return unknown for non-matching headers', async () => {
      const csvPath = path.join(tmpDir, 'test.csv');
      const content = 'Different,Headers,Here\nValue1,Value2,Value3';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('unknown');
    });

    it('should return unknown for empty file', async () => {
      const csvPath = path.join(tmpDir, 'empty.csv');
      await fs.writeFile(csvPath, '');

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('unknown');
    });

    it('should return unknown when file does not exist', async () => {
      const csvPath = path.join(tmpDir, 'nonexistent.csv');

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('unknown');
    });

    it('should match first header when multiple headers defined', async () => {
      const csvPath = path.join(tmpDir, 'test.csv');
      const content = 'ID,Name,Email\n1,John,john@example.com';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
        'ID,Name,Email': 'user_contacts',
        'Order,Date,Amount': 'orders',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('user_contacts');
    });

    it('should handle headers with special characters', async () => {
      const csvPath = path.join(tmpDir, 'special.csv');
      const content = 'Order ID,Time(UTC),Amount($)\n1,2024-01-01,100';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'Order ID,Time(UTC),Amount($)': 'order_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('order_data');
    });

    it('should handle mixed case in both header and expected headers', async () => {
      const csvPath = path.join(tmpDir, 'mixed-case.csv');
      const content = 'NaMe,aGe,CiTy\nJohn,30,NYC';
      await fs.writeFile(csvPath, content);

      const expectedHeaders = {
        'NAME,AGE,CITY': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('user_data');
    });

    it('should return unknown for file with only newlines', async () => {
      const csvPath = path.join(tmpDir, 'newlines.csv');
      await fs.writeFile(csvPath, '\n\n\n');

      const expectedHeaders = {
        'Name,Age,City': 'user_data',
      };

      const result = await validateCsvHeaders(csvPath, expectedHeaders);

      expect(result).toBe('unknown');
    });
  });
});
