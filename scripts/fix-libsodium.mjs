#!/usr/bin/env node

/**
 * Fix for broken libsodium-wrappers-sumo@0.7.16 ESM build
 *
 * The package is missing libsodium-sumo.mjs in its dist/modules-sumo-esm/ directory,
 * but the wrapper file tries to import it. This script copies the file from the
 * libsodium-sumo package to fix the issue.
 *
 * See: https://github.com/jedisct1/libsodium.js/issues
 */

import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const source = join(projectRoot, 'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs');
const target = join(projectRoot, 'node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs');

// Only copy if source exists and target doesn't
if (existsSync(source) && !existsSync(target)) {
  try {
    copyFileSync(source, target);
    console.log('✓ Fixed libsodium-wrappers-sumo ESM build by copying libsodium-sumo.mjs');
  } catch (error) {
    console.warn('⚠ Failed to fix libsodium-wrappers-sumo:', error.message);
  }
} else if (!existsSync(source)) {
  console.warn('⚠ libsodium-sumo package not found, skipping fix');
} else {
  // Target already exists, no action needed
}
