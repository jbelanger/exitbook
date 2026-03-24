import fs from 'node:fs/promises';

import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { parse } from 'csv-parse/sync';

const logger = getLogger('csv-parser-utils');

/**
 * Get the first line (header) of a CSV file for debugging
 * @param filePath Path to the CSV file
 * @returns The header line or an I/O error
 */
export async function getCsvHeaders(filePath: string): Promise<Result<string, Error>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const cleanContent = content.replace(/^\uFEFF/, '');
    const lines = cleanContent.split('\n');
    return ok(lines[0]?.trim() ?? '');
  } catch (error) {
    logger.warn({ error, filePath }, 'Failed to read CSV file for header extraction');
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Parse a CSV file into typed objects
 * @param filePath Path to the CSV file
 * @returns Array of parsed rows as objects
 */
export async function parseCsvFile<T>(filePath: string): Promise<T[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const cleanContent = content.replace(/^\uFEFF/, ''); // Remove BOM

  return parse(cleanContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/**
 * Validate CSV headers against expected format
 * @param filePath Path to the CSV file
 * @param expectedHeaders Map of header strings to file types
 * @returns The file type, 'unknown' for unmatched headers, or an I/O error
 */
export async function validateCsvHeaders(
  filePath: string,
  expectedHeaders: Record<string, string>
): Promise<Result<string, Error>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const cleanContent = content.replace(/^\uFEFF/, ''); // Remove BOM
    const lines = cleanContent.split('\n');

    if (lines.length === 0) return ok('unknown');

    const headerLine = lines[0]?.trim() ?? '';
    const normalizedHeaderLine = headerLine.toLowerCase();

    // Find matching header (case-insensitive)
    for (const [expectedHeader, fileType] of Object.entries(expectedHeaders)) {
      if (normalizedHeaderLine === expectedHeader.toLowerCase()) {
        return ok(fileType);
      }
    }

    return ok('unknown');
  } catch (error) {
    logger.warn({ error, filePath }, 'Failed to read/parse CSV file for header validation');
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
