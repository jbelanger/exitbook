import fs from 'node:fs/promises';

import { parse } from 'csv-parse/sync';

/**
 * Generic CSV file parser with common preprocessing
 */
export class CsvParser {
  /**
   * Get the first line (header) of a CSV file for debugging
   * @param filePath Path to the CSV file
   * @returns The header line or empty string
   */
  static async getHeaders(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const cleanContent = content.replace(/^\uFEFF/, '');
      const lines = cleanContent.split('\n');
      return lines[0]?.trim() ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Parse a CSV file into typed objects
   * @param filePath Path to the CSV file
   * @returns Array of parsed rows as objects
   */
  static async parseFile<T>(filePath: string): Promise<T[]> {
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
   * @returns The file type or 'unknown'
   */
  static async validateHeaders(filePath: string, expectedHeaders: Record<string, string>): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const cleanContent = content.replace(/^\uFEFF/, ''); // Remove BOM
      const lines = cleanContent.split('\n');

      if (lines.length === 0) return 'unknown';

      const headerLine = lines[0]?.trim() ?? '';
      const normalizedHeaderLine = headerLine.toLowerCase();

      // Find matching header (case-insensitive)
      for (const [expectedHeader, fileType] of Object.entries(expectedHeaders)) {
        if (normalizedHeaderLine === expectedHeader.toLowerCase()) {
          return fileType;
        }
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
