/**
 * Shared helpers for terminal row budgeting in list/detail dashboards.
 */

export type SectionLineCounter = number;

export type ChromeSections = Record<string, SectionLineCounter | undefined>;

export function conditionalLines(condition: boolean, lines: number): number {
  return condition ? lines : 0;
}

export function arrayLines<T>(items: readonly T[] | undefined, linesPerItem = 1): number {
  if (!items || items.length === 0) {
    return 0;
  }
  return items.length * Math.max(0, linesPerItem);
}

export function calculateChromeLines(sections: ChromeSections): number {
  let lines = 0;
  for (const section of Object.values(sections)) {
    lines += section ?? 0;
  }
  return lines;
}

export function calculateVisibleRows(terminalHeight: number, chromeLines: number): number {
  return Math.max(1, terminalHeight - chromeLines);
}
