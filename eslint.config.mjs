// eslint.config.js (ESM, ESLint 9+)
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import perfectionist from 'eslint-plugin-perfectionist';
import eslintComments from 'eslint-plugin-eslint-comments';

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
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-null': 'error', // prefer Option/undefined in core/domain
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prevent-abbreviations': [
        'error',
        {
          // Allow common, idiomatic abbreviations (Nest/web/ecosystem)
          allowList: {
            params: true,
            props: true,
            ctx: true,
            req: true,
            res: true,
            env: true,
            args: true,
            attrs: true,
            btn: true,
            config: true,
            db: true,
            doc: true,
            el: true,
            elem: true,
            err: true,
            lib: true,
            msg: true,
            num: true,
            obj: true,
            param: true,
            prop: true,
            ref: true,
            repo: true,
            ret: true,
            str: true,
            val: true,
            util: true,
            utils: true,
          },
        },
      ],

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
      // If null is sometimes used in controllers, you can downgrade here:
      // 'unicorn/no-null': 'warn'
    },
  },
];
