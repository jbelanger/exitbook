import * as fs from 'node:fs';
import * as path from 'node:path';

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { Configuration, validateConfig } from './config.schema';

/**
 * An intelligent loader for the providers configuration.
 * It searches for configuration files in a cascading order of precedence,
 * allowing for environment-specific and local overrides.
 *
 * Precedence Order (highest to lowest):
 * 1. Path specified in PROVIDERS_CONFIG_PATH environment variable.
 * 2. `config/providers.local.json` (for untracked local overrides).
 * 3. `config/providers.${NODE_ENV}.json` (e.g., `config/providers.development.json`).
 * 4. `config/providers.json` (the default base configuration).
 */
const loadProvidersConfig = () => {
  const nodeEnvironment = process.env.NODE_ENV || 'development';
  const explicitPath = process.env.PROVIDERS_CONFIG_PATH;

  const searchPaths = [
    explicitPath,
    `./config/providers.local.json`,
    `./config/providers.${nodeEnvironment}.json`,
    './config/providers.json',
  ].filter((p): p is string => typeof p === 'string'); // Filter out potential undefined explicitPath

  for (const relativePath of searchPaths) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (fs.existsSync(fullPath)) {
      console.log(`[ConfigModule] Loading providers configuration from: ${relativePath}`);
      try {
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        return JSON.parse(fileContent);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to parse providers config file at ${fullPath}: ${message}`);
      }
    }
  }

  // If no file is found after searching all paths, return an empty object.
  console.warn(`[ConfigModule] No providers config file found. Skipping.`);
  return {};
};

@Global()
@Module({
  exports: ['TYPED_CONFIG'],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [
    {
      provide: 'TYPED_CONFIG',
      useFactory: (): Configuration => {
        // Load providers config and merge with environment variables
        const providersConfig = loadProvidersConfig();
        const mergedConfig = {
          ...providersConfig,
          ...process.env,
        };

        const validationResult = validateConfig(mergedConfig);
        if (validationResult.isErr()) {
          throw validationResult.error;
        }
        return validationResult.value;
      },
    },
  ],
})
export class TypedConfigModule {}
