import { describe, expect, it } from 'vitest';

import { buildIssueSelector, resolveIssueSelector } from '../issue-selector.js';

describe('issue-selector', () => {
  it('resolves a unique selector prefix against the full selector', () => {
    const fullSelector = buildIssueSelector('profile:1', 'transfer_gap:tx-a|asset-a|outflow');
    const result = resolveIssueSelector(
      [
        {
          fullSelector,
          item: { issueKey: 'issue-a' },
        },
      ],
      fullSelector.slice(0, 2)
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.item).toEqual({ issueKey: 'issue-a' });
      expect(result.value.value).toBe(fullSelector.slice(0, 2));
    }
  });

  it('fails when the selector is ambiguous', () => {
    const result = resolveIssueSelector(
      [
        {
          fullSelector: 'abcdef123456',
          item: { issueKey: 'issue-a' },
        },
        {
          fullSelector: 'abcdef999999',
          item: { issueKey: 'issue-b' },
        },
      ],
      'abc'
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('ambiguous');
    }
  });

  it('fails when the selector does not match any current issue', () => {
    const result = resolveIssueSelector([], 'deadbeef');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Issue ref 'deadbeef' not found");
    }
  });
});
