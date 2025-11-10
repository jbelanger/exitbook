import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node23',
  clean: true,
  dts: true,
  shims: true,
  splitting: false,
  treeshake: true,
  noExternal: [/^@exitbook\//],
  external: ['protobufjs'],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});
