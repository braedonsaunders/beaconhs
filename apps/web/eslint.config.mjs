// Next 16 ships eslint-config-next as a native flat config array — import and
// spread it directly (FlatCompat breaks on the @next plugin's circular config).
import next from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'public/**'] },
  ...next,
  {
    rules: {
      // Pure stylistic noise — apostrophes/quotes in JSX text are fine.
      'react/no-unescaped-entities': 'off',
      // False positive in the App Router (the rule targets the legacy pages/ dir).
      '@next/next/no-html-link-for-pages': 'off',
      // React Compiler advisories newly enabled by eslint-plugin-react-hooks v6.
      // Keep them VISIBLE as warnings during adoption — each fix (setState in
      // effects, impure render, ref access) needs careful per-site review, so we
      // don't block CI on them yet. The classic react-hooks/rules-of-hooks stays
      // an error.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]

export default eslintConfig
