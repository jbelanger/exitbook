import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const featuresDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectCommandFiles(relativeDir = ''): string[] {
  const currentDir = path.join(featuresDir, relativeDir);
  const entries = readdirSync(currentDir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const nextRelativePath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        return [];
      }
      return collectCommandFiles(nextRelativePath);
    }

    if (!nextRelativePath.endsWith('.ts') || !nextRelativePath.includes(`${path.sep}command${path.sep}`)) {
      return [];
    }

    return [nextRelativePath];
  });
}

describe('CLI command help text coverage', () => {
  it('adds help text for every user-facing command registration', () => {
    const mismatches = collectCommandFiles()
      .map((relativePath) => {
        const absolutePath = path.join(featuresDir, relativePath);
        const fileContents = readFileSync(absolutePath, 'utf8');
        const commandCount = (fileContents.match(/\.\s*command\s*\(/g) ?? []).length;

        if (commandCount === 0) {
          return undefined;
        }

        const helpTextCount = (fileContents.match(/\.\s*addHelpText\s*\(/g) ?? []).length;
        if (commandCount === helpTextCount) {
          return undefined;
        }

        return `${relativePath}: ${commandCount} command registration(s), ${helpTextCount} help text block(s)`;
      })
      .filter((value): value is string => value !== null);

    expect(mismatches).toEqual([]);
  });
});
