import { createInterface } from 'node:readline';
import { createReadStream, existsSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..');
const envFile = resolve(rootDir, '.env');

const parseLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;

  const cleaned = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trimStart()
    : trimmed;

  const eqIndex = cleaned.indexOf('=');
  if (eqIndex === -1) return undefined;

  const key = cleaned.slice(0, eqIndex).trim();
  if (!key) return undefined;

  const rawValue = cleaned.slice(eqIndex + 1).trim();
  const unquoted = rawValue.replace(/^['"]|['"]$/g, '');
  return { key, value: unquoted };
};

const hydrateEnvFromFile = async () => {
  if (!existsSync(envFile)) return;

  const rl = createInterface({
    input: createReadStream(envFile, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const entry = parseLine(line);
    if (!entry) return;
    if (process.env[entry.key] === undefined) {
      process.env[entry.key] = entry.value;
    }
  });

  await once(rl, 'close');
};

const runVitest = () => {
  const vitestCli = resolve(rootDir, 'node_modules', 'vitest', 'vitest.mjs');
  const vitestArgs = [vitestCli, 'run', '--coverage'];

  const child = spawn(process.execPath, vitestArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
};

const main = async () => {
  await hydrateEnvFromFile();
  runVitest();
};

void main();
