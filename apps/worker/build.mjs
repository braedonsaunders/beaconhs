// Bundle the worker for production `node` execution.
//
// Internal @beaconhs/* packages are consumed as raw TS source (their package
// exports point at src/*.ts, compiled by the consumer — Next for web, tsx in
// dev). Plain node can't load .ts, so we must BUNDLE them here (esbuild
// compiles the TS and inlines it). Real npm dependencies stay external and are
// resolved from node_modules at runtime (provided by `pnpm deploy --prod`).
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts', 'src/scheduler.ts', 'src/health.ts', 'src/storage-init.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-npm-keep-workspace',
      setup(b) {
        // Bare specifiers (not relative/absolute). Bundle our workspace
        // packages (TS source); externalize everything else (npm + node:*).
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@beaconhs/')) return undefined // bundle it
          return { path: args.path, external: true }
        })
      },
    },
  ],
})
