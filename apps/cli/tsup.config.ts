import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  dts: true,
  shims: true,
  splitting: false,
  treeshake: true,
  noExternal: [/^@exitbook\//],
  // ccxt emits runtime imports for protobufjs/minimal.js in the bundled CLI, so this
  // package must stay installed even though the CLI source never imports it directly.
  external: ['protobufjs'],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});
