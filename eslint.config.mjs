import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import perfectionist from 'eslint-plugin-perfectionist';
import eslintComments from 'eslint-plugin-eslint-comments';
import importPlugin from 'eslint-plugin-import';

// --- EFFECT-TS: STEP 1 ---
// Import the Effect ESLint plugin.
import effect from '@effect/eslint-plugin';

export default [
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
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
      '@typescript-eslint/no-explicit-any': [
        'error',
        { fixToUnknown: true, ignoreRestArgs: false },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
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
              internal: ['^@core/', '^@ctx/', '^@platform/', '^@contracts/', '^@ui/'],
            },
            type: {
              internal: ['^@core/', '^@ctx/', '^@platform/', '^@contracts/', '^@ui/'],
            },
          },
        },
      ],
      'perfectionist/sort-array-includes': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-enums': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-interfaces': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-object-types': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-objects': ['error', { type: 'alphabetical', order: 'asc' }],

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
      'packages/contexts/**/src/**/*.{ts,tsx}',
      'packages/platform/**/src/**/*.{ts,tsx}',
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
    },
  },

  // === Layer boundaries: forbid Nest imports in pure cores ===
  {
    files: ['packages/core/**/src/**/*.{ts,tsx}', 'packages/contexts/**/src/core/**/*.{ts,tsx}'],
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
              from: 'packages/platform/**',
              message: 'core must not depend on platform',
            },
            {
              target: 'packages/core/**',
              from: 'packages/contexts/**',
              message: 'core must not depend on contexts',
            },
            {
              target: 'packages/core/**',
              from: 'apps/**',
              message: 'core must not depend on apps',
            },

            // ===== Platform never depends on contexts or apps =====
            {
              target: 'packages/platform/**',
              from: 'packages/contexts/**',
              message: 'platform must not depend on contexts',
            },
            {
              target: 'packages/platform/**',
              from: 'apps/**',
              message: 'platform must not depend on apps',
            },

            // ===== Contracts are universal (no server/domain deps) =====
            {
              target: 'packages/contracts/**',
              from: 'packages/platform/**',
              message: 'contracts must not depend on platform',
            },
            {
              target: 'packages/contracts/**',
              from: 'packages/contexts/**',
              message: 'contracts must not depend on contexts',
            },

            // ===== UI (browser-only) =====
            {
              target: 'packages/ui/**',
              from: 'packages/platform/**',
              message: 'ui must not depend on platform (server-only)',
            },
            {
              target: 'packages/ui/**',
              from: 'packages/contexts/**',
              message: 'ui must not depend on contexts',
            },
            { target: 'packages/ui/**', from: 'apps/**', message: 'ui must not depend on apps' },

            // ===== Apps: never import adapters (use ports/compose/nest bridges) =====
            {
              target: 'apps/api/**',
              from: 'packages/contexts/*/adapters/**',
              message: 'apps must not import adapters; go through ports/compose',
            },
            {
              target: 'apps/cli/**',
              from: 'packages/contexts/*/adapters/**',
              message: 'apps must not import adapters; go through ports/compose',
            },
            {
              target: 'apps/workers/**',
              from: 'packages/contexts/*/adapters/**',
              message: 'apps must not import adapters; go through ports/compose',
            },
            {
              target: 'apps/web/**',
              from: 'packages/contexts/*/adapters/**',
              message: 'apps must not import adapters; go through ports/compose',
            },

            // ===== Apps: no app→app imports =====
            {
              target: 'apps/api/**',
              from: ['apps/cli/**', 'apps/web/**', 'apps/workers/**'],
              message: 'apps must not import other apps',
            },
            {
              target: 'apps/cli/**',
              from: ['apps/api/**', 'apps/web/**', 'apps/workers/**'],
              message: 'apps must not import other apps',
            },
            {
              target: 'apps/workers/**',
              from: ['apps/api/**', 'apps/web/**', 'apps/cli/**'],
              message: 'apps must not import other apps',
            },
            {
              target: 'apps/web/**',
              from: ['apps/api/**', 'apps/cli/**', 'apps/workers/**'],
              message: 'apps must not import other apps',
            },

            // ===== Web: browser-only consumption (contracts, api-client, ui, core/utils only) =====
            {
              target: 'apps/web/**',
              from: 'packages/platform/**',
              message: 'web must not import platform (server-only)',
            },
            {
              target: 'apps/web/**',
              from: 'packages/contexts/**',
              message: 'web must not import contexts',
            },
            // allow only core utils from core (block other core areas)
            {
              target: 'apps/web/**',
              from: 'packages/core/**',
              except: ['packages/core/src/utils', 'packages/core/utils'],
              message: 'web may import core/utils only',
            },

            // ===== Contexts: no cross-context imports =====
            {
              target: 'packages/contexts/trading/**',
              from: [
                'packages/contexts/portfolio/**',
                'packages/contexts/taxation/**',
                'packages/contexts/reconciliation/**',
              ],
              message: 'no cross-context imports',
            },
            {
              target: 'packages/contexts/portfolio/**',
              from: [
                'packages/contexts/trading/**',
                'packages/contexts/taxation/**',
                'packages/contexts/reconciliation/**',
              ],
              message: 'no cross-context imports',
            },
            {
              target: 'packages/contexts/taxation/**',
              from: [
                'packages/contexts/trading/**',
                'packages/contexts/portfolio/**',
                'packages/contexts/reconciliation/**',
              ],
              message: 'no cross-context imports',
            },
            {
              target: 'packages/contexts/reconciliation/**',
              from: [
                'packages/contexts/trading/**',
                'packages/contexts/portfolio/**',
                'packages/contexts/taxation/**',
              ],
              message: 'no cross-context imports',
            },

            // ===== Context internals: keep layers clean =====
            // core: only core (shared kernel) allowed; block platform/adapters/app/contracts/ui/apps
            {
              target: 'packages/contexts/trading/core/**',
              from: [
                'packages/platform/**',
                'packages/contexts/**/adapters/**',
                'packages/contexts/**/app/**',
                'packages/contracts/**',
                'packages/ui/**',
                'apps/**',
              ],
              message: 'context/core must remain pure',
            },
            {
              target: 'packages/contexts/portfolio/core/**',
              from: [
                'packages/platform/**',
                'packages/contexts/**/adapters/**',
                'packages/contexts/**/app/**',
                'packages/contracts/**',
                'packages/ui/**',
                'apps/**',
              ],
              message: 'context/core must remain pure',
            },
            {
              target: 'packages/contexts/taxation/core/**',
              from: [
                'packages/platform/**',
                'packages/contexts/**/adapters/**',
                'packages/contexts/**/app/**',
                'packages/contracts/**',
                'packages/ui/**',
                'apps/**',
              ],
              message: 'context/core must remain pure',
            },
            {
              target: 'packages/contexts/reconciliation/core/**',
              from: [
                'packages/platform/**',
                'packages/contexts/**/adapters/**',
                'packages/contexts/**/app/**',
                'packages/contracts/**',
                'packages/ui/**',
                'apps/**',
              ],
              message: 'context/core must remain pure',
            },

            // app: no direct platform or adapters (go through ports; platform comes via compose)
            {
              target: 'packages/contexts/trading/app/**',
              from: ['packages/platform/**', 'packages/contexts/**/adapters/**'],
              message: 'context/app must not import platform or adapters',
            },
            {
              target: 'packages/contexts/portfolio/app/**',
              from: ['packages/platform/**', 'packages/contexts/**/adapters/**'],
              message: 'context/app must not import platform or adapters',
            },
            {
              target: 'packages/contexts/taxation/app/**',
              from: ['packages/platform/**', 'packages/contexts/**/adapters/**'],
              message: 'context/app must not import platform or adapters',
            },
            {
              target: 'packages/contexts/reconciliation/app/**',
              from: ['packages/platform/**', 'packages/contexts/**/adapters/**'],
              message: 'context/app must not import platform or adapters',
            },
          ],
        },
      ],
    },
  },

  // === UI: browser globals ===
  {
    files: ['packages/ui/**/src/**/*.{ts,tsx}', 'apps/web/**/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // === Nest apps (CJS): relax ESM-only unicorn rules ===
  {
    files: [
      'apps/api/**/src/**/*.{ts,tsx}',
      'apps/workers/**/src/**/*.{ts,tsx}',
      'apps/cli/**/src/**/*.{ts,tsx}',
    ],
    rules: {
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },
];
