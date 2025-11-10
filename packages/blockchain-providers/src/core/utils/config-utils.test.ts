import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type BlockchainExplorersConfig, ConfigUtils, loadExplorerConfig } from './config-utils.js';

describe('config-utils', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    originalCwd = process.cwd();
    originalEnv = process.env.BLOCKCHAIN_EXPLORERS_CONFIG;
    process.chdir(tempDir);
  });

  afterEach(() => {
    // Cleanup
    process.chdir(originalCwd);
    if (originalEnv !== undefined) {
      process.env.BLOCKCHAIN_EXPLORERS_CONFIG = originalEnv;
    } else {
      delete process.env.BLOCKCHAIN_EXPLORERS_CONFIG;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('ConfigUtils.loadExplorerConfig', () => {
    it('should load valid configuration file', () => {
      const validConfig: BlockchainExplorersConfig = {
        bitcoin: {
          defaultEnabled: ['blockstream', 'mempool'],
          overrides: {
            blockstream: {
              enabled: true,
              priority: 1,
              timeout: 5000,
            },
          },
        },
      };

      const configPath = path.join(tempDir, 'test-config.json');
      fs.writeFileSync(configPath, JSON.stringify(validConfig));

      const result = ConfigUtils.loadExplorerConfig(configPath);
      expect(result).toEqual(validConfig);
    });

    it('should return undefined when config file does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.json');
      const result = ConfigUtils.loadExplorerConfig(nonExistentPath);
      expect(result).toBeUndefined();
    });

    it('should throw error for invalid JSON', () => {
      const configPath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(configPath, '{ invalid json }');

      expect(() => ConfigUtils.loadExplorerConfig(configPath)).toThrow(
        /Failed to load blockchain explorer configuration/
      );
    });

    it('should throw error for invalid schema', () => {
      const invalidConfig = {
        bitcoin: {
          defaultEnabled: 'not-an-array', // Should be array
          overrides: {
            blockstream: {
              priority: 'not-a-number', // Should be number
            },
          },
        },
      };

      const configPath = path.join(tempDir, 'invalid-schema.json');
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig));

      expect(() => ConfigUtils.loadExplorerConfig(configPath)).toThrow(
        /Failed to load blockchain explorer configuration/
      );
    });

    it('should handle configuration with optional fields', () => {
      const minimalConfig: BlockchainExplorersConfig = {
        bitcoin: {},
        ethereum: {
          defaultEnabled: ['alchemy'],
        },
      };

      const configPath = path.join(tempDir, 'minimal.json');
      fs.writeFileSync(configPath, JSON.stringify(minimalConfig));

      const result = ConfigUtils.loadExplorerConfig(configPath);
      expect(result).toEqual(minimalConfig);
    });

    it('should handle configuration with all rate limit options', () => {
      const fullRateLimitConfig: BlockchainExplorersConfig = {
        ethereum: {
          overrides: {
            alchemy: {
              rateLimit: {
                requestsPerSecond: 5,
                requestsPerMinute: 100,
                requestsPerHour: 1000,
                burstLimit: 10,
              },
              retries: 3,
              timeout: 10000,
            },
          },
        },
      };

      const configPath = path.join(tempDir, 'rate-limit.json');
      fs.writeFileSync(configPath, JSON.stringify(fullRateLimitConfig));

      const result = ConfigUtils.loadExplorerConfig(configPath);
      expect(result).toEqual(fullRateLimitConfig);
    });

    it('should load from environment variable when set', () => {
      const config: BlockchainExplorersConfig = {
        solana: {
          defaultEnabled: ['helius'],
        },
      };

      const configPath = path.join(tempDir, 'env-config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Set environment variable to relative path
      process.env.BLOCKCHAIN_EXPLORERS_CONFIG = 'env-config.json';

      const result = ConfigUtils.loadExplorerConfig();
      expect(result).toEqual(config);
    });

    it('should prefer explicit path parameter over environment variable', () => {
      const explicitConfig: BlockchainExplorersConfig = { bitcoin: {} };
      const envConfig: BlockchainExplorersConfig = { ethereum: {} };

      const explicitPath = path.join(tempDir, 'explicit.json');
      const envPath = path.join(tempDir, 'env.json');

      fs.writeFileSync(explicitPath, JSON.stringify(explicitConfig));
      fs.writeFileSync(envPath, JSON.stringify(envConfig));

      process.env.BLOCKCHAIN_EXPLORERS_CONFIG = 'env.json';

      const result = ConfigUtils.loadExplorerConfig(explicitPath);
      expect(result).toEqual(explicitConfig);
    });

    it('should look for default config path when no path provided', () => {
      const config: BlockchainExplorersConfig = { bitcoin: {} };
      const defaultPath = path.join(tempDir, 'config', 'blockchain-explorers.json');

      // Create config directory
      fs.mkdirSync(path.join(tempDir, 'config'), { recursive: true });
      fs.writeFileSync(defaultPath, JSON.stringify(config));

      const result = ConfigUtils.loadExplorerConfig();
      expect(result).toEqual(config);
    });

    it('should return undefined when default config path does not exist', () => {
      // No config file at default location
      const result = ConfigUtils.loadExplorerConfig();
      expect(result).toBeUndefined();
    });

    it('should handle multiple blockchain configurations', () => {
      const multiConfig: BlockchainExplorersConfig = {
        bitcoin: {
          defaultEnabled: ['blockstream', 'mempool'],
          overrides: {
            blockstream: { priority: 1 },
          },
        },
        ethereum: {
          defaultEnabled: ['alchemy', 'moralis'],
          overrides: {
            alchemy: { priority: 1, timeout: 5000 },
            moralis: { priority: 2, enabled: false },
          },
        },
        solana: {
          defaultEnabled: ['helius'],
        },
      };

      const configPath = path.join(tempDir, 'multi.json');
      fs.writeFileSync(configPath, JSON.stringify(multiConfig));

      const result = ConfigUtils.loadExplorerConfig(configPath);
      expect(result).toEqual(multiConfig);
    });

    it('should handle provider descriptions in overrides', () => {
      const configWithDescription: BlockchainExplorersConfig = {
        bitcoin: {
          overrides: {
            blockstream: {
              description: 'Blockstream Bitcoin explorer',
              enabled: true,
              priority: 1,
            },
          },
        },
      };

      const configPath = path.join(tempDir, 'description.json');
      fs.writeFileSync(configPath, JSON.stringify(configWithDescription));

      const result = ConfigUtils.loadExplorerConfig(configPath);
      expect(result).toEqual(configWithDescription);
    });

    it('should handle partial rate limit configurations', () => {
      const partialRateLimit: BlockchainExplorersConfig = {
        ethereum: {
          overrides: {
            alchemy: {
              rateLimit: {
                requestsPerSecond: 5,
                // Other fields are optional
              },
            },
          },
        },
      };

      const configPath = path.join(tempDir, 'partial-rate.json');
      fs.writeFileSync(configPath, JSON.stringify(partialRateLimit));

      const result = ConfigUtils.loadExplorerConfig(configPath);
      expect(result).toEqual(partialRateLimit);
    });
  });

  describe('loadExplorerConfig (convenience export)', () => {
    it('should work the same as ConfigUtils.loadExplorerConfig', () => {
      const config: BlockchainExplorersConfig = { bitcoin: {} };
      const configPath = path.join(tempDir, 'convenience.json');
      fs.writeFileSync(configPath, JSON.stringify(config));

      const classResult = ConfigUtils.loadExplorerConfig(configPath);
      const functionResult = loadExplorerConfig(configPath);

      expect(functionResult).toEqual(classResult);
      expect(functionResult).toEqual(config);
    });
  });
});
