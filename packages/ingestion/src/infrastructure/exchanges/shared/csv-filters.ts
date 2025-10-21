/**
 * Generic filtering utilities for CSV data
 */
export class CsvFilters {
  /**
   * Filter rows by a single field value
   * @param rows Array of objects to filter
   * @param field Field name to filter by
   * @param value Value to match (if undefined, no filtering is applied)
   * @returns Filtered array
   */
  static filterByField<T, K extends keyof T>(rows: T[], field: K, value?: T[K]): T[] {
    if (value === undefined || value === null) {
      return rows;
    }
    return rows.filter((row) => row[field] === value);
  }

  /**
   * Filter rows by multiple field values
   * @param rows Array of objects to filter
   * @param filters Object with field names as keys and values to match
   * @returns Filtered array
   */
  static filterByFields<T>(rows: T[], filters: Partial<Record<keyof T, unknown>>): T[] {
    return rows.filter((row) => {
      return Object.entries(filters).every(([field, value]) => {
        if (value === undefined || value === null) {
          return true;
        }
        return row[field as keyof T] === value;
      });
    });
  }

  /**
   * Filter rows by timestamp range
   * @param rows Array of objects with timestamp field
   * @param since Minimum timestamp (if undefined, no lower bound)
   * @param until Maximum timestamp (if undefined, no upper bound)
   * @returns Filtered array
   */
  static filterByTimestamp<T extends { timestamp: number }>(rows: T[], since?: number, until?: number): T[] {
    return rows.filter((row) => {
      if (since !== undefined && row.timestamp < since) {
        return false;
      }
      if (until !== undefined && row.timestamp > until) {
        return false;
      }
      return true;
    });
  }

  /**
   * Filter rows by UID (common pattern for exchange CSVs)
   * @param rows Array of objects with UID field
   * @param uid UID to filter by (if undefined, no filtering is applied)
   * @returns Filtered array
   */
  static filterByUid<T extends { UID: string }>(rows: T[], uid?: string): T[] {
    return this.filterByField(rows, 'UID', uid);
  }

  /**
   * Group rows by a field value
   * @param rows Array of objects to group
   * @param field Field name to group by
   * @returns Map with field values as keys and arrays of rows as values
   */
  static groupByField<T, K extends keyof T>(rows: T[], field: K): Map<T[K], T[]> {
    const groups = new Map<T[K], T[]>();

    for (const row of rows) {
      const key = row[field];
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    return groups;
  }
}
