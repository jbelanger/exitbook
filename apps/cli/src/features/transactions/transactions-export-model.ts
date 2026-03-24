export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const CSV_FORMATS = ['normalized', 'simple'] as const;
export type CsvFormat = (typeof CSV_FORMATS)[number];
