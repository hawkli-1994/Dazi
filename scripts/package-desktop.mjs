import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const electron = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8'));
if (electron.version !== metadata.devDependencies.electron) {
  throw new Error('Install the locked Electron version before packaging.');
}
const checksums = JSON.parse(await readFile('node_modules/electron/checksums.json', 'utf8'));
if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
  throw new Error('Package on macOS, Windows, or Linux for the current machine.');
}
for (const file of [
  'dist/index.html',
  metadata.main,
  'dist-desktop/main/preload.cjs',
  'dist-desktop/host/index.js',
]) {
  await access(file);
}

const paths = await packager({
  dir: root,
  out: resolve('out'),
  name: 'Dazi',
  appBundleId: 'io.dazi.desktop',
  win32metadata: { CompanyName: 'Dazi' },
  platform: process.platform,
  arch: process.arch,
  electronVersion: metadata.devDependencies.electron,
  download: { checksums },
  appVersion: metadata.version,
  overwrite: true,
  asar: true,
  prune: true,
  // Only built assets and production dependencies may enter the application.
  // In particular, never collect local .env files, credentials, source, or tests.
  ignore: (path) => {
    if (!path) return false;
    if (!/^\/(?:dist|dist-desktop|node_modules)(?:\/|$)/.test(path) && path !== '/package.json')
      return true;
    return /(?:\.map$|\/node_modules\/\.bin(?:\/|$))/.test(path);
  },
  sanitizePackageJson: [
    (value) => ({
      name: value.name,
      version: value.version,
      type: value.type,
      main: value.main,
      dependencies: value.dependencies,
    }),
  ],
  // Signing, notarization, installers, updates, and publishing are separate work.
  osxSign: false,
  osxNotarize: false,
});

const provenance = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  lockSha256: createHash('sha256')
    .update(await readFile('bun.lock'))
    .digest('hex'),
  version: metadata.version,
  electron: metadata.devDependencies.electron,
  packager: metadata.devDependencies['@electron/packager'],
  platform: process.platform,
  arch: process.arch,
  signed: false,
};
for (const path of paths) {
  await writeFile(join(path, 'build-info.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  const basename = `Dazi-${metadata.version}-${process.platform}-${process.arch}-unsigned.tar.gz`;
  const archive = resolve('out', basename);
  execFileSync('tar', [
    '-czf',
    archive,
    '-C',
    resolve('out'),
    `Dazi-${process.platform}-${process.arch}`,
  ]);
  const checksum = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  await writeFile(`${archive}.sha256`, `${checksum}  ${basename}\n`);
  console.info(`[Package] Created unsigned desktop application: ${path}`);
  console.info(`[Package] Created trial archive and SHA-256: ${archive}`);
}
