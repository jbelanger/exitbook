import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_PROFILE_KEY, normalizeProfileKey } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

const CLI_STATE_FILENAME = 'cli-state.json';

type ActiveProfileSource = 'default' | 'env' | 'state';

interface CliStateFile {
  activeProfileKey?: string | undefined;
}

export interface CliProfileSelection {
  profileKey: string;
  source: ActiveProfileSource;
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

    const activeProfileKey = (parsed as { activeProfileKey?: unknown }).activeProfileKey;
    if (activeProfileKey !== undefined && typeof activeProfileKey !== 'string') {
      return err(new Error(`CLI state file has invalid activeProfileKey: ${statePath}`));
    }

    return ok({ activeProfileKey });
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
    const normalizedEnvResult = normalizeProfileKey(envProfile);
    if (normalizedEnvResult.isErr()) {
      return err(normalizedEnvResult.error);
    }

    return ok({ profileKey: normalizedEnvResult.value, source: 'env' });
  }

  const stateResult = readCliStateFile(dataDir);
  if (stateResult.isErr()) {
    return err(stateResult.error);
  }

  if (stateResult.value.activeProfileKey) {
    const normalizedStateResult = normalizeProfileKey(stateResult.value.activeProfileKey);
    if (normalizedStateResult.isErr()) {
      return err(normalizedStateResult.error);
    }

    return ok({ profileKey: normalizedStateResult.value, source: 'state' });
  }

  return ok({ profileKey: DEFAULT_PROFILE_KEY, source: 'default' });
}

export function writeCliStateFile(dataDir: string, profileKey: string): Result<void, Error> {
  const normalizedProfileKeyResult = normalizeProfileKey(profileKey);
  if (normalizedProfileKeyResult.isErr()) {
    return err(normalizedProfileKeyResult.error);
  }

  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      getCliStatePath(dataDir),
      JSON.stringify({ activeProfileKey: normalizedProfileKeyResult.value }, undefined, 2),
      'utf8'
    );
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
