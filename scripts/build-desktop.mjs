import { mkdir, rm } from 'node:fs/promises';

if (typeof Bun === 'undefined') throw new Error('Run this build with Bun.');

await rm('dist-desktop', { recursive: true, force: true });
await mkdir('dist-desktop', { recursive: true });
const outputs = [
  { entry: 'src/main/index.ts', outdir: 'dist-desktop/main', format: 'esm', naming: 'index.js' },
  {
    entry: 'src/main/preload.ts',
    outdir: 'dist-desktop/main',
    format: 'cjs',
    naming: 'preload.cjs',
  },
  { entry: 'src/host/index.ts', outdir: 'dist-desktop/host', format: 'esm', naming: 'index.js' },
];

for (const output of outputs) {
  const result = await Bun.build({
    entrypoints: [output.entry],
    outdir: output.outdir,
    naming: output.naming,
    format: output.format,
    target: 'node',
    packages: 'external',
    external: ['electron'],
    sourcemap: 'external',
  });
  if (!result.success) throw new AggregateError(result.logs, `Could not build ${output.entry}.`);
}
