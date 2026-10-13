/* Lint rules for the web app: Next.js's recommended set (React, hooks,
   accessibility basics, Next-specific mistakes) plus its TypeScript rules.
   Run with `pnpm lint` from apps/web. Lint never runs inside `next build`
   (see next.config.js), so findings can't block a deploy.

   Errors = must fix before pushing. Warnings = cleanup to chip away at
   (mostly unused leftovers); they don't fail `pnpm lint`. */
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'next-env.d.ts',
      '*.config.js',
      'sentry.*.config.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    /* Older files carry eslint-disable comments for rules switched off
       below; they're harmless, so don't flag them. */
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      /* House style: `any` is used deliberately for loosely-shaped report
         JSON and API payloads. */
      '@typescript-eslint/no-explicit-any': 'off',
      /* Apostrophes/quotes in JSX text render fine in React. */
      'react/no-unescaped-entities': 'off',
      /* The app serves images as-is (images.unoptimized in next.config),
         so plain <img> is intended, not a missed next/image. */
      '@next/next/no-img-element': 'off',
      /* `_name` marks a value that is unused on purpose. */
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    /* react-pdf's <Image> has no alt attribute (PDFs aren't read by
       screen readers the same way); the rule is for HTML <img>. */
    files: ['src/lib/pdf/**'],
    rules: { 'jsx-a11y/alt-text': 'off' },
  },
];

export default config;
