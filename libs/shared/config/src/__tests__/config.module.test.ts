import * as fs from 'node:fs';
import * as path from 'node:path';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Polyfill for reflect-metadata
import 'reflect-metadata';

import { TypedConfigModule } from '../config.module';
import { Configuration } from '../config.schema';

// Mock fs module
vi.mock('node:fs');
vi.mock('node:path');

const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);

describe('TypedConfigModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.NODE_ENV;
    delete process.env.PROVIDERS_CONFIG_PATH;
  });

  describe('loadProvidersConfig', () => {
    it('should load config from explicit path when PROVIDERS_CONFIG_PATH is set', async () => {
      const configData = {
        bitcoin: {
          enabled: true,
          priority: ['mempool.space'],
          providers: ['mempool.space', 'blockchair'],
        },
      };

      process.env.PROVIDERS_CONFIG_PATH = '/custom/path/config.json';
      mockPath.resolve.mockReturnValue('/custom/path/config.json');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      const configService = module.get<ConfigService>(ConfigService);
      const loadedConfig = configService.get('');

      expect(mockPath.resolve).toHaveBeenCalledWith(process.cwd(), '/custom/path/config.json');
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/custom/path/config.json', 'utf-8');
      expect(loadedConfig).toEqual(configData);
    });

    it('should load config from local file when it exists', async () => {
      const configData = {
        ethereum: {
          enabled: false,
          priority: ['etherscan'],
          providers: ['etherscan'],
        },
      };

      mockPath.resolve.mockReturnValueOnce('/resolved/path/providers.local.json');
      mockFs.existsSync.mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      const configService = module.get<ConfigService>(ConfigService);
      const loadedConfig = configService.get('');

      expect(mockPath.resolve).toHaveBeenCalledWith(process.cwd(), './config/providers.local.json');
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/resolved/path/providers.local.json', 'utf-8');
      expect(loadedConfig).toEqual(configData);
    });

    it('should load environment-specific config', async () => {
      const configData = {
        bitcoin: {
          enabled: true,
          priority: ['mempool.space'],
          providers: ['mempool.space'],
        },
      };

      process.env.NODE_ENV = 'production';
      mockPath.resolve
        .mockReturnValueOnce('/resolved/path/providers.local.json')
        .mockReturnValueOnce('/resolved/path/providers.production.json');
      mockFs.existsSync
        .mockReturnValueOnce(false) // local file doesn't exist
        .mockReturnValueOnce(true); // production file exists
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      const configService = module.get<ConfigService>(ConfigService);
      const loadedConfig = configService.get('');

      expect(mockPath.resolve).toHaveBeenCalledWith(process.cwd(), './config/providers.production.json');
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/resolved/path/providers.production.json', 'utf-8');
      expect(loadedConfig).toEqual(configData);
    });

    it('should load default config when no environment-specific config exists', async () => {
      const configData = {
        bitcoin: {
          enabled: true,
          priority: ['mempool.space'],
          providers: ['mempool.space'],
        },
      };

      process.env.NODE_ENV = 'test';
      mockPath.resolve
        .mockReturnValueOnce('/resolved/path/providers.local.json')
        .mockReturnValueOnce('/resolved/path/providers.test.json')
        .mockReturnValueOnce('/resolved/path/providers.json');
      mockFs.existsSync
        .mockReturnValueOnce(false) // local file doesn't exist
        .mockReturnValueOnce(false) // test file doesn't exist
        .mockReturnValueOnce(true); // default file exists
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      const configService = module.get<ConfigService>(ConfigService);
      const loadedConfig = configService.get('');

      expect(mockPath.resolve).toHaveBeenCalledWith(process.cwd(), './config/providers.json');
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/resolved/path/providers.json', 'utf-8');
      expect(loadedConfig).toEqual(configData);
    });

    it('should return empty object when no config file exists', async () => {
      mockPath.resolve.mockReturnValue('/resolved/path');
      mockFs.existsSync.mockReturnValue(false);

      // Mock console.warn to avoid output during tests
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      const configService = module.get<ConfigService>(ConfigService);
      const loadedConfig = configService.get('');

      expect(loadedConfig).toEqual({});
      expect(consoleWarnSpy).toHaveBeenCalledWith('[ConfigModule] No providers config file found. Skipping.');

      consoleWarnSpy.mockRestore();
    });

    it('should throw error when config file is malformed JSON', async () => {
      mockPath.resolve.mockReturnValue('/resolved/path/providers.json');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      await expect(
        Test.createTestingModule({
          imports: [TypedConfigModule],
        }).compile()
      ).rejects.toThrow('Failed to parse providers config file');
    });

    it('should use development as default NODE_ENV', async () => {
      mockPath.resolve
        .mockReturnValueOnce('/resolved/path/providers.local.json')
        .mockReturnValueOnce('/resolved/path/providers.development.json');
      mockFs.existsSync
        .mockReturnValueOnce(false) // local file doesn't exist
        .mockReturnValueOnce(true); // development file exists
      mockFs.readFileSync.mockReturnValue('{}');

      await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      expect(mockPath.resolve).toHaveBeenCalledWith(process.cwd(), './config/providers.development.json');
    });
  });

  describe('TYPED_CONFIG provider', () => {
    it('should provide validated configuration', async () => {
      const configData = {};
      const mockValidConfig = {
        DATABASE_POOL_SIZE: 10,
        DATABASE_SSL_MODE: 'prefer',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        LOG_LEVEL: 'info',
        NODE_ENV: 'development',
        PORT: 3000,
        PROVIDERS_CONFIG_PATH: './config/providers.config.json',
      } as Configuration;

      mockPath.resolve.mockReturnValue('/resolved/path');
      mockFs.existsSync.mockReturnValue(false);

      // Mock console.warn to avoid output during tests
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // We need to create a module that will provide the required env vars
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      })
        .overrideProvider(ConfigService)
        .useValue({
          get: vi.fn().mockImplementation((key: string) => {
            if (key === '') {
              return {
                DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
              };
            }
            return;
          }),
        })
        .compile();

      const typedConfig = module.get<Configuration>('TYPED_CONFIG');

      expect(typedConfig).toBeDefined();
      expect(typedConfig.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
      expect(typedConfig.PORT).toBe(3000);
      expect(typedConfig.NODE_ENV).toBe('development');

      consoleWarnSpy.mockRestore();
    });

    it('should throw error when configuration validation fails', async () => {
      mockPath.resolve.mockReturnValue('/resolved/path');
      mockFs.existsSync.mockReturnValue(false);

      // Mock console.warn to avoid output during tests
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        Test.createTestingModule({
          imports: [TypedConfigModule],
        })
          .overrideProvider(ConfigService)
          .useValue({
            get: vi.fn().mockImplementation((key: string) => {
              if (key === '') {
                return {
                  DATABASE_URL: 'invalid-url', // Invalid URL will cause validation to fail
                };
              }
              return;
            }),
          })
          .compile()
      ).rejects.toThrow();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('module integration', () => {
    it('should create module successfully', async () => {
      mockPath.resolve.mockReturnValue('/resolved/path');
      mockFs.existsSync.mockReturnValue(false);

      // Mock console.warn to avoid output during tests
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Set required environment variable
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      expect(module).toBeDefined();

      const typedConfig = module.get('TYPED_CONFIG');
      expect(typedConfig).toBeDefined();

      consoleWarnSpy.mockRestore();
      delete process.env.DATABASE_URL;
    });

    it('should provide ConfigService via NestJS', async () => {
      mockPath.resolve.mockReturnValue('/resolved/path');
      mockFs.existsSync.mockReturnValue(false);

      // Mock console.warn to avoid output during tests
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Set required environment variable
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

      const module = await Test.createTestingModule({
        imports: [TypedConfigModule],
      }).compile();

      const configService = module.get(ConfigService);
      expect(configService).toBeDefined();

      consoleWarnSpy.mockRestore();
      delete process.env.DATABASE_URL;
    });
  });
});
