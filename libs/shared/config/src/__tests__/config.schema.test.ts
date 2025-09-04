import { describe, expect, it } from 'vitest';

import { ConfigValidationError, validateConfig } from '../config.schema';

describe('ConfigValidationError', () => {
  it('should format error message correctly', () => {
    const issues = [
      {
        code: 'invalid_type' as const,
        expected: 'string',
        message: 'Required',
        path: ['DATABASE_URL'],
        received: 'undefined',
      },
      {
        code: 'invalid_type' as const,
        expected: 'number',
        message: 'Expected number, received string',
        path: ['PORT'],
        received: 'string',
      },
    ];

    const error = new ConfigValidationError(issues);

    expect(error.name).toBe('ConfigValidationError');
    expect(error.message).toContain('Configuration validation failed');
    expect(error.message).toContain('DATABASE_URL: Required');
    expect(error.message).toContain('PORT: Expected number, received string');
    expect(error.issues).toEqual(issues);
  });
});

describe('validateConfig', () => {
  describe('database configuration', () => {
    it('should validate required DATABASE_URL', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
      }
    });

    it('should reject invalid DATABASE_URL', () => {
      const config = {
        DATABASE_URL: 'not-a-url',
      };

      const result = validateConfig(config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ConfigValidationError);
        expect(result.error.message).toContain('DATABASE_URL');
        expect(result.error.message).toContain('Invalid url');
      }
    });

    it('should apply default DATABASE_POOL_SIZE', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.DATABASE_POOL_SIZE).toBe(10);
      }
    });

    it('should validate custom DATABASE_POOL_SIZE', () => {
      const config = {
        DATABASE_POOL_SIZE: '25',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.DATABASE_POOL_SIZE).toBe(25);
      }
    });

    it('should reject negative DATABASE_POOL_SIZE', () => {
      const config = {
        DATABASE_POOL_SIZE: '-5',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('DATABASE_POOL_SIZE');
      }
    });

    it('should apply default DATABASE_SSL_MODE', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.DATABASE_SSL_MODE).toBe('prefer');
      }
    });

    it('should accept custom DATABASE_SSL_MODE', () => {
      const config = {
        DATABASE_SSL_MODE: 'require',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.DATABASE_SSL_MODE).toBe('require');
      }
    });
  });

  describe('application configuration', () => {
    it('should apply default LOG_LEVEL', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.LOG_LEVEL).toBe('info');
      }
    });

    it('should accept custom LOG_LEVEL', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        LOG_LEVEL: 'debug',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.LOG_LEVEL).toBe('debug');
      }
    });

    it('should apply default NODE_ENV', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.NODE_ENV).toBe('development');
      }
    });

    it('should validate NODE_ENV enum values', () => {
      const validEnvironments = ['development', 'production', 'test'];

      for (const env of validEnvironments) {
        const config = {
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
          NODE_ENV: env,
        };

        const result = validateConfig(config);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.NODE_ENV).toBe(env);
        }
      }
    });

    it('should reject invalid NODE_ENV', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        NODE_ENV: 'invalid',
      };

      const result = validateConfig(config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('NODE_ENV');
      }
    });

    it('should apply default PORT', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.PORT).toBe(3000);
      }
    });

    it('should coerce PORT to number', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        PORT: '8080',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.PORT).toBe(8080);
        expect(typeof result.value.PORT).toBe('number');
      }
    });

    it('should apply default PROVIDERS_CONFIG_PATH', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.PROVIDERS_CONFIG_PATH).toBe('./config/providers.config.json');
      }
    });
  });

  describe('providers configuration', () => {
    it('should accept valid providers configuration', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        providers: {
          bitcoin: {
            enabled: true,
            priority: ['mempool.space', 'blockchair'],
            providers: ['mempool.space', 'blockchair', 'blockcypher'],
          },
          ethereum: {
            enabled: false,
            priority: ['etherscan'],
            providers: ['etherscan', 'alchemy'],
          },
        },
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providers).toBeDefined();
        expect(result.value.providers!.bitcoin.enabled).toBe(true);
        expect(result.value.providers!.bitcoin.priority).toEqual(['mempool.space', 'blockchair']);
        expect(result.value.providers!.ethereum.enabled).toBe(false);
      }
    });

    it('should reject invalid providers configuration', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        providers: {
          bitcoin: {
            enabled: 'yes', // Should be boolean
            priority: ['mempool.space'],
            providers: ['mempool.space'],
          },
        },
      };

      const result = validateConfig(config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('providers.bitcoin.enabled');
      }
    });

    it('should accept empty providers configuration', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        providers: {},
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providers).toEqual({});
      }
    });

    it('should accept missing providers configuration', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providers).toBeUndefined();
      }
    });
  });

  describe('complete configuration validation', () => {
    it('should validate complete valid configuration', () => {
      const config = {
        DATABASE_POOL_SIZE: '20',
        DATABASE_SSL_MODE: 'require',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'production',
        PORT: '4000',
        providers: {
          bitcoin: {
            enabled: true,
            priority: ['mempool.space'],
            providers: ['mempool.space', 'blockchair'],
          },
        },
        PROVIDERS_CONFIG_PATH: './custom-config.json',
      };

      const result = validateConfig(config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.DATABASE_POOL_SIZE).toBe(20);
        expect(result.value.DATABASE_SSL_MODE).toBe('require');
        expect(result.value.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
        expect(result.value.LOG_LEVEL).toBe('warn');
        expect(result.value.NODE_ENV).toBe('production');
        expect(result.value.PORT).toBe(4000);
        expect(result.value.PROVIDERS_CONFIG_PATH).toBe('./custom-config.json');
        expect(result.value.providers?.bitcoin.enabled).toBe(true);
      }
    });

    it('should return multiple validation errors', () => {
      const config = {
        DATABASE_POOL_SIZE: '-5',
        DATABASE_URL: 'not-a-url',
        NODE_ENV: 'invalid',
        PORT: 'not-a-number',
      };

      const result = validateConfig(config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.issues.length).toBeGreaterThan(1);
        expect(result.error.message).toContain('DATABASE_POOL_SIZE');
        expect(result.error.message).toContain('DATABASE_URL');
        expect(result.error.message).toContain('NODE_ENV');
      }
    });

    it('should handle empty configuration object', () => {
      const config = {};

      const result = validateConfig(config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('DATABASE_URL');
      }
    });
  });
});
