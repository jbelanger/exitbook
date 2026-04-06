import { describe, expect, it } from 'vitest';

import { buildProfilesStaticDetail, buildProfilesStaticList } from '../profiles-static-renderer.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

describe('buildProfilesStaticList', () => {
  it('renders the current profile context and a static table', () => {
    const output = stripAnsi(
      buildProfilesStaticList({
        activeProfileKey: 'business',
        activeProfileSource: 'state',
        profiles: [
          {
            id: 1,
            profileKey: 'default',
            displayName: 'default',
            accountCount: 1,
            createdAt: new Date('2026-03-26T00:00:00.000Z'),
          },
          {
            id: 2,
            profileKey: 'business',
            displayName: 'Business / Family',
            accountCount: 3,
            createdAt: new Date('2026-03-27T00:00:00.000Z'),
          },
        ],
      })
    );
    const lines = output.trimEnd().split('\n');

    expect(lines[0]).toBe('Profiles 2 total');
    expect(lines[2]).toBe('Current: Business / Family [key: business] (state)');
    expect(lines[4]).toBe('KEY       LABEL              ACCOUNTS');
    expect(lines[5]).toMatch(/^default\s+default\s+1$/);
    expect(lines[6]).toMatch(/^business\s+Business \/ Family\s+3$/);
    expect(output.startsWith('\n')).toBe(false);
    expect(output.endsWith('\n\n')).toBe(false);
  });

  it('falls back to the active key when the current profile is not in the list', () => {
    const output = stripAnsi(
      buildProfilesStaticList({
        activeProfileKey: 'missing',
        activeProfileSource: 'env',
        profiles: [
          {
            id: 1,
            profileKey: 'default',
            displayName: 'default',
            accountCount: 0,
            createdAt: new Date('2026-03-26T00:00:00.000Z'),
          },
        ],
      })
    );
    const lines = output.trimEnd().split('\n');

    expect(lines[2]).toBe('Current: missing [key: missing] (env)');
    expect(lines[4]).toBe('KEY      LABEL    ACCOUNTS');
    expect(lines[5]).toMatch(/^default\s+default\s+0$/);
  });
});

describe('buildProfilesStaticDetail', () => {
  it('renders a static detail card for one profile', () => {
    const output = stripAnsi(
      buildProfilesStaticDetail({
        activeProfileKey: 'business',
        activeProfileSource: 'state',
        profile: {
          id: 2,
          profileKey: 'business',
          displayName: 'Business / Family',
          accountCount: 3,
          isActive: true,
          activeProfileSource: 'state',
          createdAt: new Date('2026-03-27T00:00:00.000Z'),
        },
      })
    );
    const lines = output.trimEnd().split('\n');

    expect(lines[0]).toBe('Business / Family business');
    expect(lines[2]).toBe('Key: business');
    expect(lines[3]).toBe('Label: Business / Family');
    expect(lines[4]).toBe('Accounts: 3');
    expect(lines[5]).toBe('Current: yes (state)');
    expect(lines[6]).toBe('Created: 2026-03-27T00:00:00.000Z');
  });
});
