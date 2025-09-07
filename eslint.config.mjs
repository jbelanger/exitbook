import js from '@eslint/js';
// import neverthrow from 'eslint-plugin-neverthrow'; // Available but disabled due to ESLint 9 compatibility
import perfectionist from 'eslint-plugin-perfectionist';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      // neverthrow, // Disabled due to ESLint 9 flat config compatibility issues
      perfectionist,
      unicorn,
    },
    rules: {
      // --- NEVERTHROW RULES (EXPLICIT ERROR HANDLING) ---
      // 'neverthrow/must-use-result': 'error', // Disabled - see note above

      // --- UNICORN RULES (MAINTAINABILITY & PRAGMATIC BEST PRACTICES) ---
      '@typescript-eslint/no-unused-vars': 'off',
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-null': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prevent-abbreviations': [
        'error',
        {
          // Allow common, idiomatic abbreviations in the NestJS/web ecosystem.
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

      // --- PERFECTIONIST RULES FOR CONSISTENT SORTING ---
      'perfectionist/sort-array-includes': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-enums': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'alphabetical',
          order: 'asc',
          newlinesBetween: 'always',
          groups: [
            ['builtin', 'builtin-type'],
            ['external', 'external-type'],
            'internal',
            ['parent', 'parent-type'],
            ['sibling', 'sibling-type'],
            ['index', 'index-type'],
            'object',
            'unknown',
          ],
        },
      ],
      'perfectionist/sort-interfaces': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-object-types': ['error', { type: 'alphabetical', order: 'asc' }],
      'perfectionist/sort-objects': ['error', { type: 'alphabetical', order: 'asc' }],

      // --- LOGICAL CLASS MEMBER SORTING ---
      'perfectionist/sort-classes': 'off',
      '@typescript-eslint/member-ordering': [
        'error',
        {
          default: [
            'public-static-field', 'protected-static-field', 'private-static-field', '#private-static-field',
            'public-static-method', 'protected-static-method', 'private-static-method', '#private-static-method',
            'public-instance-field', 'protected-instance-field', 'private-instance-field', '#private-instance-field',
            'constructor',
            'public-instance-method', 'protected-instance-method', 'private-instance-method', '#private-instance-method',
          ],
        },
      ],
    },
  },
];
