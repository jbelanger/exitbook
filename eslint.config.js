// --- EFFECT-TS: STEP 1 ---
// Import the Effect ESLint plugin.
import effect from '@effect/eslint-plugin';
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
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/specs/**',
      '*.config.*',
      '**/tsconfig*.json',
    ],
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
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', disallowTypeAnnotations: false },
      ],
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
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-node-protocol': 'error',

      // --- Perfectionist (deterministic ordering) ---
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'alphabetical',
          order: 'asc',
          newlinesBetween: 'always',
          groups: [
            ['type', 'builtin', 'builtin-type'],
            ['external', 'external-type'],
            'internal',
            ['parent', 'parent-type'],
            ['sibling', 'sibling-type'],
            ['index', 'index-type'],
            'object',
            'unknown',
          ],
          customGroups: {
            value: {
              internal: ['^@app/', '^@domain/', '^@infrastructure/'],
            },
            type: {
              internal: ['^@app/', '^@domain/', '^@infrastructure/'],
            },
          },
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

  // --- EFFECT-TS: STEP 2 ---
  // This is the dedicated configuration for your Effect-TS codebase.
  // It applies the Effect plugin and disables conflicting TypeScript rules
  // ONLY for the files where you use Effect.
  {
    files: [
      'packages/core/**/src/**/*.{ts,tsx}',
      // Add any other paths that are Effect-heavy
    ],
    plugins: {
      effect,
    },
    rules: {
      // Apply the recommended ruleset from the Effect plugin
      ...effect.configs.recommended,

      // Disable built-in TS rules that conflict with the Effect pattern
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',

      // Allow unsafe operations for database/external library integration
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'unicorn/no-null': 'off',
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
              group: ['../**/packages/**', '../../**/packages/**', '../../../**/packages/**'],
              message:
                'Do not use relative paths to import from other packages. Use workspace imports like @exitbook/package-name instead.',
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
          patterns: ['@nestjs/*'],
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

  // === CLI app (CJS): relax ESM-only unicorn rules ===
  {
    files: ['apps/cli/**/src/**/*.{ts,tsx}'],
    rules: {
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },
];
