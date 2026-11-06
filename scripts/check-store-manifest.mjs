// Builds the normal and the Chrome Web Store variants and proves they differ only in
// the manifest `key`: same production code, same assets, same manifest minus `key`.
// Usage: pnpm check:store-manifest
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const normalDir = join(root, '.output', 'chrome-mv3');
const storeDir = join(root, '.output', 'chrome-mv3-store');

function build(extraArgs) {
  execFileSync('pnpm', ['exec', 'wxt', 'build', ...extraArgs], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
}

build([]);
build(['--mode', 'store']);

const problems = [];
const normal = readManifest(normalDir);
const store = readManifest(storeDir);

if (typeof normal.key !== 'string' || normal.key.length === 0) {
  problems.push('normal build: manifest.json has no "key"');
}
if ('key' in store) {
  problems.push('store build: manifest.json must not have "key"');
}
const { key: _key, ...normalWithoutKey } = normal;
if (JSON.stringify(normalWithoutKey) !== JSON.stringify(store)) {
  problems.push('manifests differ in more than "key" (field values or field order)');
}

const normalFiles = listFiles(normalDir);
const storeFiles = listFiles(storeDir);
if (JSON.stringify(normalFiles) !== JSON.stringify(storeFiles)) {
  problems.push('the two builds contain different files');
} else {
  for (const file of normalFiles) {
    if (file === 'manifest.json') continue;
    if (!readFileSync(join(normalDir, file)).equals(readFileSync(join(storeDir, file)))) {
      problems.push(`${file} differs (the store build must be the same production code)`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\nstore manifest check FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nstore manifest check passed: ${normalFiles.length} files, only the manifest "key" differs.`);
