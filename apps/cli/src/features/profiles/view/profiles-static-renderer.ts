import type { ProfileSummary } from '@exitbook/accounts';
import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';

const PROFILE_LIST_COLUMN_GAP = '  ';
const PROFILE_LIST_COLUMN_ORDER = ['key', 'label', 'accounts'] as const;

export interface ProfilesStaticListState {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  profiles: ProfileSummary[];
}

export function outputProfilesStaticList(state: ProfilesStaticListState): void {
  process.stdout.write(buildProfilesStaticList(state));
}

export function buildProfilesStaticList(state: ProfilesStaticListState): string {
  const lines: string[] = [buildListHeader(state), '', buildCurrentLine(state), ''];

  if (state.profiles.length === 0) {
    lines.push('No profiles found.');
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.profiles, {
    accounts: {
      align: 'right',
      format: (profile) => `${profile.accountCount}`,
      minWidth: 'ACCOUNTS'.length,
    },
    key: {
      format: (profile) => profile.profileKey,
      minWidth: 'KEY'.length,
    },
    label: {
      format: (profile) => profile.displayName,
      minWidth: 'LABEL'.length,
    },
  });

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          accounts: 'ACCOUNTS',
          key: 'KEY',
          label: 'LABEL',
        },
        PROFILE_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: PROFILE_LIST_COLUMN_GAP }
      )
    )
  );

  for (const profile of state.profiles) {
    const formatted = columns.format(profile);

    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          label: profile.profileKey === state.activeProfileKey ? pc.bold(formatted.label) : formatted.label,
        },
        PROFILE_LIST_COLUMN_ORDER,
        { gap: PROFILE_LIST_COLUMN_GAP }
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildListHeader(state: ProfilesStaticListState): string {
  return `${pc.bold('Profiles')} ${pc.dim(`${state.profiles.length} total`)}`;
}

function buildCurrentLine(state: ProfilesStaticListState): string {
  const currentProfile = state.profiles.find((profile) => profile.profileKey === state.activeProfileKey);
  const currentDisplayName = currentProfile?.displayName ?? state.activeProfileKey;
  const sourceSuffix = state.activeProfileSource === 'default' ? '' : ` (${state.activeProfileSource})`;

  return `${pc.dim('Current:')} ${currentDisplayName} [key: ${state.activeProfileKey}]${sourceSuffix}`;
}
