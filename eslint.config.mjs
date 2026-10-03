import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '.codex/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        window: 'readonly',
        document: 'readonly',
        HTMLFormElement: 'readonly',
        FormData: 'readonly',
        localStorage: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
