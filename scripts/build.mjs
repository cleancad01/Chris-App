// Bundles main, preload, renderer and worker with esbuild. No native modules.
// Usage: node scripts/build.mjs [--watch] [--capture-test]
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const captureTest = process.argv.includes('--capture-test');

const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2022' };

const targets = captureTest
  ? [
      { entryPoints: ['scripts/capture-test/main.ts'], outfile: 'dist/capture-test/main.js', platform: 'node', format: 'cjs', external: ['electron'] },
      { entryPoints: ['scripts/capture-test/preload.ts'], outfile: 'dist/capture-test/preload.js', platform: 'node', format: 'cjs', external: ['electron'] },
      { entryPoints: ['scripts/capture-test/renderer.ts'], outfile: 'dist/capture-test/renderer.js', platform: 'browser', format: 'iife' },
    ]
  : [
      { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js', platform: 'node', format: 'cjs', external: ['electron'] },
      { entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js', platform: 'node', format: 'cjs', external: ['electron'] },
      { entryPoints: ['src/renderer/index.ts'], outfile: 'dist/renderer/index.js', platform: 'browser', format: 'iife' },
      { entryPoints: ['src/renderer/transcriber/whisper.worker.ts'], outfile: 'dist/renderer/whisper.worker.js', platform: 'browser', format: 'esm' },
    ];

function copyStatic() {
  if (captureTest) {
    mkdirSync('dist/capture-test', { recursive: true });
    if (existsSync('scripts/capture-test/index.html')) cpSync('scripts/capture-test/index.html', 'dist/capture-test/index.html');
    return;
  }
  mkdirSync('dist/renderer', { recursive: true });
  cpSync('src/renderer/static', 'dist/renderer', { recursive: true });
  if (existsSync('assets')) cpSync('assets', 'dist/assets', { recursive: true });
}

const existing = targets.filter((t) => existsSync(t.entryPoints[0]));
if (watch) {
  const ctxs = await Promise.all(existing.map((t) => esbuild.context({ ...common, ...t })));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStatic();
  console.log('watching...');
} else {
  await Promise.all(existing.map((t) => esbuild.build({ ...common, ...t })));
  copyStatic();
  console.log(`built ${existing.length} bundles${captureTest ? ' (capture-test)' : ''}`);
}
