import js from '@eslint/js';
import eslintComments from 'eslint-plugin-eslint-comments';
import importPlugin from 'eslint-plugin-import';
import perfectionist from 'eslint-plugin-perfectionist';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  // Global ignores
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.turbo/**', '**/specs/**', '**/tsconfig*.json'],
  },

  // Base JS rules
  js.configs.recommended,

  // TS: base + stylistic + type-checked
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  ...tseslint.configs.recommendedTypeChecked,

  // Default TS/Node language options (project service enables type-aware rules in monorepos)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
      globals: { ...globals.node },
    },
    plugins: {
      unicorn,
      perfectionist,
      'eslint-comments': eslintComments,
      import: importPlugin,
    },
    rules: {
      // --- Type safety hardening ---
      '@typescript-eslint/no-explicit-any': ['error', { fixToUnknown: true, ignoreRestArgs: false }],
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Require explanations for disables
      'eslint-comments/require-description': ['error', { ignore: [] }],

      // --- Unicorn (Node pragmatics) ---
      'unicorn/no-null': 'error', // prefer Option/undefined in core/domain
      'unicorn/no-useless-undefined': [
        'error',
        {
          checkArguments: false,
        },
      ],
      'unicorn/prefer-node-protocol': 'error',

      // --- Perfectionist (deterministic ordering) ---
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'alphabetical',
          order: 'asc',
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        },
      ],
      'perfectionist/sort-array-includes': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-enums': ['error', { type: 'alphabetical', order: 'asc' }],
      //'perfectionist/sort-interfaces': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-object-types': ['error', { type: 'alphabetical', order: 'asc' }],
      //'perfectionist/sort-objects': ['error', { type: 'alphabetical', order: 'asc' }],

      // Logical class member ordering
      '@typescript-eslint/member-ordering': [
        'error',
        {
          default: [
            'public-static-field',
            'protected-static-field',
            'private-static-field',
            '#private-static-field',
            'public-static-method',
            'protected-static-method',
            'private-static-method',
            '#private-static-method',
            'public-instance-field',
            'protected-instance-field',
            'private-instance-field',
            '#private-instance-field',
            'constructor',
            'public-abstract-method',
            'protected-abstract-method',
            'public-instance-method',
            'protected-instance-method',
            'private-instance-method',
            '#private-instance-method',
          ],
        },
      ],
    },
  },

  // === Enforce barrel imports ===
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@exitbook/*/src/**'],
              message:
                'Use barrel imports instead of direct src imports. Import from @exitbook/package-name instead of @exitbook/package-name/src/...',
            },
            {
              group: [
                './*.ts',
                './**/*.ts',
                '../*.ts',
                '../**/*.ts',
                './*.tsx',
                './**/*.tsx',
                '../*.tsx',
                '../**/*.tsx',
              ],
              message: 'Use .js extensions for relative imports (NodeNext convention).',
            },
            {
              group: [
                '../*/src/**',
                '../../*/src/**',
                '../../../*/src/**',
                '../../../../*/src/**',
                '../**/packages/*/src/**',
                '../../**/packages/*/src/**',
                '../../../**/packages/*/src/**',
                '../../../../**/packages/*/src/**',
              ],
              message:
                'Do not import another package internals via relative src paths. Use workspace imports like @exitbook/package-name instead.',
            },
          ],
        },
      ],
      'import/no-relative-packages': 'error',
    },
  },

  // === Layer boundaries ===
  {
    files: ['packages/core/**/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              message: 'Keep domain/core framework-agnostic.',
            },
            {
              name: '@nestjs/core',
              message: 'Keep domain/core framework-agnostic.',
            },
            {
              name: 'class-validator',
              message: 'Validate at the shell; use schema/VOs in core.',
            },
          ],
          patterns: [
            '@nestjs/*',
            './*.ts',
            './**/*.ts',
            '../*.ts',
            '../**/*.ts',
            './*.tsx',
            './**/*.tsx',
            '../*.tsx',
            '../**/*.tsx',
          ],
        },
      ],
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // ===== Core purity =====
            {
              target: 'packages/core/**',
              from: ['packages/ingestion/**', 'packages/balance/**', 'packages/data/**', 'apps/**'],
              message: 'core must not depend on other packages or apps',
            },

            // ===== Import package: architectural boundaries =====
            // Domain cannot import from app or infrastructure
            {
              target: 'packages/ingestion/src/domain/**',
              from: ['packages/ingestion/src/app/**', 'packages/ingestion/src/infrastructure/**'],
              message: 'domain must not import from app or infrastructure layers',
            },
            // App cannot import from infrastructure
            {
              target: 'packages/ingestion/src/app/**',
              from: 'packages/ingestion/src/infrastructure/**',
              message: 'app layer must not import from infrastructure layer',
            },
          ],
        },
      ],
    },
  },

  // === React/TSX: allow null returns (React convention) ===
  {
    files: ['**/*.tsx'],
    rules: {
      'unicorn/no-null': 'off', // React components conventionally return null, not undefined
    },
  },

  // === CLI app (CJS): relax ESM-only unicorn rules ===
  {
    files: ['apps/cli/**/src/**/*.{ts,tsx}'],
    rules: {
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },

  // === CLI app: prohibit direct database access ===
  {
    files: ['apps/cli/**/src/**/*.{ts,tsx}'],
    rules: {
      // Prevent Kysely query construction in CLI
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^(selectFrom|insertInto|updateTable|deleteFrom|schema)$/]',
          message:
            'CLI must not construct Kysely queries directly. Use services/repositories from @exitbook/data, @exitbook/ingestion, or @exitbook/accounting instead.',
        },
        {
          selector: 'MemberExpression[property.name=/^(selectFrom|insertInto|updateTable|deleteFrom|schema)$/]',
          message:
            'CLI must not access Kysely query methods directly. Use services/repositories from @exitbook/data, @exitbook/ingestion, or @exitbook/accounting instead.',
        },
      ],
      // Prevent KyselyDB type usage in CLI (except test files and specific utilities)
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@exitbook/data'],
              importNames: ['KyselyDB'],
              message:
                'CLI should not use KyselyDB type directly. Accept services/repositories in constructors instead. Only command-execution.ts and index.ts may use initializeDatabase/closeDatabase.',
            },
            {
              group: [
                './*.ts',
                './**/*.ts',
                '../*.ts',
                '../**/*.ts',
                './*.tsx',
                './**/*.tsx',
                '../*.tsx',
                '../**/*.tsx',
              ],
              message: 'Use .js extensions for relative imports (NodeNext convention).',
            },
          ],
        },
      ],
    },
  },

  // === CLI app: allow database lifecycle management only in entry points ===
  {
    files: [
      'apps/cli/src/index.ts',
      'apps/cli/src/features/shared/command-execution.ts',
      'apps/cli/src/features/*/import-service-factory.ts',
    ],
    rules: {
      'no-restricted-imports': 'off', // Allow KyselyDB and initializeDatabase/closeDatabase in these files
    },
  },

  // === CLI app: allow KyselyDB type in test files ===
  {
    files: ['apps/cli/**/__tests__/**/*.{ts,tsx}', 'apps/cli/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off', // Allow KyselyDB in test files for mocking
    },
  },

  // === Config files: basic linting without type-checking ===
  // Config files at root are not included in any tsconfig, so disable type-aware rules
  {
    files: ['*.config.{js,ts,mjs,cjs}', '**/vitest.*.{js,ts}', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
];
