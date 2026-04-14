import { stripVTControlCharacters } from 'node:util';

import type {
  AccountingIssueDetailItem,
  AccountingIssueScopeSummary,
  AccountingIssueSummaryItem,
} from '@exitbook/accounting/issues';
import { describe, expect, it } from 'vitest';

import {
  buildIssuesStaticDetail,
  buildIssuesStaticOverview,
  buildIssuesStaticScopedList,
} from '../issues-static-renderer.js';

function createScopeSummary(overrides: Partial<AccountingIssueScopeSummary> = {}): AccountingIssueScopeSummary {
  return {
    scopeKind: 'profile',
    scopeKey: 'profile:1',
    profileId: 1,
    title: 'default',
    status: 'has-open-issues',
    openIssueCount: 2,
    blockingIssueCount: 2,
    updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    ...overrides,
  };
}

function createSummaryItem(overrides: Partial<AccountingIssueSummaryItem> = {}): AccountingIssueSummaryItem {
  return {
    issueRef: '2d4c8e1af3',
    family: 'transfer_gap',
    code: 'LINK_GAP',
    severity: 'blocked',
    reviewState: 'open',
    summary: 'ADA transfer still needs review',
    nextActions: [
      {
        kind: 'review_gap',
        label: 'Review in links gaps',
        mode: 'routed',
        routeTarget: {
          family: 'links',
          selectorKind: 'gap-ref',
          selectorValue: 'c6787f8ae9',
        },
      },
    ],
    ...overrides,
  };
}

function createDetailItem(overrides: Partial<AccountingIssueDetailItem> = {}): AccountingIssueDetailItem {
  return {
    ...createSummaryItem(),
    scope: {
      kind: 'profile',
      key: 'profile:1',
    },
    details: 'This outflow has no confirmed internal transfer match yet.',
    whyThisMatters: 'Blocks trustworthy transfer accounting for this movement.',
    evidenceRefs: [
      {
        kind: 'gap',
        ref: 'c6787f8ae9',
      },
      {
        kind: 'transaction',
        ref: '9c1f37d0ab',
      },
    ],
    nextActions: [
      {
        kind: 'review_gap',
        label: 'Review in links gaps',
        mode: 'routed',
        routeTarget: {
          family: 'links',
          selectorKind: 'gap-ref',
          selectorValue: 'c6787f8ae9',
        },
      },
      {
        kind: 'inspect_transaction',
        label: 'Inspect transaction',
        mode: 'review_only',
        routeTarget: {
          family: 'transactions',
          selectorKind: 'tx-ref',
          selectorValue: '9c1f37d0ab',
        },
      },
    ],
    ...overrides,
  };
}

describe('issues-static-renderer', () => {
  it('renders the overview with current issue rows and next actions', () => {
    const output = stripVTControlCharacters(
      buildIssuesStaticOverview({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        profileDisplayName: 'default',
        scope: createScopeSummary(),
        currentIssues: [createSummaryItem()],
        scopedLenses: [],
      })
    );

    expect(output).toContain('Issues 2 open · 2 blocking · Profile has open issues');
    expect(output).toContain('Current Issues');
    expect(output).toContain('ISSUE-REF');
    expect(output).toContain('2d4c8e1af3');
    expect(output).toContain('OPEN');
    expect(output).toContain('Transfer gap');
    expect(output).toContain('Review in links gaps');
  });

  it('renders scoped accounting lenses in the overview when known scopes exist', () => {
    const output = stripVTControlCharacters(
      buildIssuesStaticOverview({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        profileDisplayName: 'default',
        scope: createScopeSummary(),
        currentIssues: [createSummaryItem()],
        scopedLenses: [
          createScopeSummary({
            scopeKind: 'cost-basis',
            scopeKey: 'profile:1:cost-basis:abcd1234',
            title: 'CA / average-cost / 2024',
            openIssueCount: 1,
            blockingIssueCount: 1,
            updatedAt: new Date('2026-04-14T13:45:00.000Z'),
          }),
        ],
      })
    );

    expect(output).toContain('Scoped Accounting Lenses');
    expect(output).toContain('CA / average-cost / 2024');
    expect(output).toContain('Open scoped issues');
    expect(output).toContain('2026-04-14 13:45');
  });

  it('renders the empty overview state clearly', () => {
    const output = stripVTControlCharacters(
      buildIssuesStaticOverview({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        profileDisplayName: 'default',
        scope: createScopeSummary({
          status: 'ready',
          openIssueCount: 0,
          blockingIssueCount: 0,
        }),
        currentIssues: [],
        scopedLenses: [],
      })
    );

    expect(output).toContain('Issues 0 open · 0 blocking · Profile ready');
    expect(output).toContain('No current issues.');
  });

  it('renders detail with evidence and possible next actions', () => {
    const output = stripVTControlCharacters(
      buildIssuesStaticDetail({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        profileDisplayName: 'default',
        issue: createDetailItem(),
      })
    );

    expect(output).toContain('Issue 2d4c8e1af3');
    expect(output).toContain('[OPEN]');
    expect(output).toContain('Possible next actions');
    expect(output).toContain('Review in links gaps');
    expect(output).toContain('Routed action · links gaps view c6787f8ae9');
    expect(output).toContain('Review only · transactions view 9c1f37d0ab');
    expect(output).toContain('Evidence');
    expect(output).toContain('GAP-REF c6787f8ae9');
    expect(output).toContain('TX-REF 9c1f37d0ab');
  });

  it('renders direct acknowledgement actions and acknowledged state clearly', () => {
    const output = stripVTControlCharacters(
      buildIssuesStaticDetail({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        profileDisplayName: 'default',
        issue: createDetailItem({
          reviewState: 'acknowledged',
          nextActions: [
            {
              kind: 'reopen_acknowledgement',
              label: 'Reopen acknowledgement',
              mode: 'direct',
            },
          ],
        }),
      })
    );

    expect(output).toContain('[ACKNOWLEDGED]');
    expect(output).toContain('Review: ACKNOWLEDGED');
    expect(output).toContain('Direct action · issues reopen 2d4c8e1af3');
  });

  it('renders a scoped cost-basis issue list with status metadata', () => {
    const output = stripVTControlCharacters(
      buildIssuesStaticScopedList({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        profileDisplayName: 'default',
        scope: createScopeSummary({
          scopeKind: 'cost-basis',
          scopeKey: 'profile:1:cost-basis:abcd1234',
          title: 'CA / average-cost / 2024',
          openIssueCount: 1,
          blockingIssueCount: 1,
        }),
        currentIssues: [
          createSummaryItem({
            family: 'tax_readiness',
            code: 'MISSING_PRICE_DATA',
            summary: 'Required transaction price data is missing.',
            nextActions: [
              {
                kind: 'review_prices',
                label: 'Review in prices',
                mode: 'routed',
                routeTarget: {
                  family: 'prices',
                },
              },
            ],
          }),
        ],
      })
    );

    expect(output).toContain('Cost-basis issues');
    expect(output).toContain('CA / average-cost / 2024');
    expect(output).toContain('Status: not ready · 1 blocking · 1 open');
    expect(output).toContain('Tax readiness');
    expect(output).toContain('Review in prices');
  });
});
