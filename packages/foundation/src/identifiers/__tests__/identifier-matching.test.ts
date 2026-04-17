import { describe, expect, it } from 'vitest';

import {
  identifiersMatch,
  isCaseInsensitiveIdentifier,
  normalizeIdentifierForMatching,
} from '../identifier-matching.js';

describe('identifier matching', () => {
  it('matches hex identifiers case-insensitively', () => {
    expect(isCaseInsensitiveIdentifier('0xBA7DD2a5726a5A94b3556537E7212277e0E76CBf')).toBe(true);
    expect(normalizeIdentifierForMatching(' 0xBA7DD2a5726a5A94b3556537E7212277e0E76CBf ')).toBe(
      '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf'
    );
    expect(
      identifiersMatch('0xBA7DD2a5726a5A94b3556537E7212277e0E76CBf', '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf')
    ).toBe(true);
  });

  it('keeps non-hex identifiers exact', () => {
    expect(isCaseInsensitiveIdentifier('Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm')).toBe(false);
    expect(normalizeIdentifierForMatching('Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm')).toBe(
      'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm'
    );
    expect(
      identifiersMatch('Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm', 'afn6a9vom27wd8auyqdf2dyuqywa34afghqcqcgxvmm')
    ).toBe(false);
  });
});
