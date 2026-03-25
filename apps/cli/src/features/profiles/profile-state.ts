import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_PROFILE_NAME } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

const CLI_STATE_FILENAME = 'cli-state.json';

type ActiveProfileSource = 'default' | 'env' | 'state';

interface CliStateFile {
  activeProfileName?: string | undefined;
}

export interface CliProfileSelection {
  name: string;
  source: ActiveProfileSource;
}

function normalizeProfileName(name: string, field: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error(`${field} must not be empty`));
  }

  return ok(normalized);
}

export function getCliStatePath(dataDir: string): string {
  return path.join(dataDir, CLI_STATE_FILENAME);
}

export function readCliStateFile(dataDir: string): Result<CliStateFile, Error> {
  const statePath = getCliStatePath(dataDir);

  try {
    const raw = readFileSync(statePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return err(new Error(`CLI state file is invalid: ${statePath}`));
    }

    const activeProfileName = (parsed as { activeProfileName?: unknown }).activeProfileName;
    if (activeProfileName !== undefined && typeof activeProfileName !== 'string') {
      return err(new Error(`CLI state file has invalid activeProfileName: ${statePath}`));
    }

    return ok({ activeProfileName });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok({});
    }

    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export function resolveCliProfileSelection(dataDir: string): Result<CliProfileSelection, Error> {
  const envProfile = process.env['EXITBOOK_PROFILE'];
  if (envProfile !== undefined) {
    const normalizedEnvResult = normalizeProfileName(envProfile, 'EXITBOOK_PROFILE');
    if (normalizedEnvResult.isErr()) {
      return err(normalizedEnvResult.error);
    }

    return ok({ name: normalizedEnvResult.value, source: 'env' });
  }

  const stateResult = readCliStateFile(dataDir);
  if (stateResult.isErr()) {
    return err(stateResult.error);
  }

  if (stateResult.value.activeProfileName) {
    const normalizedStateResult = normalizeProfileName(stateResult.value.activeProfileName, 'Active profile name');
    if (normalizedStateResult.isErr()) {
      return err(normalizedStateResult.error);
    }

    return ok({ name: normalizedStateResult.value, source: 'state' });
  }

  return ok({ name: DEFAULT_PROFILE_NAME, source: 'default' });
}

export function writeCliStateFile(dataDir: string, profileName: string): Result<void, Error> {
  const normalizedProfileNameResult = normalizeProfileName(profileName, 'Profile name');
  if (normalizedProfileNameResult.isErr()) {
    return err(normalizedProfileNameResult.error);
  }

  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      getCliStatePath(dataDir),
      JSON.stringify({ activeProfileName: normalizedProfileNameResult.value }, undefined, 2),
      'utf8'
    );
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
