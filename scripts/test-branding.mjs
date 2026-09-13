import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const json = name => JSON.parse(read(name));
const tauri = json('src-tauri/tauri.conf.json');
const release = json('packaging/release-config.json');
const pkg = json('package.json');
assert.equal(tauri.productName, 'MdVisualizer');
assert.equal(release.application.displayName, tauri.productName);
assert.equal(tauri.identifier, 'com.mdvisualizer.viewer');
assert.equal(release.application.identityName, tauri.identifier);
assert.equal(pkg.repository, 'https://github.com/KotorinChunChun/MdVisualizer');
assert.equal(pkg.version, tauri.version);
assert.equal(json('packages/markdown-core/package.json').version, pkg.version);
assert.equal(json('spfx/package.json').version, pkg.version);
assert.equal(json('spfx/config/package-solution.json').solution.version, pkg.version + '.0');
assert.match(read('src-tauri/Cargo.toml'), /name = "mdvisualizer"/);
const manifest = read('packaging/msix/AppxManifest.xml.in');
assert.match(manifest, /Executable="mdvisualizer.exe"/);
const extensions = tauri.bundle.fileAssociations.flatMap(a => a.ext).sort();
assert.deepEqual(extensions, ['drawio', 'md', 'markdown', 'mermaid', 'mmd', 'svg', 'tsv'].sort());
assert.deepEqual([...manifest.matchAll(/<uap:FileType\b[^>]*>\.([^<]+)</g)].map(m => m[1]).sort(), extensions);
for (const match of manifest.matchAll(/<uap:Logo>Assets\\([^<]+)<\/uap:Logo>/g)) {
  assert.ok(fs.existsSync(path.join(root, 'src-tauri/icons', match[1].replaceAll('\\', '/'))), match[1]);
}
for (const icon of tauri.bundle.icon) assert.ok(fs.existsSync(path.join(root, 'src-tauri', icon)), icon);
for (const text of Object.values(pkg.scripts)) {
  for (const match of text.matchAll(/\.\/scripts\/([^ ]+\.ps1)/g)) assert.ok(fs.existsSync(path.join(root, 'scripts', match[1])), match[1]);
}
const page = read('packaging/site/MdVisualizer.html');
assert.ok(page.includes('v0.0.16 ベータ版'));
assert.doesNotMatch(page, /0\.0\.15|旧版|MarkdownViewer|公開準備中/);
assert.ok(page.includes('MdVisualizer_0.0.16.0_x64.msix'));
assert.ok(page.includes('href="./beta/MdVisualizer.appinstaller'));
assert.ok(!page.includes(pkg.repository)); // 非公開リポジトリを公開サイトに案内しない。
assert.match(read('packaging/site/.htaccess'), /RedirectMatch 301/);
assert.ok(read('packaging/site/MakdownViewer.html').includes('url=./MdVisualizer.html'));
for (const file of ['packaging/site/index.html', 'packaging/site/MdVisualizer.html', 'packaging/site/certificate/index.html']) {
  const html = read(file);
  assert.doesNotMatch(html, /(?:href|src)="[^"\n]*(?:MakdownViewer\.html|markdownviewer-icon\.png)/);
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    const target = match[1];
    // 他製品のページ・画像はWebsite側が供給し、本リポジトリには含まれない。
    if (target === './assets/httpselector-icon.png' || target === './HttpSelector.html' || target.startsWith('./ScriptSync/')) continue;
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    if (/\/(?:beta|stable)\//.test(target)) {
      assert.ok(['MdVisualizer.appinstaller', 'MdVisualizer_0.0.16.0_x64.msix', 'MdVisualizer.cer'].includes(path.basename(target)), target);
      continue;
    }
    assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: ${target}`);
  }
}
console.log('製品名・バイナリ・配布識別子・7拡張子・アイコン・サイト参照の整合確認が成功しました。');
