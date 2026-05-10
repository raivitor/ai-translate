import path from 'node:path'
import { fileURLToPath } from 'node:url'

import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import n from 'eslint-plugin-n'
import prettierPlugin from 'eslint-plugin-prettier'
import security from 'eslint-plugin-security'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isCI = Boolean(process.env.CI)

export default tseslint.config(
  // 1) Ignores globais
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.env',
      '.env.*',
      'drizzle/**', // Drizzle gera arquivos que não devemos lintar
      'drizzle.config.ts',
      'eslint.config.mjs',
      '**/*.d.ts',
    ],
  },

  // 2) Base JS + TS
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3) Type-aware (Somente CI para performance local)
  ...(isCI ? tseslint.configs.recommendedTypeChecked : []),

  // 4) Presets de Plugins
  n.configs['flat/recommended-module'],
  security.configs.recommended,
  unicorn.configs.recommended,

  // 5) Configurações do Projeto
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2025,
      },
      parserOptions: {
        tsconfigRootDir: __dirname,
        // Só carrega o projeto TS se estiver no CI (necessário para type-aware rules)
        project: isCI ? './tsconfig.json' : undefined,
      },
    },
    plugins: {
      prettier: prettierPlugin,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // --- Prettier Integration ---
      'prettier/prettier': 'error',

      // --- Import Sorting ---
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // --- Unicorn Overrides (Sanidade Mental) ---
      'unicorn/prevent-abbreviations': [
        'error',
        {
          allowList: {
            // Termos comuns de Backend/Node que o Unicorn bloqueia por padrão
            ProcessEnv: true,
            env: true,
            req: true,
            res: true,
            err: true,
            params: true,
            args: true,
            db: true, // Se usar database, ele reclama de db
          },
        },
      ],
      'unicorn/no-null': 'off', // O Prisma/Drizzle usam null, essa regra atrapalha muito em DBs.
      'unicorn/filename-case': 'off', // Mantemos nomes atuais dos arquivos para evitar renomeação em massa.

      // --- Qualidade Geral ---
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-debugger': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',

      // --- TypeScript ---
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-expect-error': 'allow-with-description' },
      ],

      // --- Regras Pesadas (CI Only) ---
      // Proteção vital para Express/Async handlers
      ...(isCI
        ? {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': [
              'error',
              { checksVoidReturn: { attributes: false } },
            ],
            '@typescript-eslint/await-thenable': 'error',
          }
        : {}),
    },
  },

  // 6) Test files
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  // 7) Override Final: Prettier Config
  // Desliga regras de estilo do ESLint que conflitam com o Prettier
  prettierConfig,
)
